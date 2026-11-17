'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const Stripe=require('stripe');
const {StripeBillingService}=require('../services/stripeBillingService');
const {stripeWebhook,createStripeBillingRouter}=require('../routes/stripeBilling');
const {createBillingRouter}=require('../routes/billing');
const {validPaymentCheckoutUrl,installPaymentCheckout}=require('../electron/payment-checkout.cjs');
const policy=require('../privacy-notice');
async function run(){
  assert(validPaymentCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_fixture#abc'));
  for(const url of ['javascript:alert(1)','http://checkout.stripe.com/c/pay/x','https://checkout.stripe.com.evil.test/c/pay/x','https://evil.test@checkout.stripe.com/c/pay/x','https://checkout.stripe.com:444/c/pay/x','https://checkout.stripe.com/settings','file:///tmp/pay'])assert.equal(validPaymentCheckoutUrl(url),false);
  let handler,opened=0;installPaymentCheckout({ipcMain:{handle:(name,fn)=>{assert.equal(name,'panthorium:payment-checkout');handler=fn;}},shell:{openExternal:async()=>{opened++;}},security:{isTrustedShellEvent:event=>event.trusted===true}});
  assert.equal((await handler({},'https://checkout.stripe.com/c/pay/x')).ok,false);assert.equal(opened,0);
  assert.equal((await handler({trusted:true},'https://evil.test')).ok,false);assert.equal(opened,0);
  assert.equal((await handler({trusted:true},'https://checkout.stripe.com/c/pay/x')).ok,true);assert.equal(opened,1);
  const sdk=new Stripe('sk_test_fixture');
  const service=new StripeBillingService({pool:{},secret:'rk_test_fixture',webhookSecret:'whsec_fixture',client:sdk});
  assert.equal(new StripeBillingService({pool:{},secret:'rk_live_fixture',webhookSecret:'whsec_fixture',mode:'live'}).configured(),false);
  assert.equal(new StripeBillingService({pool:{},secret:'rk_live_fixture',webhookSecret:'whsec_fixture',mode:'test'}).configured(),false);
  const auth={verifyAccessToken:token=>({sub:token,roles:token==='guest'?['guest']:['user']})};let created=0;
  const app=express();app.post('/api/billing/stripe/webhook',express.raw({type:'application/json'}),stripeWebhook(service));app.use(express.json());
  app.use('/api/billing/stripe',createStripeBillingRouter(auth,{live:false,checkout:async(owner,product,key)=>{created++;assert.equal(owner,'alice');assert.equal(product,'life');assert.equal(key,'fixture');return{id:'order',amountSatang:18900,status:'pending'};}}));
  app.use('/api/billing',createBillingRouter(auth,{},{stripePrimary:true,stripe:service}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body,token,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  try{
    const data={productId:'life',requestKey:'fixture',testAcknowledged:true,policyVersion:policy.version,amount:1,status:'paid'};
    assert.equal((await post('/api/billing/stripe/checkout',data)).status,401);
    assert.equal((await post('/api/billing/stripe/checkout',data,'guest')).status,403);
    assert.equal((await post('/api/billing/stripe/checkout',{...data,policyVersion:'old'},'alice')).status,409);
    assert.equal((await post('/api/billing/stripe/checkout',{...data,testAcknowledged:false},'alice')).status,400);
    const response=await post('/api/billing/stripe/checkout',data,'alice');assert.equal(response.status,200);assert.equal((await response.json()).order.amountSatang,18900);assert.equal(created,1);
    assert.equal((await post('/api/billing/checkout',data,'alice')).status,409,'legacy creation is closed after provider migration');
    const raw='{\n "id":"evt_fixture", "type":"unrelated.event", "livemode":false\n}';
    const signature=sdk.webhooks.generateTestHeaderString({payload:raw,secret:'whsec_fixture'});
    assert.equal((await post('/api/billing/stripe/webhook',raw,null,{'stripe-signature':signature})).status,200);
    assert.equal((await post('/api/billing/stripe/webhook',JSON.stringify(JSON.parse(raw)),null,{'stripe-signature':signature})).status,400,'body rewriting invalidates signature');
    assert.equal((await post('/api/billing/stripe/webhook',raw)).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));}
  console.log('Checkout security: raw signed webhooks, explicit consent/version, account/guest guard, provider migration and trusted desktop external URL passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
