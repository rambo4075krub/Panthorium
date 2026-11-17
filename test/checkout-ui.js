'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const policy=require('../privacy-notice');
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await pause();}throw Error('UI condition not reached');}
async function scenario(native){
  const dom=new JSDOM('<div id="windows"></div>',{runScripts:'outside-only',url:'https://panthorium.test'}),w=dom.window;
  w.OS={state:{user:{id:'alice',roles:['user']}},windows:new Map()};w.PanthoriumAuth={getAccessToken:()=> 'alice'};
  w.createWindow=(id,title,html)=>{const el=w.document.createElement('div');el.className='window';el.dataset.id=id;el.innerHTML=html;w.document.body.append(el);w.OS.windows.set(id,el);};
  let created=0,verified=0,productCalls=0,invalidUrl=true;
  const response=data=>({ok:true,json:async()=>({ok:true,...data})});
  const baseStatus={mode:'live',policyVersion:policy.version,checkoutEnabled:true};
  if(native)w.Capacitor={isNativePlatform:()=>true,Plugins:{PanthoriumBilling:{
    getProducts:async()=>{productCalls++;return{products:[{storeProductId:'panthorium_life',offerToken:'offer_fixture',amountMicros:189000000,currency:'THB',formattedPrice:'฿189.00'}]};},
    restorePurchases:async()=>({purchases:[]}),
    purchase:async options=>{assert.equal(options.storeProductId,'panthorium_life');assert.equal(options.orderId,'order_fixture');return{purchases:[{orderId:options.orderId,purchaseToken:'receipt_fixture'}]};}
  }}};
  w.fetch=async(url,options={})=>{
    if(url.endsWith('/entitlements'))return response({plan:'life',expiresAt:new Date(Date.now()+86400000).toISOString(),grants:[],remaining:{aiCredits:1000}});
    if(url.endsWith('/play/status'))return response({...baseStatus,provider:'google_play',products:[{productId:'life',storeProductId:'panthorium_life',amountMicros:189000000,currency:'THB'}]});
    if(url.endsWith('/status'))return response({...baseStatus,provider:'stripe'});
    assert.equal(options.headers.Authorization,'Bearer alice');
    if(url.endsWith('/orders'))return response({orders:[]});
    if(url.endsWith('/verify')){assert(native);assert.equal(JSON.parse(options.body).purchaseToken,'receipt_fixture');verified++;return response({order:{id:'order_fixture',status:'paid',mode:'live'}});}
    if(url.endsWith('/prepare')||url.endsWith('/checkout')){
      const body=JSON.parse(options.body);assert.equal(body.policyVersion,policy.version);assert.equal(body.liveAcknowledged,true);assert.equal(body.amount,undefined);created++;
      if(native){assert(url.endsWith('/play/prepare'));return response({order:{id:'order_fixture',status:'creating',accountId:'a'.repeat(64)}});}
      assert(url.endsWith('/stripe/checkout'));return response({order:{id:'order_fixture',status:'pending',checkoutUrl:'https://checkout.stripe.com.evil.test/c/pay/x'}});
    }
    if(url.endsWith('/orders/order_fixture'))return response({order:{id:'order_fixture',status:'pending',checkoutUrl:invalidUrl?'javascript:alert(1)':'https://checkout.stripe.com/c/pay/cs_fixture'}});
    throw Error('unexpected request '+url);
  };
  for(const name of ['privacy-notice.js','billing-catalog.js','billing-ui.js'])w.eval(fs.readFileSync(require.resolve('../'+name),'utf8'));
  try{
    w.PanthoriumBilling.open();const root=w.document.querySelector('[data-billing-root]');
    if(native)await until(()=>productCalls===1&&!root.querySelector('[data-product-id="life"]').disabled);
    root.querySelector('[data-product-id="life"]').click();await until(()=>!root.querySelector('.pb-summary > .pb-primary').disabled);
    assert.match(root.querySelector('[data-refund-policy]').textContent,/ไม่รับคืนเงินตามความสมัครใจ/);
    const pay=root.querySelector('.pb-summary > .pb-primary');pay.click();await pause();assert.equal(created,0);
    root.querySelector('input[type=checkbox]').checked=true;pay.click();pay.click();await until(()=>created===1);
    if(native){await until(()=>verified===1&&root.querySelector('[data-payment-result]').textContent.includes('เปิดสิทธิ์แพ็กเกจแล้ว'));assert.match(root.querySelector('[data-payment-result]').textContent,/เปิดสิทธิ์แพ็กเกจแล้ว/);assert.equal(root.querySelector('a[href*="stripe"]'),null);assert(!Object.values(w.sessionStorage).some(value=>String(value).includes('receipt_fixture')));}
    else{
      assert.equal(root.querySelector('.pb-checkout-link'),null,'reject lookalike payment domains');
      await until(()=>[...root.querySelectorAll('button')].some(b=>b.textContent==='ตรวจสถานะจาก Stripe'));invalidUrl=false;[...root.querySelectorAll('button')].find(b=>b.textContent==='ตรวจสถานะจาก Stripe').click();await until(()=>root.querySelector('.pb-checkout-link'));
      const link=root.querySelector('.pb-checkout-link');assert.equal(link.rel,'noopener noreferrer');assert.equal(link.target,'_blank');
      w.OS.state.user={id:'bob',roles:['user']};w.dispatchEvent(new w.Event('panthorium:auth-changed'));assert.equal(root.querySelector('.pb-checkout-link'),null,'remove prior account checkout');
    }
  }finally{w.close();}
}
(async()=>{await scenario(false);await scenario(true);console.log('Checkout UI: current policy consent, duplicate submit, external URL validation, account reset and native Google Play purchase passed');})().catch(error=>{console.error(error);process.exitCode=1;});
