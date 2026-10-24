'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { NotificationRepository } = require('../services/notificationRepository');
const { NotificationService } = require('../services/notificationService');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const eventCatalog = require('../notification-event-catalog');

(async()=>{
  const connectionString=process.env.TEST_DATABASE_URL;
  if(!connectionString){if(process.env.CI)throw Error('TEST_DATABASE_URL is required for notification PostgreSQL tests');console.log('SKIP notification PostgreSQL integration: TEST_DATABASE_URL is not set.');return;}
  const schema='notification_ci_'+randomBytes(10).toString('hex');
  const admin=new Pool({connectionString,max:1,connectionTimeoutMillis:5000});
  let pool,created=false;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    pool=new Pool({connectionString,max:12,connectionTimeoutMillis:5000,options:`-c search_path=${schema},public -c statement_timeout=15000`});
    const service=new NotificationService({repository:new NotificationRepository({pool,required:true})});await service.init();
    const user={sub:'owner',roles:['user'],permissions:['chat']},other={...user,sub:'other'};
    const results=await Promise.all(Array.from({length:12},()=>service.send({user,title:'Exact once',body:'Persistent notification',requestId:'same-logical-request'})));
    assert.equal(new Set(results.map(r=>r.notification.id)).size,1);assert.equal((await service.list({user})).unreadCount,1);
    // Concurrent patches touch different children of the same nested object.
    await Promise.all([
      service.updateSettings({user,patch:{channels:{voice:true}}}),
      service.updateSettings({user,patch:{channels:{sound:true}}}),
      service.updateSettings({user,patch:{categories:{social:false}}}),
      service.updateSettings({user,patch:{categories:{operations:false}}}),
      service.updateSettings({user,patch:{events:{operation_succeeded:false}}}),
      service.updateSettings({user,patch:{events:{operation_started:false}}}),
      service.updateSettings({user,patch:{quietHours:{start:'20:00'}}}),
      service.updateSettings({user,patch:{quietHours:{end:'08:00'}}}),
      service.updateSettings({user,patch:{privacyPreview:true}})
    ]);
    const settings=(await service.settings({user})).settings;
    assert.equal(settings.channels.voice,true);assert.equal(settings.channels.sound,true);assert.equal(settings.channels.inApp,true);
    assert.equal(settings.categories.social,false);assert.equal(settings.categories.operations,false);assert.equal(settings.categories.security,true);
    assert.equal(settings.events.operation_succeeded,false);assert.equal(settings.events.operation_started,false);assert.equal(settings.events.operation_failed,true,'concurrent per-event patches preserve siblings');
    assert.deepEqual((await service.settings({user:other})).settings.events,eventCatalog.defaults);
    assert.equal(settings.quietHours.start,'20:00');assert.equal(settings.quietHours.end,'08:00');assert.equal(settings.privacyPreview,true);
    const reopened=new NotificationService({repository:new NotificationRepository({pool,required:true})});await reopened.init();
    assert.deepEqual((await reopened.settings({user})).settings,settings,'settings survive restart');
    const legacySettings={enabled:true,channels:{inApp:true,browser:false,sound:false,voice:false},categories:{operations:false}};
    await pool.query('INSERT INTO panthorium_notification_settings(user_id,settings) VALUES($1,$2::jsonb)',['legacy-owner',JSON.stringify(legacySettings)]);
    const migrated=(await reopened.settings({user:{...user,sub:'legacy-owner'}})).settings;
    assert.deepEqual(migrated.events,eventCatalog.defaults,'pre-event preference rows migrate without a write or destructive reset');
    assert.equal(migrated.categories.operations,false);
    assert.equal((await reopened.list({user})).items[0].body,'Persistent notification');
    const id=results[0].notification.id;
    assert.equal((await reopened.list({user:other})).items.length,0);
    assert.equal((await reopened.markRead({user:other,ids:[id]})).changed,0);
    assert.equal((await reopened.remove({user:other,ids:[id]})).changed,0);
    await assert.rejects(()=>reopened.list({user:other,before:id}),/invalid_notification_cursor/);
    const read=await Promise.all(Array.from({length:12},()=>reopened.markRead({user,ids:[id]})));
    assert.equal(read.reduce((sum,r)=>sum+r.changed,0),1);assert.equal((await reopened.list({user})).unreadCount,0);
    const deletes=await Promise.all(Array.from({length:12},()=>reopened.remove({user,ids:[id]})));
    assert.equal(deletes.reduce((sum,r)=>sum+r.changed,0),1);
    await service.send({user,title:'Exact once',body:'Persistent notification',requestId:'same-logical-request'});
    assert.equal((await reopened.list({user})).items.length,0,'restart/replay cannot resurrect dismissed rows');
    const at=new Date().toISOString();
    for(let i=0;i<7;i++)await reopened.publish({userId:user.sub,title:'Same-time '+i,type:'system.test',sourceId:'same-time-'+i,createdAt:at});
    let before,ids=[];
    do{const page=await reopened.list({user,limit:2,before});ids.push(...page.items.map(n=>n.id));before=page.nextCursor||undefined;}while(before);
    assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);assert.equal((await reopened.list({user})).unreadCount,7);
    await reopened.markRead({user,all:true});assert.equal((await service.list({user})).unreadCount,0);
    const legacySocial=await reopened.publish({userId:user.sub,category:'social',type:'social.activity',title:'Legacy Social',sourceId:'legacy-notice'});
    const messageSocial=await reopened.publish({userId:user.sub,category:'social',type:'social.activity.message',title:'New message',sourceId:'message-notice'});
    const requestedSocial=(await reopened.send({user,category:'social',title:'My own request'})).notification;
    reopened.socialVisibility=async()=>true;
    assert((await reopened.list({user})).items.some(n=>n.id===messageSocial.id&&n.eventKey==='social_message'));
    reopened.socialVisibility=async()=>{throw Error('source outage');};
    const hidden=await reopened.list({user});
    assert(!hidden.items.some(n=>[legacySocial.id,messageSocial.id].includes(n.id)),'SQL outage filtering includes legacy and subtype records');
    assert(hidden.items.some(n=>n.id===requestedSocial.id),'self-requested Social-category notices are not source activity');
    assert.equal(hidden.unreadCount,1);
    reopened.socialVisibility=async()=>false;
    const revoked=await reopened.list({user});assert(!revoked.items.some(n=>[legacySocial.id,messageSocial.id].includes(n.id)));
    reopened.socialVisibility=async()=>true;
    assert(!(await reopened.list({user})).items.some(n=>n.id===messageSocial.id),'revoked subtype stays dismissed');
    let clock=Date.now();
    const ledger=new ActionLedgerRepository({pool,required:true,now:()=>clock,staleAfterMs:1000});await ledger.init();
    const ownerAction=await ledger.propose({userId:user.sub,requestId:'owner-stale',toolId:'calendar.write',args:{title:'private appointment'},requiresConfirmation:true});
    const otherAction=await ledger.propose({userId:other.sub,requestId:'other-stale',toolId:'files.write',args:{body:'other private data'},requiresConfirmation:true});
    await ledger.claim(user.sub,ownerAction.actionId,ownerAction.approvalHash);
    await ledger.claim(other.sub,otherAction.actionId,otherAction.approvalHash);
    const finished=await ledger.propose({userId:user.sub,requestId:'owner-complete',toolId:'notes.write',args:{body:'private note'},requiresConfirmation:true});
    await ledger.claim(user.sub,finished.actionId,finished.approvalHash);
    await ledger.finish(user.sub,finished.actionId,'succeeded',{ok:true,privateResult:'secret output'});
    clock+=2000;
    const snapshot=await ledger.listNotificationStates(user.sub,100);
    assert.equal(snapshot.length,2);assert(snapshot.every(row=>row.userId===user.sub));
    assert.equal(snapshot.find(row=>row.actionId===ownerAction.actionId).state,'unknown','stale running receipt is reconciled in the notification snapshot');
    assert.equal(snapshot.find(row=>row.actionId===finished.actionId).state,'succeeded');
    const untouchedOther=await pool.query('SELECT state FROM panthorium_action_ledger WHERE action_id=$1',[otherAction.actionId]);
    assert.equal(untouchedOther.rows[0].state,'running','snapshot reconciliation cannot modify another account');
    for(const row of snapshot)assert.deepEqual(Object.keys(row).sort(),['actionId','userId','toolId','state','startedAt','createdAt','updatedAt'].sort(),'notification snapshot exposes only safe state metadata');
    for(const secret of ['private appointment','private note','secret output',ownerAction.approvalHash,finished.approvalHash])assert(!JSON.stringify(snapshot).includes(secret));
    assert.equal((await ledger.listNotificationStates(other.sub,100))[0].state,'unknown');
    await Promise.all([service.close(),reopened.close()]);
    console.log('Notification PostgreSQL integration passed: concurrency, restart, settings merge, isolation, paging, tombstones and safe account-scoped action snapshots.');
  }finally{
    await pool?.end();
    if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
