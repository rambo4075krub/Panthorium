'use strict';
const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { GoogleAuth } = require('google-auth-library');
const catalog = require('../billing-catalog');
const { CheckoutOrderStore, fail } = require('./checkoutOrderStore');
const PACKAGE = 'com.panthorium.browser';
const hash = value => createHash('sha256').update(value).digest('hex');
const accountId = userId => hash('panthorium:play:account:' + userId);
const sku = productId => 'panthorium_' + productId.replaceAll('-','_');
function money(value) {
  if (value?.currencyCode !== 'THB' || !/^\d+$/.test(String(value.units || '0')) || !Number.isInteger(value.nanos || 0) || (value.nanos || 0) < 0 || (value.nanos || 0) >= 1e9 || (value.nanos || 0) % 1e7) fail('payment_mismatch',409);
  const amount = Number(value.units || 0) * 100 + (value.nanos || 0) / 1e7;
  if (!Number.isSafeInteger(amount) || amount < 0) fail('payment_mismatch',409); return amount;
}
class GooglePlayBillingService {
  constructor({pool,notifications,enabled=process.env.GOOGLE_PLAY_BILLING_ENABLED==='1',mode=process.env.GOOGLE_PLAY_BILLING_MODE||'test',encryptionKey=process.env.GOOGLE_PLAY_RECEIPT_KEY||'',keyFile=process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE,client,store}={}) {
    this.provider='google_play';this.pool=pool;this.enabled=enabled;this.mode=mode;this.live=mode==='live';this.encryptionKey=encryptionKey;
    this.store=store||new CheckoutOrderStore({pool,live:this.live,notifications});this.receipts=this.live?'panthorium_play_live_receipts':'panthorium_play_test_receipts';
    this.auth=client?null:new GoogleAuth({...(keyFile?{keyFile}:{}),scopes:['https://www.googleapis.com/auth/androidpublisher']});this.client=client;
  }
  configured(){return !!(this.enabled&&this.pool&&['live','test'].includes(this.mode)&&/^[0-9a-f]{64}$/i.test(this.encryptionKey));}
  requireConfig(){if(!this.configured())fail('checkout_not_configured');}
  async init(){this.requireConfig();await this.store.init();if(!this.ready)this.ready=this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.receipts}(order_id UUID PRIMARY KEY REFERENCES ${this.store.orders}(id),token_hash TEXT UNIQUE NOT NULL,encrypted_token TEXT NOT NULL,consumed BOOLEAN NOT NULL DEFAULT FALSE,checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).catch(error=>{this.ready=null;throw error;});await this.ready;}
  async api(path,method='GET') {
    this.client ||= await this.auth.getClient();
    try { return (await this.client.request({url:'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+PACKAGE+path,method,...(method==='POST'?{data:{}}:{}),timeout:20000,retry:method==='GET'})).data; }
    catch { fail('google_play_unavailable'); }
  }
  async status(){
    const products = catalog.products.filter(p => p.kind !== 'free' && !p.purchasePaused)
      .map(p => ({productId:p.id,storeProductId:sku(p.id),amountMicros:p.amountSatang*10000,currency:p.currency}));
    const base={provider:this.provider,policyVersion:require('../privacy-notice').version,mode:this.mode,configured:this.configured(),checkoutEnabled:false,connected:false,automaticRenewal:false,packageName:PACKAGE,products};
    if(!base.configured)return base;
    if(!this.health||Date.now()-this.health.at>60000){
      this.healthCheck ??= this.api('/oneTimeProducts/'+sku('life')).then(
        p=>{this.health={at:Date.now(),ok:p.productId===sku('life')&&p.packageName===PACKAGE};},
        ()=>{this.health={at:Date.now(),ok:false};}
      ).finally(()=>{this.healthCheck=null;});
      await this.healthCheck;
    }
    return {...base,checkoutEnabled:this.health.ok,connected:this.health.ok};
  }
  seal(token,orderId){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(this.encryptionKey,'hex'),iv);c.setAAD(Buffer.from(orderId));const data=Buffer.concat([c.update(token,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64');}
  unseal(value,orderId){const bytes=Buffer.from(value,'base64'),c=createDecipheriv('aes-256-gcm',Buffer.from(this.encryptionKey,'hex'),bytes.subarray(0,12));c.setAAD(Buffer.from(orderId));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString('utf8');}
  async prepare(userId,productId,requestKey){await this.init();const row=await this.store.begin(this.provider,userId,productId,requestKey);return {...this.store.view(row),storeProductId:sku(row.product_id),accountId:accountId(userId)};}
  async verify(userId,orderId,token){
    await this.init();if(typeof token!=='string'||token.length<8||token.length>8192||/[\s\u0000-\u001f]/.test(token))fail('invalid_purchase',400);
    const row=await this.store.get(orderId,this.provider,userId);
    const purchase=await this.api('/purchases/products/'+encodeURIComponent(sku(row.product_id))+'/tokens/'+encodeURIComponent(token));
    if(purchase.kind!=='androidpublisher#productPurchase'||(purchase.productId&&purchase.productId!==sku(row.product_id))||purchase.obfuscatedExternalAccountId!==accountId(row.user_id)||purchase.obfuscatedExternalProfileId!==row.id||(purchase.quantity??1)!==1||![0,1,2].includes(purchase.purchaseState)||(this.live?purchase.purchaseType!==undefined:purchase.purchaseType!==0))fail('payment_mismatch',409);
    const digest=hash(token);
    await this.store.transaction(userId,async c=>{
      const existing=(await c.query(`SELECT order_id,token_hash FROM ${this.receipts} WHERE order_id=$1 OR token_hash=$2`,[row.id,digest])).rows;
      if(existing.some(x=>x.order_id!==row.id||x.token_hash!==digest))fail('payment_mismatch',409);
      await c.query(`INSERT INTO ${this.receipts}(order_id,token_hash,encrypted_token) VALUES($1,$2,$3) ON CONFLICT(order_id) DO NOTHING`,[row.id,digest,this.seal(token,row.id)]);
    });
    let status=purchase.purchaseState===2?'pending':purchase.purchaseState===1?'refunded':'paid';
    let paidAt=null,refunds=[],collectedAmount;
    if(purchase.purchaseState!==2&&purchase.orderId){
      const details=await this.api('/orders/'+encodeURIComponent(purchase.orderId));
      if(details.orderId!==purchase.orderId||details.purchaseToken!==token||details.lineItems?.length!==1||details.lineItems[0].productId!==sku(row.product_id))fail('payment_mismatch',409);
      collectedAmount=money(details.total);
      if(collectedAmount!==row.amount){
        const points=details.pointsDetails,rate=Number(points?.pointsDiscountRateMicros);
        const coupon=points?.pointsCouponValue?money(points.pointsCouponValue):null;
        const discount=coupon??(Number.isInteger(rate)&&rate>0&&rate<=1000000?Math.round(row.amount*rate/1000000):null);
        if(discount===null||collectedAmount+discount!==row.amount)fail('payment_mismatch',409);
      }
      const time=details.orderHistory?.processedEvent?.eventTime;
      if(time&&Number.isFinite(new Date(time).getTime()))paidAt=new Date(time).toISOString();
      if(['REFUNDED','PARTIALLY_REFUNDED'].includes(details.state)||purchase.purchaseState===1)status=paidAt?'refunded':'failed';
      else if(details.state!=='PROCESSED'&&details.state!=='PENDING_REFUND')status=details.state==='CANCELED'?'failed':'pending';
      const history=details.orderHistory||{};
      for(const r of history.partialRefundEvents||[])if(r.state==='PROCESSED_SUCCESSFULLY')refunds.push({id:purchase.orderId+':partial:'+r.createTime,amount:money(r.refundDetails?.total),at:r.processTime});
      if(history.refundEvent){const r=history.refundEvent;refunds.push({id:purchase.orderId+':full',amount:money(r.refundDetails?.total),at:r.eventTime});}
      if(refunds.some(r=>r.amount<0||!Number.isFinite(new Date(r.at).getTime()))||refunds.reduce((sum,r)=>sum+r.amount,0)>collectedAmount)fail('payment_mismatch',409);
      refunds=refunds.filter(r=>r.amount>0); // Store-confirmed points returns have no cash ledger entry.
    }else if(purchase.purchaseState===0)fail('payment_verification_required');
    const saved=await this.store.settle(row,{status,providerId:digest,paymentId:purchase.orderId||null,paidAt,refunds,collectedAmount});
    // Grant in the committed transaction first. A retried consume can never add
    // quotas again. Consume is also the acknowledgement for these one-time items.
    if(['paid','paid_conflict'].includes(saved.status)&&purchase.consumptionState===0){
      await this.api('/purchases/products/'+encodeURIComponent(sku(row.product_id))+'/tokens/'+encodeURIComponent(token)+':consume','POST');
      await this.pool.query(`UPDATE ${this.receipts} SET consumed=TRUE WHERE order_id=$1`,[row.id]);
    }
    await this.pool.query(`UPDATE ${this.receipts} SET checked_at=NOW() WHERE order_id=$1`,[row.id]);
    return this.store.view(saved);
  }
  async order(userId,orderId){await this.init();const row=await this.store.get(orderId,this.provider,userId);const receipt=(await this.pool.query(`SELECT encrypted_token FROM ${this.receipts} WHERE order_id=$1`,[row.id])).rows[0];return receipt?this.verify(userId,orderId,this.unseal(receipt.encrypted_token,row.id)):this.store.view(row);}
  async pending(userId){await this.init();const rows=await this.store.pending(userId,this.provider);const orders=[];for(const row of rows)orders.push(await this.order(userId,row.id));return orders;}
  async cancel(userId,orderId){await this.init();const row=await this.store.get(orderId,this.provider,userId);return this.store.view(await this.store.transaction(userId,async c=>{const receipt=(await c.query(`SELECT order_id FROM ${this.receipts} WHERE order_id=$1`,[row.id])).rows[0];if(receipt)fail('payment_verification_required',409);return(await c.query(`UPDATE ${this.store.orders} SET status='expired',updated_at=NOW() WHERE id=$1 AND status='creating' RETURNING *`,[row.id])).rows[0]||row;}));}
  async tick(){
    if(!this.configured()||this.ticking)return {checked:0};this.ticking=true;
    try{await this.init();const rows=(await this.pool.query(`SELECT o.id,o.user_id FROM ${this.store.orders} o JOIN ${this.receipts} r ON r.order_id=o.id WHERE o.created_at>NOW()-INTERVAL '32 days' AND o.status IN ('creating','pending','verification_required','paid','paid_conflict') ORDER BY r.checked_at LIMIT 100`)).rows;let checked=0;for(const row of rows){try{await this.order(row.user_id,row.id);checked++;}catch{/* retry next tick; never log purchase tokens or HTTP errors */}}return{checked};}finally{this.ticking=false;}
  }
}
module.exports={GooglePlayBillingService,accountId,sku,money,PACKAGE};
