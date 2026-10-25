'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
(async()=>{
  const dom=new JSDOM('<body/>',{url:'https://panthorium.test',runScripts:'outside-only'}),w=dom.window;
  w.OS={state:{user:{sub:'a'}},config:{backendUrl:'https://panthorium.test'}};
  const calls=[];let permitted=false,unregistered=0,prompts=0,registrations=0,delayRegistration=false;
  w.Capacitor={isNativePlatform:()=>true,Plugins:{PushNotifications:{
    requestPermissions:async()=>{prompts++;return {receive:permitted?'granted':'denied'};},checkPermissions:async()=>({receive:permitted?'granted':'denied'}),createChannel:async()=>{},
    addListener:async(name,fn)=>{if(name==='registration')w.registered=fn;return {remove(){}};},
    register:async()=>{registrations++;if(!delayRegistration)w.registered({value:'test-token-'.repeat(10)});},unregister:async()=>{unregistered++;}
  }}};
  w.authorizedFetch=async(url,opts={})=>{calls.push({url,opts});return {ok:true,json:async()=>url.endsWith('config')?{ok:true,available:true,nativeAvailable:true}:{ok:true,id:'a'.repeat(64),binding:'b'.repeat(32),revokeToken:'c'.repeat(43)}};};
  w.fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true};};
  w.eval(fs.readFileSync('notification-push-client.js','utf8'));
  await assert.rejects(w.PanthoriumPush.enable());assert(!calls.some(c=>c.url.endsWith('subscribe')),'permission denial never subscribes');
  permitted=true;await w.PanthoriumPush.enable();assert(w.PanthoriumPush.active());
  assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('subscribe')).opts.body).subscription.kind,'fcm');
  await w.PanthoriumPush.disconnect();assert(!w.PanthoriumPush.active());assert.equal(unregistered,1);assert(calls.some(c=>c.url.endsWith('revoke')));
  await w.PanthoriumPush.enable();w.OS.state.user={sub:'b'};w.dispatchEvent(new w.Event('panthorium:auth-changed'));await new Promise(r=>setTimeout(r,20));assert(!w.PanthoriumPush.active());
  delayRegistration=true;const before=registrations;
  const enabling=w.PanthoriumPush.enable(),duplicate=w.PanthoriumPush.enable();assert.equal(enabling,duplicate,'concurrent enable requests share one registration');
  await new Promise(r=>setTimeout(r,20));assert.equal(registrations,before+1);
  const disabling=w.PanthoriumPush.disconnect();w.registered({value:'test-token-'.repeat(10)});
  await assert.rejects(enabling);await disabling;assert(!w.PanthoriumPush.active(),'disable cancels an in-flight registration');
  delayRegistration=false;await w.PanthoriumPush.enable();
  const promptCount=prompts,registerCount=registrations;
  const clock=w.Date.now;w.Date.now=()=>clock()+7200000;w.dispatchEvent(new w.Event('online'));
  await new Promise(r=>setTimeout(r,20));assert.equal(prompts,promptCount,'renewal never prompts again');assert.equal(registrations,registerCount+1,'renewal refreshes native token');
  w.close();console.log('Push client: Android opt-in permission, server registration, account change and logout revocation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
