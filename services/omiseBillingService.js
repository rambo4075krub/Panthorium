'use strict';
const { randomUUID } = require('crypto');
const { getDatabasePool } = require('./databasePool');
const catalog = require('../billing-catalog');
class BillingError extends Error { constructor(code, status=503) { super(code); this.status=status; } }
const fail = (code, status) => { throw new BillingError(code, status); };
class OmiseBillingService {
  constructor({ databaseUrl=process.env.DATABASE_URL, databaseSslMode=process.env.DATABASE_SSL_MODE, secret=process.env.OMISE_SECRET_KEY, fetcher=global.fetch, pool }={}) {
    this.secret=String(secret || '').trim(); this.fetcher=fetcher;
    this.pool=pool || (databaseUrl ? getDatabasePool({connectionString:databaseUrl, ssl:databaseSslMode==='disable' ? false : {rejectUnauthorized:true}}) : null);
    this.ready=null; this.health=null;
  }
  configured() { return this.secret.startsWith('skey_test_') && !!this.pool; }
  async api(path, body) {
    if (!this.configured()) fail('checkout_not_configured');
    let response;
    try { response=await this.fetcher('https://api.omise.co'+path,{method:body ? 'POST':'GET',redirect:'error',headers:{Authorization:'Basic '+Buffer.from(this.secret+':').toString('base64'),'Omise-Version':'2019-05-29',...(body ? {'Content-Type':'application/x-www-form-urlencoded'} : {})},...(body ? {body:new URLSearchParams(body).toString()}:{}),signal:AbortSignal.timeout(20000)}); }
    catch { fail('omise_unavailable'); }
    const data=await response.json().catch(()=>null);
    if (!response.ok || !data || data.object==='error') fail(response.status===401 ? 'omise_auth_failed':'omise_request_failed');
    return data;
  }
  async init() {
    if (!this.configured()) fail('checkout_not_configured');
    if (!this.ready) this.ready=this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_omise_test_orders (
      id UUID PRIMARY KEY, user_id TEXT NOT NULL, request_key UUID NOT NULL,
      product_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'creating', charge_id TEXT UNIQUE, qr_url TEXT,
      expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,request_key));
      CREATE TABLE IF NOT EXISTS panthorium_omise_test_receipts (
      order_id UUID PRIMARY KEY REFERENCES panthorium_omise_test_orders(id), user_id TEXT NOT NULL,
      product_id TEXT NOT NULL, product_snapshot JSONB NOT NULL, valid_until TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`).catch(error=>{this.ready=null;throw error;});
    await this.ready;
  }
  async status() {
    if (!this.configured()) return {configured:false,connected:false,mode:'test',checkoutEnabled:false};
    if (this.health && this.health.until>Date.now()) return this.health.value;
    try { await this.init(); const a=await this.api('/account'); if (a.object!=='account') fail('omise_auth_failed');
      const value={configured:true,connected:true,mode:'test',checkoutEnabled:true,paymentMethods:['promptpay'],grantsRealEntitlements:false};this.health={until:Date.now()+60000,value};return value;
    } catch { return {configured:true,connected:false,mode:'test',checkoutEnabled:false}; }
  }
  view(row) { return {id:row.id,productId:row.product_id,amountSatang:row.amount,currency:row.currency,status:row.status,chargeId:row.charge_id,qrUrl:row.qr_url,expiresAt:row.expires_at,mode:'test',grantsRealEntitlements:false}; }
  async checkout(userId,productId,key) {
    const product=catalog.get(productId);
    if (!product || product.kind==='free') fail('invalid_product',400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '')) fail('invalid_request_key',400);
    await this.init();
    // Durable insert wins before any network call; duplicate/ambiguous requests never create another charge.
    const id=randomUUID();const inserted=await this.pool.query(`INSERT INTO panthorium_omise_test_orders(id,user_id,request_key,product_id,amount,currency) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,request_key) DO NOTHING RETURNING *`,[id,userId,key,product.id,product.amountSatang,product.currency]);
    if (!inserted.rows.length) { const old=await this.pool.query('SELECT * FROM panthorium_omise_test_orders WHERE user_id=$1 AND request_key=$2',[userId,key]);if(old.rows[0].product_id!==productId) fail('request_key_conflict',409);return this.view(old.rows[0]); }
    try {
      const charge=await this.api('/charges',{amount:String(product.amountSatang),currency:'THB','source[type]':'promptpay','metadata[panthorium_order_id]':id,description:'Panthorium TEST '+product.name,expires_at:new Date(Date.now()+30*60000).toISOString()});
      return await this.reconcile(charge,id);
    } catch(error) { await this.pool.query("UPDATE panthorium_omise_test_orders SET status='verification_required',updated_at=NOW() WHERE id=$1 AND status='creating'",[id]);throw error; }
  }
  async reconcile(charge,id) {
    if (!charge || charge.object!=='charge' || charge.livemode!==false || !/^chrg_test_[a-z0-9]+$/i.test(charge.id || '')) fail('invalid_charge',400);
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) fail('invalid_order',400);
    const client=await this.pool.connect();
    try { await client.query('BEGIN');const result=await client.query('SELECT * FROM panthorium_omise_test_orders WHERE id=$1 FOR UPDATE',[id]);const row=result.rows[0];
      if (!row) fail('order_not_found',404);
      if (row.amount!==charge.amount || row.currency.toLowerCase()!==String(charge.currency).toLowerCase() || charge.metadata?.panthorium_order_id!==id || (row.charge_id && row.charge_id!==charge.id)) fail('charge_mismatch',409);
      let status=charge.status==='successful' && charge.paid===true ? 'paid' : ['pending','failed','expired'].includes(charge.status) ? charge.status : 'verification_required';
      if (Number(charge.refunded_amount)>0 || charge.reversed===true || charge.voided===true) status='refunded';
      // A stale callback cannot demote an already settled order.
      if (row.status==='refunded' || (row.status==='paid' && status!=='refunded')) status=row.status;
      let qr=charge.source?.scannable_code?.image?.download_uri || null;
      if(qr) { const url=new URL(qr);if(url.protocol!=='https:' || url.hostname!=='api.omise.co' || !url.pathname.startsWith('/charges/'+charge.id+'/documents/')) fail('invalid_qr_url',400); }
      const updated=await client.query('UPDATE panthorium_omise_test_orders SET status=$2,charge_id=$3,qr_url=$4,expires_at=$5,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status,charge.id,qr,charge.expires_at || null]);
      if(status==='paid') await client.query(`INSERT INTO panthorium_omise_test_receipts(order_id,user_id,product_id,product_snapshot,valid_until) VALUES($1,$2,$3,$4,NOW()+INTERVAL '30 days') ON CONFLICT(order_id) DO NOTHING`,[id,row.user_id,row.product_id,JSON.stringify(catalog.get(row.product_id))]);
      if(status==='refunded') await client.query('DELETE FROM panthorium_omise_test_receipts WHERE order_id=$1',[id]);
      await client.query('COMMIT');return this.view(updated.rows[0]);
    } catch(error) {await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async order(userId,id) {
    await this.init();if(!/^[0-9a-f-]{36}$/i.test(id || '')) fail('invalid_order',400);
    const result=await this.pool.query('SELECT * FROM panthorium_omise_test_orders WHERE id=$1 AND user_id=$2',[id,userId]);if(!result.rows[0]) fail('order_not_found',404);
    const row=result.rows[0];if(row.charge_id) return this.reconcile(await this.api('/charges/'+row.charge_id),row.id);
    return this.view(row);
  }
  async webhook(eventId) {
    if(!/^evnt_test_[a-z0-9]+$/i.test(eventId || '')) fail('invalid_event',400);
    await this.init();const event=await this.api('/events/'+eventId);
    if(event.object!=='event' || event.id!==eventId || event.livemode!==false) fail('invalid_event',400);
    if(!/^chrg_test_[a-z0-9]+$/i.test(event.data?.id || '')) return {ignored:true};
    const charge=await this.api('/charges/'+event.data.id);
    if(!charge.metadata?.panthorium_order_id) return {ignored:true};
    await this.reconcile(charge,charge.metadata.panthorium_order_id);return {verified:true};
  }
}
module.exports={OmiseBillingService,BillingError};
