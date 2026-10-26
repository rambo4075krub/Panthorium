'use strict';
const { createHash, randomBytes } = require('node:crypto');
const webpush = require('web-push');
const { GoogleAuth } = require('google-auth-library');
const catalog = require('../notification-event-catalog');
const { DEFAULT_SETTINGS } = require('./notificationService');
const { failure } = require('./notificationRepository');
const hash = value => createHash('sha256').update(value).digest('hex');
function validateSubscription(value) {
  if (!value || typeof value !== 'object') throw failure('invalid_push_subscription');
  if (value.kind === 'fcm') {
    if (typeof value.token !== 'string' || !/^[A-Za-z0-9_:.-]{30,4096}$/.test(value.token)) throw failure('invalid_push_subscription');
    if (value.popupChannels != null && value.popupChannels !== 2) throw failure('invalid_push_subscription');
    return { kind:'fcm', token:value.token, ...(value.popupChannels === 2 ? {popupChannels:2} : {}) };
  }
  let url; try { url = new URL(value.endpoint); } catch { throw failure('invalid_push_endpoint'); }
  const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || /^(?:[a-z0-9-]+\.)?push\.apple\.com$/.test(url.hostname);
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length>4096) throw failure('invalid_push_endpoint');
  for (const [name,size] of [['p256dh',65],['auth',16]]) {
    const key = value.keys?.[name];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key) || Buffer.from(key,'base64url').length !== size) throw failure('invalid_push_keys');
  }
  if (Buffer.from(value.keys.p256dh,'base64url')[0] !== 4) throw failure('invalid_push_keys');
  return { kind:'web', endpoint:url.href, keys:{p256dh:value.keys.p256dh,auth:value.keys.auth} };
}
function quiet(settings, now) {
  const q=settings.quietHours;
  if (!q?.enabled) return false;
  try {
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:q.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
    const at=parts.find(p=>p.type==='hour').value+':'+parts.find(p=>p.type==='minute').value;
    return q.start===q.end || (q.start<q.end ? at>=q.start&&at<q.end : at>=q.start||at<q.end);
  } catch { return true; }
}
class NotificationPushService {
  constructor({notifications,pool,now=Date.now,sendWeb=webpush.sendNotification.bind(webpush),fcmProject=process.env.PANTHORIUM_FCM_PROJECT_ID||'',sendFcm,authorizeOwner}={}) {
    this.notifications=notifications;this.pool=pool;this.now=now;this.sendWeb=sendWeb;this.fcmProject=fcmProject;this.sendFcm=sendFcm;this.authorizeOwner=authorizeOwner;this.ready=false;
    this.auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/firebase.messaging']});
  }
  async init() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_push_keys(id TEXT PRIMARY KEY,public_key TEXT NOT NULL,private_key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS panthorium_push_devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,subscription JSONB NOT NULL,binding TEXT NOT NULL,revoke_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_push_owner ON panthorium_push_devices(user_id);
      CREATE TABLE IF NOT EXISTS panthorium_push_deliveries(notification_id TEXT NOT NULL,device_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(notification_id,device_id));`);
    const keys=webpush.generateVAPIDKeys();
    await this.pool.query("INSERT INTO panthorium_push_keys(id,public_key,private_key) VALUES('v1',$1,$2) ON CONFLICT(id) DO NOTHING",[keys.publicKey,keys.privateKey]);
    const saved=(await this.pool.query("SELECT public_key,private_key FROM panthorium_push_keys WHERE id='v1'")).rows[0];
    this.vapid={subject:'https://panthorium.net',publicKey:saved.public_key,privateKey:saved.private_key};this.ready=true;
  }
  config() { return {ok:true,available:this.ready,publicKey:this.ready?this.vapid.publicKey:null,nativeAvailable:this.ready&&!!this.fcmProject}; }
  async status(user,id) {
    const uid=this.notifications.assertUser(user);
    if(!this.ready)return {ok:true,registered:false};
    if(!/^[a-f0-9]{64}$/.test(id||''))throw failure('invalid_push_device');
    const device=(await this.pool.query('SELECT id FROM panthorium_push_devices WHERE id=$1 AND user_id=$2 AND expires_at>NOW()',[id,uid])).rows[0];
    return {ok:true,registered:!!device};
  }
  async subscribe(user,input) {
    const uid=this.notifications.assertUser(user);if(!this.ready)throw failure('push_unavailable',503);
    const sub=validateSubscription(input?.subscription);if(sub.kind==='fcm'&&!this.fcmProject)throw failure('native_push_not_configured',503);
    const id=hash(sub.endpoint||sub.token), secret=randomBytes(32).toString('base64url'),binding=randomBytes(24).toString('base64url');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      // A device may be claimed concurrently by different accounts. Lock its
      // identity before the owner lock so an upsert cannot overwrite that claim.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['push-device:'+id]);
      // Serialize per-owner registration so device limits cannot be raced.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[uid]);
      const previous=(await client.query('SELECT user_id FROM panthorium_push_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(previous && previous.user_id!==uid)throw failure('push_device_already_bound',409);
      const count=Number((await client.query('SELECT COUNT(*) AS count FROM panthorium_push_devices WHERE user_id=$1',[uid])).rows[0].count);
      if(!previous&&count>=10)throw failure('push_device_limit',409);
      await client.query(`INSERT INTO panthorium_push_devices(id,user_id,subscription,binding,revoke_hash,expires_at) VALUES($1,$2,$3::jsonb,$4,$5,$6)
        ON CONFLICT(id) DO UPDATE SET subscription=EXCLUDED.subscription,binding=EXCLUDED.binding,revoke_hash=EXCLUDED.revoke_hash,expires_at=EXCLUDED.expires_at`,[id,uid,JSON.stringify({...sub,accountVersion:user.accountVersion||0}),binding,hash(secret),new Date(this.now()+90*86400000).toISOString()]);
      await client.query('COMMIT');return {ok:true,id,binding,revokeToken:secret};
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  async unsubscribe(user,id) { const uid=this.notifications.assertUser(user);if(!this.ready)throw failure('push_unavailable',503);if(!/^[a-f0-9]{64}$/.test(id||''))throw failure('invalid_push_device');await this.pool.query('DELETE FROM panthorium_push_devices WHERE id=$1 AND user_id=$2',[id,uid]);return {ok:true}; }
  async revoke(id,token) {
    if(!this.ready||!/^[a-f0-9]{64}$/.test(id||'')||!/^[A-Za-z0-9_-]{43}$/.test(token||''))throw failure('invalid_push_revocation');
    await this.pool.query('DELETE FROM panthorium_push_devices WHERE id=$1 AND revoke_hash=$2',[id,hash(token)]);return {ok:true};
  }
  async tick(userId=null) {
    if(!this.ready)return {processed:0};
    if(this.running)return this.running;
    this.running=this.drain(userId).finally(()=>{this.running=null;});return this.running;
  }
  async drain(userId) {
    // Recover from process crashes after event commit. Never replay history from before opt-in.
    await this.pool.query(`INSERT INTO panthorium_push_deliveries(notification_id,device_id)
      SELECT n.id,d.id FROM panthorium_notifications n JOIN panthorium_push_devices d ON d.user_id=n.user_id
      WHERE n.created_at>=d.created_at AND n.created_at>NOW()-INTERVAL '24 hours' AND d.expires_at>NOW() AND n.deleted_at IS NULL AND n.read_at IS NULL
      AND ($1::text IS NULL OR n.user_id=$1) AND NOT EXISTS (SELECT 1 FROM panthorium_push_deliveries p WHERE p.notification_id=n.id AND p.device_id=d.id)
      ORDER BY n.created_at LIMIT 1000 ON CONFLICT DO NOTHING`,[userId]);
    const jobs=(await this.pool.query(`WITH picked AS (SELECT notification_id,device_id FROM panthorium_push_deliveries
      WHERE state='queued' AND next_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW()) AND attempts<5
      ORDER BY next_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      UPDATE panthorium_push_deliveries d SET lease_until=NOW()+INTERVAL '2 minutes',attempts=d.attempts+1
      FROM picked p WHERE d.notification_id=p.notification_id AND d.device_id=p.device_id RETURNING d.*`)).rows;
    // Bounded concurrency, payload size, TTL and network deadline.
    for(let offset=0;offset<jobs.length;offset+=10)await Promise.all(jobs.slice(offset,offset+10).map(j=>this.deliver(j)));
    await this.pool.query("DELETE FROM panthorium_push_deliveries WHERE created_at<NOW()-INTERVAL '2 days'");
    await this.pool.query('DELETE FROM panthorium_push_devices WHERE expires_at<NOW()');
    return {processed:jobs.length};
  }
  async deliver(job) {
    const finish=state=>this.pool.query('UPDATE panthorium_push_deliveries SET state=$3,lease_until=NULL WHERE notification_id=$1 AND device_id=$2',[job.notification_id,job.device_id,state]);
    try {
      const d=(await this.pool.query('SELECT * FROM panthorium_push_devices WHERE id=$1 AND expires_at>NOW()',[job.device_id])).rows[0];
      if(!d)return finish('cancelled');
      const n=await this.notifications.repository.get(d.user_id,job.notification_id);
      const settings=await this.notifications.repository.getSettings(d.user_id,DEFAULT_SETTINGS);
      if(!n||n.readAt||this.now()-new Date(n.createdAt).getTime()>86400000||!catalog.enabled(settings,n)||!settings.channels.browser||quiet(settings,this.now()))return finish('suppressed');
      if(this.authorizeOwner && !await this.authorizeOwner(d.user_id,d.subscription.accountVersion||0))return finish('suppressed');
      if((n.type==='social.activity'||n.type.startsWith('social.activity.')) && await this.notifications.socialVisibility?.(d.user_id,n.sourceId)!==true)return finish('suppressed');
      const payload={v:1,binding:d.binding,id:n.id,title:'Panthorium',body:'มีการแจ้งเตือนใหม่ เปิด Panthorium เพื่อดูรายละเอียด',url:'/?notifications=1',silent:!settings.channels.sound};
      if(d.subscription.kind==='fcm') {
        if(!this.fcmProject)throw Error('native_push_unavailable');
        const channelId=settings.channels.sound?'panthorium_alerts':d.subscription.popupChannels===2?'panthorium_popups_silent_v2':'panthorium_silent';
        const message={token:d.subscription.token,notification:{title:payload.title,body:payload.body},data:{notificationId:n.id,binding:d.binding},android:{priority:'high',ttl:'3600s',notification:{tag:n.id,channel_id:channelId}}};
        if(this.sendFcm)await this.sendFcm(message);else { const client=await this.auth.getClient();await client.request({url:`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.fcmProject)}/messages:send`,method:'POST',data:{message},timeout:5000}); }
      }else await this.sendWeb(d.subscription,JSON.stringify(payload),{vapidDetails:this.vapid,TTL:3600,timeout:5000,urgency:'normal',topic:hash(n.id).slice(0,32)});
      await finish('accepted'); // provider acceptance is not proof of device receipt
    }catch(e){
      const status=e.statusCode||e.response?.status;const invalid=status===404||status===410||e.response?.data?.error?.details?.some(x=>x.errorCode==='UNREGISTERED');
      if(invalid){await this.pool.query('DELETE FROM panthorium_push_devices WHERE id=$1',[job.device_id]);await finish('expired');}
      else if(job.attempts>=5||status===400)await finish('failed');
      else await this.pool.query("UPDATE panthorium_push_deliveries SET lease_until=NULL,next_at=NOW()+($3*INTERVAL '1 second') WHERE notification_id=$1 AND device_id=$2",[job.notification_id,job.device_id,Math.min(900,30*2**job.attempts)]);
    }
  }
}
module.exports={NotificationPushService,validateSubscription,quiet};
