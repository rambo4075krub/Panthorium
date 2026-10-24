'use strict';
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { NotificationRepository } = require('../services/notificationRepository');
const { NotificationService, DEFAULT_SETTINGS } = require('../services/notificationService');
const { AuditService } = require('../services/auditService');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');

const user = {sub:'notification-owner',roles:['user'],permissions:['chat']};
const other = {...user,sub:'notification-other'};
async function suite(repository,label) {
  let now = Date.now();
  repository.now=()=>now;
  const service = new NotificationService({repository,now:()=>now});
  await service.init();
  assert.deepEqual((await service.settings({user})).settings,DEFAULT_SETTINGS);
  const guests = [{...user,sub:'guest:abc'},{...user,sub:'guest_abc'},{...user,roles:['guest']},{...user,isGuest:true},{...user,permissions:[]}];
  for (const guest of guests) {
    await assert.rejects(()=>service.list({user:guest}),/notifications_requires_account/);
    await assert.rejects(()=>service.send({user:guest,title:'rejected'}),/notifications_requires_account/);
  }
  for (const patch of [{channels:{voice:'true'}},{enabled:null},{unknown:true},{quietHours:{start:'25:99'}},{quietHours:{timeZone:'Mars'}},{categories:{administrator:true}},JSON.parse('{"__proto__":{}}')]) {
    await assert.rejects(()=>service.updateSettings({user,patch}),error=>error.status===400&&error.sideEffectNotApplied===true);
  }
  await service.updateSettings({user,patch:{channels:{voice:true},categories:{social:false},quietHours:{enabled:true,start:'21:30'}}});
  await service.updateSettings({user,patch:{channels:{sound:true}}});
  const settings=(await service.settings({user})).settings;
  assert.equal(settings.channels.voice,true);assert.equal(settings.channels.sound,true);assert.equal(settings.channels.inApp,true);
  assert.equal(settings.quietHours.start,'21:30');assert.equal(settings.quietHours.end,'07:00');
  assert.deepEqual((await service.settings({user:other})).settings,DEFAULT_SETTINGS);
  const first = await service.send({user,title:'One',body:'Private body',requestId:'stable-request'});
  const replay = await service.send({user,title:'One',body:'Private body',requestId:'stable-request'});
  assert.equal(first.notification.id,replay.notification.id);
  await assert.rejects(()=>service.send({user,title:'Changed',requestId:'stable-request'}),/notification_request_conflict/);
  await assert.rejects(()=>service.send({user,title:'One',body:'Private body',category:'ai',requestId:'stable-request'}),/notification_request_conflict/);
  assert.equal((await service.list({user:other})).items.length,0);
  const foreign = await service.send({user:other,title:'Their message'});
  assert.equal((await service.markRead({user:other,ids:[first.notification.id]})).changed,0);
  assert.equal((await service.remove({user:other,ids:[first.notification.id]})).changed,0);
  await assert.rejects(()=>service.list({user:other,before:first.notification.id}),/invalid_notification_cursor/);
  await assert.rejects(()=>service.list({user,limit:'NaN'}),/invalid_notification_query/);
  await assert.rejects(()=>service.list({user,limit:1.5}),/invalid_notification_query/);
  await assert.rejects(()=>service.list({user,unreadOnly:'false'}),/invalid_notification_query/);
  await assert.rejects(()=>service.markRead({user,all:true,ids:[first.notification.id]}),/invalid_notification_ids/);
  await assert.rejects(()=>service.remove({user,ids:['arbitrary']}),/invalid_notification_ids/);
  for(let i=0;i<5;i++) await service.send({user,title:'Same instant '+i,requestId:'instant-'+i});
  let cursor,ids=[];
  do {
    const page=await service.list({user,limit:2,before:cursor});
    assert(page.items.every(n=>!Object.hasOwn(n,'userId')&&!Object.hasOwn(n,'deletedAt')));
    ids.push(...page.items.map(n=>n.id));cursor=page.nextCursor||undefined;
  }while(cursor);
  assert.equal(ids.length,6);assert.equal(new Set(ids).size,6,'same timestamp keyset paging never duplicates or skips');
  assert.equal((await service.list({user})).unreadCount,6);
  await service.markRead({user,ids:[first.notification.id]});
  assert.equal((await service.list({user,unreadOnly:true})).items.length,5);
  await service.remove({user,ids:[first.notification.id]});
  const deletedReplay=await service.send({user,title:'One',body:'Private body',requestId:'stable-request'});
  assert.equal(deletedReplay.notification,null,'dismissed notification cannot be resurrected by replay');
  assert.equal((await service.list({user})).items.length,5);
  await service.markRead({user,all:true});assert.equal((await service.list({user})).unreadCount,0);
  assert.equal((await service.list({user:other})).unreadCount,1);
  const sensitive=await service.publish({userId:user.sub,category:'social',type:'social.activity',title:'Social activity',body:'Generic',sourceId:'notification:source'});
  service.socialVisibility=async()=>true;
  assert((await service.list({user})).items.some(n=>n.id===sensitive.id));
  service.socialVisibility=async()=>{throw Error('temporary outage');};
  const outage=await service.list({user});assert(!outage.items.some(n=>n.id===sensitive.id));assert.equal(outage.unreadCount,0);
  service.socialVisibility=async()=>true;
  assert((await service.list({user})).items.some(n=>n.id===sensitive.id),'transient source outage does not permanently dismiss');
  service.socialVisibility=async()=>false;
  assert(!(await service.list({user})).items.some(n=>n.id===sensitive.id));
  service.socialVisibility=async()=>true;
  assert(!(await service.list({user})).items.some(n=>n.id===sensitive.id),'revoked activity stays dismissed after rejoining');
  now+=91*86400000;
  assert.equal((await service.list({user})).items.length,0);assert.equal((await service.list({user})).unreadCount,0);
  assert.equal(await service.publish({userId:user.sub,title:'Ancient',type:'system.old',sourceId:'old',createdAt:new Date(now-92*86400000).toISOString()}),null);
  await service.close();
  console.log('Notifications '+label+' passed');
}
async function auditSuite() {
  const audit=new AuditService(),repository=new NotificationRepository({allowMemory:true}),ledger=new ActionLedgerRepository({allowMemory:true});
  await ledger.init();
  const notifications=new NotificationService({repository,audit,actionLedger:ledger});await notifications.init();
  audit.subscribe(()=>{throw Error('observer failure');});
  audit.record('auth.login_success',{userId:user.sub,username:'private-name',ip:'private-address'});
  audit.record('agent.tool_started',{userId:user.sub,toolId:'notifications.read',runId:'avoid-loop'});
  audit.record('untrusted.unknown',{userId:user.sub,title:'DO NOT COPY'});
  audit.record('reminder.delivered',{userId:user.sub,reminderId:'r1',occurrence:1,details:'PRIVATE'});
  audit.record('reminder.delivered',{userId:user.sub,reminderId:'r1',occurrence:1,details:'PRIVATE'});
  audit.record('agent.tool_completed',{userId:user.sub,actionId:'durable-only',runId:'durable-only',toolId:'files.write',mutates:true});
  let list=await notifications.list({user});
  assert.equal(list.items.length,2,'allowlist, dedup, loop guard, authoritative ledger results');
  assert(!JSON.stringify(list.items).includes('PRIVATE'));assert(!JSON.stringify(list.items).includes('private-name'));assert(!JSON.stringify(list.items).includes('private-address'));
  let action=await ledger.propose({userId:user.sub,requestId:'durable',toolId:'calendar.write',args:{title:'Private appointment'},requiresConfirmation:true});
  list=await notifications.list({user});
  assert(list.items.some(n=>n.type==='action.awaiting_confirmation'&&n.category==='operations'));
  assert(list.items.some(n=>n.type==='action.awaiting_confirmation'&&n.title.startsWith('ปฏิทิน: ')),'known tool domain distinguishes operation without exposing its arguments');
  await ledger.claim(user.sub,action.actionId,action.approvalHash);
  await notifications.list({user});
  await ledger.markUnknown(user.sub,action.actionId);
  list=await notifications.list({user});assert(list.items.some(n=>n.type==='action.unknown'));assert(!list.items.some(n=>n.type==='action.succeeded'));
  await ledger.finish(user.sub,action.actionId,'succeeded',{ok:true,private:'NOT FOR NOTICE'});
  list=await notifications.list({user});assert(list.items.some(n=>n.type==='action.succeeded'));
  const success=list.items.find(n=>n.type==='action.succeeded');await notifications.remove({user,ids:[success.id]});
  notifications.reconciledActions.clear();assert(!(await notifications.list({user})).items.some(n=>n.id===success.id));
  assert(!JSON.stringify(list.items).includes('Private appointment'));assert(!JSON.stringify(list.items).includes('NOT FOR NOTICE'));
  assert.equal((await notifications.list({user:other})).items.length,0);
  await notifications.close();audit.record('auth.login_success',{userId:user.sub});
  assert.equal(notifications.pending.size,0);
  console.log('Notification audit and durable action reconciliation passed');
}
(async()=>{
  await assert.rejects(()=>new NotificationRepository({required:true,allowMemory:true}).init(),/notifications_storage_unavailable/);
  await suite(new NotificationRepository({allowMemory:true}),'memory isolation/settings/pagination/retention');
  const db=newDb({noAstCoverageCheck:true}),pool=new (db.adapters.createPg().Pool)();
  try {await suite(new NotificationRepository({pool,required:true}),'SQL adapter');}finally{await pool.end();}
  await auditSuite();
  console.log('pg-mem checks SQL predicates; PostgreSQL concurrency is covered by notifications-postgres.js.');
})().catch(error=>{console.error(error);process.exitCode=1;});
