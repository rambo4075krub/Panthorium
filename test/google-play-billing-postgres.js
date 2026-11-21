'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {GooglePlayBillingService,accountId,sku,PACKAGE}=require('../services/googlePlayBillingService');
async function run(){
  if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL is required');
  const schema='play_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema});
  let purchase,details,consumes=0;
  const token='fixture_purchase_token_123456',key='a'.repeat(64);
  const service=new GooglePlayBillingService({pool,enabled:true,mode:'live',encryptionKey:key,client:{request:async request=>{
    assert.equal(new URL(request.url).hostname,'androidpublisher.googleapis.com');
    if(request.url.includes('/oneTimeProducts/'))return{data:{productId:sku('life'),packageName:PACKAGE}};
    if(request.url.endsWith(':consume')){assert.equal(request.method,'POST');consumes++;purchase.consumptionState=1;return{data:{}};}
    return{data:structuredClone(request.url.includes('/orders/')?details:purchase)};
  }}});
  try{
    const status = await service.status();
    assert.equal(status.checkoutEnabled,true);
    const offered = status.products.map(product=>product.productId);
    for (const id of ['storage-20','storage-50','storage-100']) {
      assert(!offered.includes(id));
      await assert.rejects(service.prepare('alice',id,randomUUID()),{message:'product_sales_paused',status:409});
    }
    assert(offered.includes('storage-5') && offered.includes('download-10'));
    assert.equal((await pool.query('SELECT COUNT(*) FROM '+service.store.orders)).rows[0].count,'0');
    const order=await service.prepare('alice','life',randomUUID());assert.equal(order.accountId,accountId('alice'));assert.equal(order.storeProductId,sku('life'));
    purchase={kind:'androidpublisher#productPurchase',productId:sku('life'),purchaseState:2,consumptionState:0,quantity:1,obfuscatedExternalAccountId:accountId('alice'),obfuscatedExternalProfileId:order.id};
    await assert.rejects(service.verify('bob',order.id,token),/order_not_found/);
    assert.equal((await service.verify('alice',order.id,token)).status,'pending');assert.equal(consumes,0);
    assert.equal((await service.store.rights.state('alice')).plan,'free');
    const record=(await pool.query(`SELECT * FROM ${service.receipts}`)).rows[0];assert(!record.encrypted_token.includes(token));assert.equal(service.unseal(record.encrypted_token,order.id),token);
    assert.throws(()=>service.unseal(record.encrypted_token,randomUUID()));
    purchase.purchaseState=0;purchase.orderId='GPA.fixture';
    details={orderId:purchase.orderId,purchaseToken:token,state:'PROCESSED',lineItems:[{productId:sku('life')}],total:{currencyCode:'THB',units:'189',nanos:0},orderHistory:{processedEvent:{eventTime:new Date().toISOString()}}};
    details.total.units='1';await assert.rejects(service.verify('alice',order.id,token),/payment_mismatch/);assert.equal(consumes,0);details.total.units='189';
    purchase.obfuscatedExternalAccountId=accountId('bob');await assert.rejects(service.verify('alice',order.id,token),/payment_mismatch/);purchase.obfuscatedExternalAccountId=accountId('alice');
    purchase.purchaseType=0;await assert.rejects(service.verify('alice',order.id,token),/payment_mismatch/);delete purchase.purchaseType;
    assert.equal((await service.verify('alice',order.id,token)).status,'paid');await service.verify('alice',order.id,token);assert.equal(consumes,1);
    assert.equal((await service.store.rights.state('alice')).plan,'life');
    assert.equal((await pool.query('SELECT COUNT(*) FROM panthorium_entitlement_grants')).rows[0].count,'1');
    assert.equal((await pool.query("SELECT COUNT(*) FROM panthorium_finance_entries WHERE kind='income'")).rows[0].count,'1');
    const replay=await service.prepare('bob','life',randomUUID());purchase.obfuscatedExternalAccountId=accountId('bob');purchase.obfuscatedExternalProfileId=replay.id;
    await assert.rejects(service.verify('bob',replay.id,token),/payment_mismatch/,'one receipt cannot belong to two orders');
    purchase.obfuscatedExternalAccountId=accountId('alice');purchase.obfuscatedExternalProfileId=order.id;
    details.state='REFUNDED';purchase.purchaseState=1;details.orderHistory.refundEvent={eventTime:new Date().toISOString(),refundDetails:{total:details.total}};
    await service.order('alice',order.id);await service.order('alice',order.id);
    assert.equal((await service.store.rights.state('alice')).plan,'free');assert.equal((await pool.query("SELECT COUNT(*) FROM panthorium_finance_entries WHERE kind='refund'")).rows[0].count,'1');
    await assert.rejects(service.cancel('alice',order.id),/payment_verification_required/);
    assert.equal((await service.cancel('bob',replay.id)).status,'expired');
    for(const [user,paid,coupon] of [['charlie',100,89],['dana',0,189]]){
      const pointsOrder=await service.prepare(user,'life',randomUUID()),pointsToken='points_receipt_'+user;
      purchase={kind:'androidpublisher#productPurchase',productId:sku('life'),purchaseState:0,consumptionState:0,orderId:'GPA.'+user,obfuscatedExternalAccountId:accountId(user),obfuscatedExternalProfileId:pointsOrder.id};
      details={orderId:purchase.orderId,purchaseToken:pointsToken,state:'PROCESSED',lineItems:[{productId:sku('life')}],total:{currencyCode:'THB',units:String(paid)},pointsDetails:{pointsCouponValue:{currencyCode:'THB',units:String(coupon)}},orderHistory:{processedEvent:{eventTime:new Date().toISOString()}}};
      const verified=await service.verify(user,pointsOrder.id,pointsToken);assert.equal(verified.status,'paid');assert.equal(verified.collectedAmountSatang,paid*100);
      assert.equal((await service.store.rights.state(user)).plan,'life');
      const cash=(await pool.query("SELECT amount FROM panthorium_finance_entries WHERE order_id=$1 AND kind='income'",[pointsOrder.id])).rows;
      if(paid)assert.equal(Number(cash[0].amount),paid*100);else assert.equal(cash.length,0,'points-only purchases must not invent cash income');
    }
    assert.equal(new GooglePlayBillingService({pool,enabled:true,encryptionKey:'short'}).configured(),false);
    console.log('Google Play/PostgreSQL: verified purchase identity/price/state, encrypted receipts, test/live separation, consume after grant, replay protection and refund reconciliation passed');
  }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
