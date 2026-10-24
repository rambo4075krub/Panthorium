'use strict';
const { randomUUID } = require('crypto');
const { getDatabasePool } = require('./databasePool');
const catalog = require('../billing-catalog');
class BillingError extends Error { constructor(code, status=503) { super(code); this.status=status; } }
const fail = (code, status) => { throw new BillingError(code, status); };
class OmiseBillingService {
  constructor({ databaseUrl=process.env.DATABASE_URL, databaseSslMode=process.env.DATABASE_SSL_MODE, secret=process.env.OMISE_SECRET_KEY, mode=process.env.OMISE_MODE || 'test', liveEnabled=process.env.OMISE_LIVE_ENABLED === '1', fetcher=global.fetch, pool, notifications = null }={}) {
    this.secret=String(secret || '').trim(); this.fetcher=fetcher;
    this.notifications=notifications;
    this.mode=mode; this.liveEnabled=liveEnabled; this.live=mode==='live';
    this.orders=this.live ? 'panthorium_omise_live_orders':'panthorium_omise_test_orders';
    this.receipts=this.live ? 'panthorium_omise_live_receipts':'panthorium_omise_test_receipts';
    this.pool=pool || (databaseUrl ? getDatabasePool({connectionString:databaseUrl, ssl:databaseSslMode==='disable' ? false : {rejectUnauthorized:true}}) : null);
    this.ready=null; this.health=null;
  }
  configured() { return !!this.pool && (this.mode==='test' ? this.secret.startsWith('skey_test_') : this.live && this.liveEnabled && /^skey_(?!test_)[a-z0-9]+$/i.test(this.secret)); }
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
    if (!this.ready) this.ready=this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.orders} (
      id UUID PRIMARY KEY, user_id TEXT NOT NULL, request_key UUID NOT NULL,
      product_id TEXT NOT NULL, product_snapshot JSONB, amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'creating', charge_id TEXT UNIQUE, qr_url TEXT,
      expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,request_key));
      CREATE TABLE IF NOT EXISTS ${this.receipts} (
      order_id UUID PRIMARY KEY REFERENCES ${this.orders}(id), user_id TEXT NOT NULL,
      product_id TEXT NOT NULL, product_snapshot JSONB NOT NULL, valid_until TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      ALTER TABLE ${this.orders} ADD COLUMN IF NOT EXISTS product_snapshot JSONB;`).catch(error=>{this.ready=null;throw error;});
    await this.ready;
    // Initialize the entitlement schema on staging as well, without granting Test purchases.
    if(this.pool && this.live) {
      await this.entitlements().init();
      await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS panthorium_pending_membership ON panthorium_omise_live_orders(user_id) WHERE product_id IN ('life','work','work-pro') AND status IN ('creating','pending','verification_required')`);
    }
  }
  async status() {
    if (!this.configured()) return {configured:false,connected:false,mode:this.mode,checkoutEnabled:false};
    if (this.health && this.health.until>Date.now()) return this.health.value;
    try { await this.init(); const a=await this.api('/account'); if (a.object!=='account' || (typeof a.livemode==='boolean' && a.livemode!==this.live)) fail('omise_auth_failed');
      const value={configured:true,connected:true,mode:this.mode,checkoutEnabled:true,paymentMethods:['promptpay'],grantsRealEntitlements:this.live};this.health={until:Date.now()+60000,value};return value;
    } catch { return {configured:true,connected:false,mode:this.mode,checkoutEnabled:false}; }
  }
  view(row) { return {id:row.id,productId:row.product_id,amountSatang:row.amount,currency:row.currency,status:row.status,chargeId:row.charge_id,qrUrl:row.qr_url,expiresAt:row.expires_at,mode:this.mode,grantsRealEntitlements:this.live}; }
  entitlements() { if(!this.entitlementService) {const {EntitlementService}=require('./entitlementService');this.entitlementService=new EntitlementService({pool:this.pool});}return this.entitlementService; }
  paidAt(charge) { if(this.live && !charge.paid_at)fail('invalid_charge',400);const value=new Date(charge.paid_at || charge.authorized_at || charge.created_at || Date.now());if(!Number.isFinite(value.getTime()) || value.getTime()>Date.now()+60000) fail('invalid_charge',400);return value.toISOString(); }
  async grant(client,row,charge) { await this.entitlements().grant(client,row,this.paidAt(charge)); }
  async checkout(userId,productId,key) {
    const product=catalog.get(productId);
    if (!product || product.kind==='free') fail('invalid_product',400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '')) fail('invalid_request_key',400);
    await this.init();
    // Durable insert wins before any network call; duplicate/ambiguous requests never create another charge.
    const id=randomUUID();let inserted;
    try { inserted=await this.pool.query(`INSERT INTO ${this.orders}(id,user_id,request_key,product_id,amount,currency,product_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,request_key) DO NOTHING RETURNING *`,[id,userId,key,product.id,product.amountSatang,product.currency,JSON.stringify(product)]); }
    catch(error){if(error.code==='23505')fail('pending_membership_exists',409);throw error;}
    if (!inserted.rows.length) { const old=await this.pool.query(`SELECT * FROM ${this.orders} WHERE user_id=$1 AND request_key=$2`,[userId,key]);if(old.rows[0].product_id!==productId) fail('request_key_conflict',409);return this.view(old.rows[0]); }
    try {
      if(this.live) await this.entitlements().checkPurchase(userId,product);
      const charge=await this.api('/charges',{amount:String(product.amountSatang),currency:'THB','source[type]':'promptpay','metadata[panthorium_order_id]':id,description:'Panthorium '+(this.live ? '' : 'TEST ')+product.name,expires_at:new Date(Date.now()+30*60000).toISOString()});
      return await this.reconcile(charge,id);
    } catch(error) {
      if(['paid_membership_required','membership_already_active'].includes(error.message))await this.pool.query(`UPDATE ${this.orders} SET status='failed',updated_at=NOW() WHERE id=$1 AND status='creating'`,[id]);
      else await this.pool.query(`UPDATE ${this.orders} SET status='verification_required',updated_at=NOW() WHERE id=$1 AND status='creating'`,[id]);throw error;
    }
  }
  async reconcile(charge,id) {
    if (!charge || charge.object!=='charge' || charge.livemode!==this.live || !(this.live ? /^chrg_(?!test_)[a-z0-9]+$/i : /^chrg_test_[a-z0-9]+$/i).test(charge.id || '')) fail('invalid_charge',400);
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) fail('invalid_order',400);
    const client=await this.pool.connect();
    let saved;
    try { await client.query('BEGIN');const result=await client.query(`SELECT * FROM ${this.orders} WHERE id=$1 FOR UPDATE`,[id]);const row=result.rows[0];
      if (!row) fail('order_not_found',404);
      if (row.amount!==charge.amount || row.currency.toLowerCase()!==String(charge.currency).toLowerCase() || charge.metadata?.panthorium_order_id!==id || (row.charge_id && row.charge_id!==charge.id)) fail('charge_mismatch',409);
      let status=charge.status==='successful' && charge.paid===true ? 'paid' : ['pending','failed','expired'].includes(charge.status) ? charge.status : 'verification_required';
      if (Number(charge.refunded_amount)>0 || charge.reversed===true || charge.voided===true) status='refunded';
      // A stale callback cannot demote an already settled order.
      if (row.status==='refunded' || (row.status==='paid' && status!=='refunded')) status=row.status;
      let qr=charge.source?.scannable_code?.image?.download_uri || null;
      if(qr) { const url=new URL(qr);if(url.protocol!=='https:' || url.hostname!=='api.omise.co' || !url.pathname.startsWith('/charges/'+charge.id+'/documents/')) fail('invalid_qr_url',400); }
      const updated=await client.query(`UPDATE ${this.orders} SET status=$2,charge_id=$3,qr_url=$4,expires_at=$5,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,status,charge.id,qr,charge.expires_at || null]);
      if(status==='paid') await client.query(`INSERT INTO ${this.receipts}(order_id,user_id,product_id,product_snapshot,valid_until) VALUES($1,$2,$3,$4,$5::timestamptz+$6::interval) ON CONFLICT(order_id) DO NOTHING`,[id,row.user_id,row.product_id,JSON.stringify(row.product_snapshot || catalog.get(row.product_id)),this.paidAt(charge),this.live && (row.product_snapshot || catalog.get(row.product_id)).kind==='subscription' ? '1 month':'30 days']);
      if (this.live && status==='paid') await this.grant(client, row, charge);
      if (this.live && status==='refunded') {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['billing:'+row.user_id]);
        await client.query('UPDATE panthorium_entitlement_grants SET revoked_at=NOW() WHERE order_id=$1 AND revoked_at IS NULL',[id]);
      }
      if(!this.live && status==='refunded') await client.query(`DELETE FROM ${this.receipts} WHERE order_id=$1`,[id]);
      await client.query('COMMIT');saved=updated.rows[0];
    } catch(error) {await client.query('ROLLBACK');throw error;}finally{client.release();}
    // Publish after commit and release, so delivery never holds the billing lock.
    // The stable status key permits safe retry on verified webhook/order reads.
    await this.notifyOrder(saved);
    return this.view(saved);
  }
  async notifyOrder(row) {
    const labels = {
      pending: ['รอการชำระเงิน', 'คำสั่งซื้อของคุณรอการชำระเงิน ตรวจรายละเอียดในแพ็กเกจและชำระเงิน'],
      paid: ['ยืนยันการชำระเงินแล้ว', 'ผู้ให้บริการยืนยันการชำระเงินแล้ว ตรวจใบเสร็จและสิทธิ์ในแพ็กเกจและชำระเงิน'],
      failed: ['การชำระเงินไม่สำเร็จ', 'ผู้ให้บริการแจ้งว่าการชำระเงินไม่สำเร็จ ตรวจสถานะก่อนเริ่มรายการใหม่'],
      expired: ['คำสั่งชำระเงินหมดอายุ', 'คำสั่งชำระเงินหมดอายุแล้ว ตรวจรายละเอียดในแพ็กเกจและชำระเงิน'],
      refunded: ['สถานะการชำระเงินเปลี่ยนแล้ว', 'คำสั่งซื้อมีการคืนเงินหรือยกเลิกการชำระ ตรวจสถานะและสิทธิ์ในแพ็กเกจและชำระเงิน'],
      verification_required: ['กำลังตรวจสอบการชำระเงิน', 'ยังยืนยันผลการชำระเงินไม่ได้ ตรวจสถานะก่อนเริ่มรายการใหม่'],
    };
    const label=labels[row?.status];
    if(!label) return;
    const prefix=this.live ? '' : 'ทดสอบ: ';
    try { await this.notifications?.publish({ userId:row.user_id,category:'billing',type:'billing.'+row.status,
      title:prefix+label[0],body:prefix+label[1]+(this.live ? '' : ' รายการทดสอบไม่มอบสิทธิ์ใช้งานจริง'),
      sourceId:this.mode+':'+row.id+':'+row.status,severity:['failed','expired','verification_required'].includes(row.status) ? 'warning' : 'info',sensitive:true }); }
    catch { /* Verified payment state remains committed even if notification storage is unavailable. */ }
  }
  async order(userId,id) {
    await this.init();if(!/^[0-9a-f-]{36}$/i.test(id || '')) fail('invalid_order',400);
    const result=await this.pool.query(`SELECT * FROM ${this.orders} WHERE id=$1 AND user_id=$2`,[id,userId]);if(!result.rows[0]) fail('order_not_found',404);
    const row=result.rows[0];if(row.charge_id) return this.reconcile(await this.api('/charges/'+row.charge_id),row.id);
    return this.view(row);
  }
  async qr(userId,id) {
    const order=await this.order(userId,id);
    if(order.status!=='pending' || !order.qrUrl)fail('qr_unavailable',409);
    let url=order.qrUrl;
    for(let hop=0;hop<3;hop++){
      const parsed=new URL(url);
      if(parsed.protocol!=='https:' || !['api.omise.co','cdn.omise.co'].includes(parsed.hostname) || parsed.username || parsed.password || (parsed.port && parsed.port!=='443'))fail('invalid_qr_url',400);
      let response;try{response=await this.fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'image/svg+xml,image/png',...(hop===0 ? {Authorization:'Basic '+Buffer.from(this.secret+':').toString('base64')}: {})}});}catch{fail('qr_unavailable');}
      if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)fail('qr_unavailable');url=new URL(location,url).href;continue;}
      const type=String(response.headers.get('content-type')||'').split(';')[0];
      if(!response.ok || !['image/svg+xml','image/png'].includes(type) || Number(response.headers.get('content-length'))>1024*1024)fail('qr_unavailable');
      const reader=response.body.getReader();const parts=[];let size=0;
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();fail('qr_unavailable');}parts.push(Buffer.from(value));}
      if(!size)fail('qr_unavailable');return {body:Buffer.concat(parts),type};
    }
    fail('qr_unavailable');
  }
  async webhook(eventId) {
    if(!(this.live ? /^evnt_(?!test_)[a-z0-9]+$/i : /^evnt_test_[a-z0-9]+$/i).test(eventId || '')) fail('invalid_event',400);
    await this.init();const event=await this.api('/events/'+eventId);
    if(event.object!=='event' || event.id!==eventId || event.livemode!==this.live) fail('invalid_event',400);
    const chargeId=event.data?.object==='refund' ? event.data.charge : event.data?.id;
    if(!(this.live ? /^chrg_(?!test_)[a-z0-9]+$/i : /^chrg_test_[a-z0-9]+$/i).test(chargeId || '')) return {ignored:true};
    const charge=await this.api('/charges/'+chargeId);
    if(!charge.metadata?.panthorium_order_id) return {ignored:true};
    await this.reconcile(charge,charge.metadata.panthorium_order_id);return {verified:true};
  }
}
module.exports={OmiseBillingService,BillingError};
