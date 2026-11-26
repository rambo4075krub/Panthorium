'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const policy=require('../privacy-notice');
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await pause();}throw Error('UI condition not reached');}
async function scenario(native,checkoutPath='c'){
  const dom=new JSDOM('<div id="windows"></div>',{runScripts:'outside-only',url:'https://panthorium.test'}),w=dom.window;
  w.OS={state:{user:{id:'alice',roles:['user']}},windows:new Map()};w.PanthoriumAuth={getAccessToken:()=> 'alice'};
  w.createWindow=(id,title,html)=>{const el=w.document.createElement('div');el.className='window';el.dataset.id=id;el.innerHTML=html;w.document.body.append(el);w.OS.windows.set(id,el);};
  let created=0,verified=0,productCalls=0,invalidUrl=true;
  const response=data=>({ok:true,json:async()=>({ok:true,...data})});
  const baseStatus={mode:'live',policyVersion:policy.version,checkoutEnabled:true};
  const offers = [['life',189],['storage-5',49],['storage-20',129],['storage-50',279],['storage-100',499],['download-10',99]]
    .map(([productId,baht]) => ({productId,storeProductId:'panthorium_'+productId.replaceAll('-','_'),amountMicros:baht*1000000,currency:'THB'}));
  if(native)w.Capacitor={isNativePlatform:()=>true,Plugins:{PanthoriumBilling:{
    getProducts:async()=>{productCalls++;return{products:offers.map(offer=>({...offer,offerToken:'offer_fixture'}))};},
    restorePurchases:async()=>({purchases:[]}),
    purchase:async options=>{assert.equal(options.storeProductId,'panthorium_life');assert.equal(options.orderId,'order_fixture');return{purchases:[{orderId:options.orderId,purchaseToken:'receipt_fixture'}]};}
  }}};
  w.fetch=async(url,options={})=>{
    if(url.endsWith('/entitlements'))return response({plan:'life',expiresAt:new Date(Date.now()+86400000).toISOString(),grants:[],remaining:{aiCredits:1000}});
    if(url.endsWith('/play/status'))return response({...baseStatus,provider:'google_play',products:offers});
    if(url.endsWith('/status'))return response({...baseStatus,provider:'stripe'});
    assert.equal(options.headers.Authorization,'Bearer alice');
    if(url.endsWith('/orders'))return response({orders:[]});
    if(url.endsWith('/verify')){assert(native);assert.equal(JSON.parse(options.body).purchaseToken,'receipt_fixture');verified++;return response({order:{id:'order_fixture',status:'paid',mode:'live'}});}
    if(url.endsWith('/prepare')||url.endsWith('/checkout')){
      const body=JSON.parse(options.body);assert.equal(body.policyVersion,policy.version);assert.equal(body.liveAcknowledged,true);assert.equal(body.amount,undefined);created++;
      if(native){assert(url.endsWith('/play/prepare'));return response({order:{id:'order_fixture',status:'creating',accountId:'a'.repeat(64)}});}
      assert(url.endsWith('/stripe/checkout'));return response({order:{id:'order_fixture',status:'pending',checkoutUrl:'https://checkout.stripe.com.evil.test/c/pay/x'}});
    }
    if(url.endsWith('/orders/order_fixture'))return response({order:{id:'order_fixture',status:'pending',checkoutUrl:invalidUrl?'javascript:alert(1)':'https://checkout.stripe.com/'+checkoutPath+'/pay/cs_fixture'}});
    throw Error('unexpected request '+url);
  };
  // Exercise the order of the actual initial HTML. A slow later script must never
  // make the first membership render omit its examples.
  const dependencies = ['privacy-notice.js', 'billing-catalog.js', 'work-brief.js', 'billing-ui.js'];
  const shell = fs.readFileSync(require.resolve('../sentinel.html'), 'utf8');
  const scripts = [...shell.matchAll(/<script\s+src="\/([^"?]+)(?:\?[^"]*)?"/g)].map(match => match[1]);
  const initial = scripts.filter(name => dependencies.includes(name));
  assert(initial.includes('work-brief.js') && initial.indexOf('work-brief.js') < initial.indexOf('billing-ui.js'));
  for (const name of dependencies.filter(name => !initial.includes(name))) w.eval(fs.readFileSync(require.resolve('../' + name), 'utf8'));
  for (const name of initial) w.eval(fs.readFileSync(require.resolve('../' + name), 'utf8'));
  try{
    w.PanthoriumBilling.open();const root=w.document.querySelector('[data-billing-root]');
    if(native)await until(()=>productCalls===1&&!root.querySelector('[data-product-id="life"]').disabled);
    const preview = root.querySelector('.pb-example');
    assert.equal(root.querySelectorAll('.pb-example').length, 4);
    preview.querySelector('button').click();
    assert.equal(preview.querySelectorAll('li').length, 4); assert.equal(created, 0);
    root.querySelectorAll('.pb-tab')[2].click();
    for (const id of ['storage-20','storage-50','storage-100']) {
      const button = root.querySelector('[data-product-id="'+id+'"]');
      assert.equal(button.textContent,'ปิดขายชั่วคราว');
      assert.equal(button.disabled,true);
      button.click();
      assert.equal(root.querySelector('.pb-summary'),null);
    }
    for (const id of ['storage-5','download-10']) assert.equal(root.querySelector('[data-product-id="'+id+'"]').disabled,false);
    root.querySelector('.pb-tab').click();
    root.querySelector('[data-product-id="life"]').click();await until(()=>!root.querySelector('.pb-summary > .pb-primary').disabled);
    assert.match(root.querySelector('[data-refund-policy]').textContent,/ไม่รับคืนเงินตามความสมัครใจ/);
    const pay=root.querySelector('.pb-summary > .pb-primary');pay.click();await pause();assert.equal(created,0);
    root.querySelector('input[type=checkbox]').checked=true;pay.click();pay.click();await until(()=>created===1);
    if(native){await until(()=>verified===1&&root.querySelector('[data-payment-result]').textContent.includes('เปิดสิทธิ์แพ็กเกจแล้ว'));assert.match(root.querySelector('[data-payment-result]').textContent,/เปิดสิทธิ์แพ็กเกจแล้ว/);assert.equal(root.querySelector('a[href*="stripe"]'),null);assert(!Object.values(w.sessionStorage).some(value=>String(value).includes('receipt_fixture')));}
    else{
      assert.equal(root.querySelector('.pb-checkout-link'),null,'reject lookalike payment domains');
      await until(()=>[...root.querySelectorAll('button')].some(b=>b.textContent==='ตรวจสถานะจาก Stripe'));invalidUrl=false;[...root.querySelectorAll('button')].find(b=>b.textContent==='ตรวจสถานะจาก Stripe').click();await until(()=>root.querySelector('.pb-checkout-link'));
      const link=root.querySelector('.pb-checkout-link');assert.equal(link.rel,'noopener noreferrer');assert.equal(link.target,'_blank');
      assert.equal(link.href,'https://checkout.stripe.com/'+checkoutPath+'/pay/cs_fixture');
      w.OS.state.user={id:'bob',roles:['user']};w.dispatchEvent(new w.Event('panthorium:auth-changed'));assert.equal(root.querySelector('.pb-checkout-link'),null,'remove prior account checkout');
    }
  }finally{w.close();}
}
(async()=>{await scenario(false,'c');await scenario(false,'g');await scenario(true);console.log('Checkout UI: current policy consent, duplicate submit, hosted checkout paths, external URL validation, account reset and native Google Play purchase passed');})().catch(error=>{console.error(error);process.exitCode=1;});
