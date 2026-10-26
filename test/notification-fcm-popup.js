'use strict';
const assert=require('node:assert/strict');
const {NotificationPushService,validateSubscription}=require('../services/notificationPushService');
const {DEFAULT_SETTINGS}=require('../services/notificationService');
(async()=>{
  const subscription={kind:'fcm',token:'token-'.repeat(20),popupChannels:2};
  assert.equal(validateSubscription(subscription).popupChannels,2);
  assert.throws(()=>validateSubscription({...subscription,popupChannels:999}));
  const messages=[],states=[];let sound=false;
  const d={user_id:'user',binding:'b'.repeat(32),subscription};
  const pool={query:async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM panthorium_push_devices'))return {rows:[d]};
    if(sql.startsWith('UPDATE panthorium_push_deliveries'))states.push(args[2]);
    return {rows:[]};
  }};
  const notification={id:'notice_'+'a'.repeat(64),type:'system.notice',category:'system',createdAt:new Date().toISOString()};
  const service=new NotificationPushService({pool,fcmProject:'test-project',notifications:{repository:{get:async()=>notification,getSettings:async()=>({...DEFAULT_SETTINGS,channels:{...DEFAULT_SETTINGS.channels,browser:true,sound}})}},sendFcm:async message=>messages.push(message)});
  const job={notification_id:notification.id,device_id:'device',attempts:1};
  await service.deliver(job);assert.equal(messages[0].android.notification.channel_id,'panthorium_popups_silent_v2');assert(!('channelId' in messages[0].android.notification));assert.equal(states[0],'accepted');
  sound=true;await service.deliver(job);assert.equal(messages[1].android.notification.channel_id,'panthorium_alerts');
  sound=false;delete d.subscription.popupChannels;await service.deliver(job);assert.equal(messages[2].android.notification.channel_id,'panthorium_silent','older APKs must not be sent to a channel they cannot create');
  console.log('FCM popup delivery: validated channel capability, REST channel_id, silent/alert selection and old APK compatibility passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
