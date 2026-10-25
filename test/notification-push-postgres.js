'use strict';
const assert=require('node:assert/strict');
const {randomBytes,createECDH}=require('node:crypto');
const {Pool}=require('pg');
const {NotificationRepository}=require('../services/notificationRepository');
const {NotificationService}=require('../services/notificationService');
const {NotificationPushService}=require('../services/notificationPushService');
(async()=>{
  if(!process.env.TEST_DATABASE_URL){if(process.env.CI)throw Error('TEST_DATABASE_URL required');console.log('SKIP push PostgreSQL: no database');return;}
  const schema='push_ci_'+randomBytes(8).toString('hex'),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});let pool;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:12,options:`-c search_path=${schema},public -c statement_timeout=15000`});
    const service=new NotificationService({repository:new NotificationRepository({pool,required:true})});await service.init();
    const sent=[];let unavailable=false,authorized=true,visible=true;
    service.socialVisibility=async()=>visible;
    const push=new NotificationPushService({notifications:service,pool,authorizeOwner:async()=>authorized,sendWeb:async(sub,payload)=>{if(unavailable)throw {statusCode:503};sent.push({sub,payload:JSON.parse(payload)});}});await push.init();
    const user={sub:'a',roles:['user'],permissions:['chat']},other={...user,sub:'b'};
    await service.updateSettings({user,patch:{channels:{browser:true}}});
    const ec=createECDH('prime256v1');ec.generateKeys();
    const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/'+randomBytes(16).toString('hex'),keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
    await service.publish({userId:'a',title:'Before opt-in'});
    const device=await push.subscribe(user,{subscription});
    assert(!JSON.stringify(push.config()).includes(push.vapid.privateKey));
    const restarted=new NotificationPushService({notifications:service,pool,sendWeb:async(sub,payload)=>sent.push({sub,payload:JSON.parse(payload)})});await restarted.init();assert.equal(restarted.vapid.publicKey,push.vapid.publicKey,'VAPID survives restart');
    await assert.rejects(push.subscribe(other,{subscription}),{code:'push_device_already_bound'});
    const notice=()=>service.publish({userId:'a',category:'social',type:'social.activity.message',title:'PRIVATE TITLE',body:'PRIVATE BODY',sourceId:randomBytes(10).toString('hex')});
    await notice();await Promise.all([push.tick(),push.tick()]);assert.equal(sent.length,1,'new notice delivered once; old history not replayed');assert(!JSON.stringify(sent[0].payload).includes('PRIVATE'));
    await restarted.tick();assert.equal(sent.length,1,'restart does not redeliver accepted jobs');
    await service.updateSettings({user,patch:{events:{social_message:false}}});await notice();await push.tick();assert.equal(sent.length,1);
    await service.updateSettings({user,patch:{events:{social_message:true},quietHours:{enabled:true,start:'00:00',end:'00:00'}}});await notice();await push.tick();assert.equal(sent.length,1);
    await service.updateSettings({user,patch:{quietHours:{enabled:false}}});visible=false;await notice();await push.tick();assert.equal(sent.length,1);
    visible=true;authorized=false;await notice();await push.tick();assert.equal(sent.length,1);authorized=true;
    unavailable=true;await notice();await push.tick();assert.equal(sent.length,1);unavailable=false;
    await pool.query("UPDATE panthorium_push_deliveries SET next_at=NOW() WHERE state='queued'");await push.tick();assert.equal(sent.length,2,'transient failure retries durably');
    await push.revoke(device.id,randomBytes(32).toString('base64url'));assert.equal(Number((await pool.query('SELECT COUNT(*) count FROM panthorium_push_devices')).rows[0].count),1,'wrong revoke capability cannot remove device');
    await push.revoke(device.id,device.revokeToken);await notice();await push.tick();assert.equal(sent.length,2,'logout revokes delivery');
    const raceSubscription={...subscription,endpoint:subscription.endpoint+'-owner-race'};
    const ownerRace=await Promise.allSettled([push.subscribe(user,{subscription:raceSubscription}),push.subscribe(other,{subscription:raceSubscription})]);
    assert.equal(ownerRace.filter(x=>x.status==='fulfilled').length,1,'only one account may claim a device concurrently');
    assert.equal(ownerRace.find(x=>x.status==='rejected').reason.code,'push_device_already_bound');
    const winner=ownerRace.find(x=>x.status==='fulfilled').value;await push.revoke(winner.id,winner.revokeToken);
    const limited=await Promise.allSettled(Array.from({length:12},(_,i)=>push.subscribe(user,{subscription:{...subscription,endpoint:subscription.endpoint+'-'+i}})));
    assert.equal(limited.filter(x=>x.status==='fulfilled').length,10,'concurrent subscriptions respect per-owner limit');
    await service.close();console.log('Push PostgreSQL: restart, atomic claiming, consent, event and quiet filters, privacy, authorization, revocation, retries and device limits passed');
  }finally{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
