'use strict';
const catalog = require('../billing-catalog');
const dayKey=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const KEYS = ['voiceInputSeconds','voiceOutputSeconds','textInputTokens','textOutputTokens','downloadBytes'];
class EntitlementError extends Error { constructor(message,status=403){super(message);this.status=status;} }
class EntitlementService {
  constructor({pool}) { this.pool=pool;this.ready=null; }
  async init(){
    if(!this.pool)throw new EntitlementError('entitlements_unavailable',503);
    if(!this.ready)this.ready=this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_entitlement_grants (
      order_id UUID PRIMARY KEY, user_id TEXT NOT NULL, product_id TEXT NOT NULL,
      snapshot JSONB NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
      used JSONB NOT NULL DEFAULT '{}', revoked_at TIMESTAMPTZ,
      CHECK(ends_at>starts_at));
      CREATE INDEX IF NOT EXISTS panthorium_entitlement_owner ON panthorium_entitlement_grants(user_id,ends_at);
      CREATE TABLE IF NOT EXISTS panthorium_free_usage (
      user_id TEXT NOT NULL, period TEXT NOT NULL, used JSONB NOT NULL DEFAULT '{}',
      PRIMARY KEY(user_id,period));`).catch(e=>{this.ready=null;throw e;});
    await this.ready;
  }
  async locked(userId,fn){
    await this.init();const c=await this.pool.connect();
    try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['billing:'+userId]);const result=await fn(c);await c.query('COMMIT');return result;}
    catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async active(c,userId){return (await c.query('SELECT * FROM panthorium_entitlement_grants WHERE user_id=$1 AND revoked_at IS NULL AND starts_at<=NOW() AND ends_at>NOW() ORDER BY ends_at,order_id',[userId])).rows;}
  async checkPurchase(userId,product){
    await this.init();const rows=await this.active(this.pool,userId);
    if(product.paidMembershipRequired && !rows.some(r=>r.snapshot.category==='membership'))throw new EntitlementError('paid_membership_required');
    // PromptPay renewals are paid manually. Avoid changing or stacking an active base plan.
    if(product.category==='membership' && rows.some(r=>r.snapshot.category==='membership'))throw new EntitlementError('membership_already_active',409);
  }
  async grant(c,row,paidAt){
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['billing:'+row.user_id]);
    const product=row.product_snapshot;if(!product || product.id!==row.product_id)throw new EntitlementError('invalid_product',400);
    // Order ID is the idempotency boundary; expiration is provider payment time, never callback time.
    await c.query(`INSERT INTO panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at)
      VALUES($1,$2,$3,$4,$5::timestamptz,$5::timestamptz+$6::interval) ON CONFLICT(order_id) DO NOTHING`,[row.id,row.user_id,row.product_id,JSON.stringify(product),paidAt,product.kind==='subscription' ? '1 month':'30 days']);
  }
  async state(userId){return this.locked(userId,async c=>{
    const rows=await this.active(c,userId);const membership=rows.filter(r=>r.snapshot.category==='membership').sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at))[0];
    const applicable=rows.filter(r=>r.snapshot.category!=='membership' || r.order_id===membership?.order_id);
    const period=dayKey().slice(0,7);
    const free=membership ? {} : (await c.query('SELECT used FROM panthorium_free_usage WHERE user_id=$1 AND period=$2',[userId,period])).rows[0]?.used || {};
    const remaining={...(!membership ? catalog.get('free').quotas : {})};
    for(const k of KEYS)remaining[k]=Math.max(0,(remaining[k]||0)-(Number(free[k])||0));
    if(!membership){const daily=free.day===dayKey() ? Math.max(0,60-(free.dailyVoiceSeconds||0)) : 60;remaining.voiceInputSeconds=Math.min(remaining.voiceInputSeconds,daily);remaining.voiceOutputSeconds=Math.min(remaining.voiceOutputSeconds,daily);}
    for(const r of applicable)for(const [k,v] of Object.entries(r.snapshot.quotas || {}))remaining[k]=(remaining[k]||0)+Math.max(0,v-(Number(r.used[k])||0));
    return {plan:membership?.product_id || 'free',startsAt:membership?.starts_at || null,expiresAt:membership?.ends_at || null,remaining,grants:applicable.map(r=>({productId:r.product_id,startsAt:r.starts_at,expiresAt:r.ends_at})),automaticRenewal:false};
  });}
  async consume(userId,amounts){
    for(const [k,v] of Object.entries(amounts))if(!KEYS.includes(k)||!Number.isSafeInteger(v)||v<0)throw new EntitlementError('invalid_usage',400);
    return this.locked(userId,async c=>{
      const rows=await this.active(c,userId);const membership=rows.filter(r=>r.snapshot.category==='membership').sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at))[0];
      const applicable=rows.filter(r=>r.snapshot.category!=='membership' || r.order_id===membership?.order_id);
      const period=dayKey().slice(0,7);
      let free={};if(!membership){await c.query('INSERT INTO panthorium_free_usage(user_id,period) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,period]);free=(await c.query('SELECT used FROM panthorium_free_usage WHERE user_id=$1 AND period=$2 FOR UPDATE',[userId,period])).rows[0].used;}
      let dailyAdded=0;
      for(const [k,requested] of Object.entries(amounts)){
        let left=requested;
        // Earliest expiry first, including add-ons. Transaction rolls all dimensions back on exhaustion.
        for(const r of applicable){const avail=Math.max(0,(r.snapshot.quotas?.[k]||0)-(Number(r.used[k])||0));const take=Math.min(left,avail);r.used[k]=(Number(r.used[k])||0)+take;left-=take;if(!left)break;}
        if(left&&!membership){const take=Math.min(left,Math.max(0,(catalog.get('free').quotas[k]||0)-(Number(free[k])||0)));free[k]=(Number(free[k])||0)+take;left-=take;if(k.startsWith('voice'))dailyAdded+=take;}
        if(left)throw new EntitlementError('quota_exceeded:'+k,402);
      }
      if(!membership && dailyAdded){const day=dayKey();const used=free.day===day ? (Number(free.dailyVoiceSeconds)||0) : 0;if(used+dailyAdded>60)throw new EntitlementError('quota_exceeded:dailyVoiceSeconds',402);free.day=day;free.dailyVoiceSeconds=used+dailyAdded;}
      for(const r of applicable)await c.query('UPDATE panthorium_entitlement_grants SET used=$2 WHERE order_id=$1',[r.order_id,JSON.stringify(r.used)]);
      if(!membership)await c.query('UPDATE panthorium_free_usage SET used=$3 WHERE user_id=$1 AND period=$2',[userId,period,JSON.stringify(free)]);
      return {ok:true};
    });
  }
}
module.exports={EntitlementService,EntitlementError};
