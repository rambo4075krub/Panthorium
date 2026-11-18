'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {creditUsage}=require('../services/creditUsage');
const {EntitlementService}=require('../services/entitlementService');
const catalog=require('../notification-event-catalog');
async function main(){
  const membership={order_id:'paid-round-1',snapshot:{quotas:{aiCredits:1000}},used:{aiCredits:899}};
  const usage=()=>creditUsage({rows:[membership],membership,period:'2026-11'});
  assert.equal(usage().threshold,0);membership.used.aiCredits=900;assert.equal(usage().threshold,90);
  membership.used.aiCredits=949;assert.equal(usage().threshold,90);membership.used.aiCredits=950;assert.equal(usage().threshold,95);
  const cycle=usage().cycleId;membership.used.aiCredits=1000;assert.equal(usage().threshold,100);
  assert.equal(creditUsage({rows:[membership],membership,promotion:{},period:'2026-11'}).threshold,0);
  const topped=creditUsage({rows:[membership,{order_id:'addon',snapshot:{quotas:{aiCredits:1000}},used:{}}],membership,period:'2026-11'});
  assert.equal(topped.threshold,0);assert.notEqual(topped.cycleId,cycle);
  const events=[];let fail=false;
  const rights=new EntitlementService({pool:{},notifications:{publish:async event=>{if(fail)throw Error('temporary');events.push(event);}}});
  for(const threshold of [90,90,95,95,100,100]){rights.notifyCredits('alice',{...usage(),threshold});await rights.flushQuotaAlerts();}
  assert.deepEqual(events.map(e=>e.type),['billing.credits_90','billing.credits_95','billing.credits_100']);
  for(const event of events){assert.equal(event.userId,'alice');assert.equal(event.category,'billing');assert(catalog.keyFor(event));}
  fail=true;rights.notifyCredits('bob',usage());await rights.flushQuotaAlerts();fail=false;rights.notifyCredits('bob',usage());await rights.flushQuotaAlerts();assert.equal(events.at(-1).userId,'bob');
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'https://panthorium.test',pretendToBeVisual:true});
  const w=dom.window;let opens=0,fetches=0,resolver;
  w.OS={state:{user:{id:'alice',roles:['user']}},config:{}};
  w.PanthoriumBilling={open:()=>{opens++;return true;}};
  w.PanthoriumAuth={getAccessToken:()=>null};w.AbortSignal=AbortSignal;
  w.setInterval=()=>1;w.clearInterval=()=>{};
  w.fetch=async url=>{fetches++;assert(url.endsWith('/api/billing/entitlements'));return new Promise(resolve=>{resolver=resolve;});};
  w.eval(fs.readFileSync(require.resolve('../credit-alert-client.js'),'utf8'));
  const send=threshold=>w.PanthoriumCreditAlerts.observe({creditUsage:{...usage(),threshold,remaining:threshold===100?0:1000-threshold*10}});
  send(90);assert.match(w.document.querySelector('[data-credit-warning]').textContent,/90%/);assert.equal(opens,0);
  send(95);assert.match(w.document.querySelector('[data-credit-warning]').textContent,/95%/);
  send(100);send(100);assert.equal(opens,1);assert.equal(fetches,0,'opening a catalog never creates or submits payment');
  w.PanthoriumCreditAlerts.observe({creditUsage:{unlimited:true}});assert.equal(w.document.querySelector('[data-credit-warning]'),null);
  w.OS.state.user={id:'charlie',roles:['user']};w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  w.PanthoriumAuth.getAccessToken=()=> 'test-token';
  const pending=w.PanthoriumCreditAlerts.refresh();
  w.OS.state.user={id:'bob',roles:['user']};w.PanthoriumAuth.getAccessToken=()=>null;w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  resolver({ok:true,json:async()=>({creditUsage:usage()})});await pending;assert.equal(opens,1,'late balance from another account cannot open checkout');
  send(100);assert.equal(opens,2,'new account has its own alert state');
  w.OS.state.user=null;w.dispatchEvent(new w.Event('panthorium:auth-changed'));send(100);assert.equal(opens,2);
  dom.window.close();
  console.log('Credit alerts: exact 90/95/100 thresholds, promotion, top-ups, dedup/retry, account isolation and catalog-only opening passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
