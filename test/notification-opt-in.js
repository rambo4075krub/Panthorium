'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const {DEFAULT_SETTINGS}=require('../services/notificationService');
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
function harness(saved={},options={}){
  const dom=new JSDOM('<body><main></main></body>',{url:'https://panthorium.test',runScripts:'outside-only'}),w=dom.window;
  for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,value);
  const state={permission:options.permission||'prompt',fail:!!options.fail,prompts:0,registrations:0,retrySchedules:0,subscribed:[],settings:JSON.parse(JSON.stringify(DEFAULT_SETTINGS))};
  const setTimer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>{if(ms===60000)state.retrySchedules++;return setTimer(fn,ms,...args);};
  state.settings.channels.browser=!!options.browser;
  w.OS={state:{user:{sub:'alpha',roles:['user'],permissions:['chat']}},config:{backendUrl:'https://panthorium.test'}};
  let registered;
  w.Capacitor={isNativePlatform:()=>true,Plugins:{PushNotifications:{
    checkPermissions:async()=>({receive:state.permission}),
    requestPermissions:async()=>{state.prompts++;return {receive:state.permission=options.deny?'denied':'granted'};},
    createChannel:async()=>{},addListener:async(name,fn)=>{if(name==='registration')registered=fn;return {remove(){}};},
    register:async()=>{state.registrations++;registered({value:'fixture-token-'.repeat(5)});},unregister:async()=>{}
  }}};
  w.fetch=async()=>({ok:true});
  w.authorizedFetch=async(url,opts={})=>{
    let data;
    if(url.endsWith('/push/config')){if(state.fail)throw Error('temporary_network_failure');data={ok:true,available:true,nativeAvailable:true};}
    else if(url.endsWith('/push/subscribe')){state.subscribed.push(w.OS.state.user.sub);data={ok:true,id:'a'.repeat(64),binding:'b'.repeat(32),revokeToken:'c'.repeat(43)};}
    else if(url.endsWith('/settings')){const patch=JSON.parse(opts.body);Object.assign(state.settings.channels,patch.channels);data={ok:true,settings:state.settings};}
    else data={ok:true,settings:state.settings,items:[],unreadCount:0};
    return {ok:true,json:async()=>JSON.parse(JSON.stringify(data))};
  };
  for(const file of ['notification-event-catalog.js','notification-push-client.js','notifications-ui.js'])w.eval(fs.readFileSync(file,'utf8'));
  w.PanthoriumNotifications.mount(w.document.querySelector('main'));
  return {w,state,card:()=>w.document.querySelector('[data-notification-opt-in]'),save:()=>Object.fromEntries(Object.entries(w.localStorage)),close:()=>w.close()};
}
(async()=>{
  let h=harness();await tick();assert(h.card(),'new account is offered opt-in');
  h.card().querySelector('button').click();await tick();await tick();
  assert.equal(h.state.prompts,1);assert(h.w.PanthoriumPush.active());assert(h.w.PanthoriumPush.accepted());assert(!h.card());
  const saved=h.save();h.close();

  h=harness(saved,{permission:'granted',fail:true,browser:true});await tick();
  h.w.dispatchEvent(new h.w.Event('panthorium:boot-complete'));await tick();
  await h.w.PanthoriumNotifications.refresh();
  assert(!h.card(),'accepted opt-in is not repeated after reload and a renewal failure');
  assert(!h.w.PanthoriumPush.active(),'consent alone must not claim a working registration');
  assert.equal(h.state.prompts,0,'silent renewal cannot re-request permission');
  assert.equal(h.state.retrySchedules,1,'a failed renewal schedules one retry, not overlapping retry loops');
  h.state.fail=false;h.w.dispatchEvent(new h.w.Event('online'));await tick();
  assert(h.w.PanthoriumPush.active(),'reconnection restores an opted-in registration');
  assert.equal(h.state.prompts,0);

  h.w.OS.state.user={sub:'beta',roles:['user'],permissions:['chat']};
  h.state.settings.channels.browser=false;
  h.w.dispatchEvent(new h.w.Event('panthorium:auth-changed'));await tick();
  assert(!h.w.PanthoriumPush.accepted(),'another account does not inherit consent');
  assert(h.card());assert(!h.state.subscribed.includes('beta'));
  h.w.OS.state.user={sub:'alpha',roles:['user'],permissions:['chat']};
  h.w.dispatchEvent(new h.w.Event('panthorium:auth-changed'));await tick();
  assert(!h.card());assert(h.w.PanthoriumPush.active(),'returning account silently rebinds after sign-out');
  assert.equal(h.state.prompts,0);
  await h.w.PanthoriumPush.disconnect();
  const disabled=h.save();h.close();
  h=harness(disabled,{permission:'granted'});await tick();
  h.w.dispatchEvent(new h.w.Event('panthorium:boot-complete'));await tick();
  assert(!h.card(),'explicit disable does not bring back onboarding');
  assert(!h.w.PanthoriumPush.active());assert.equal(h.state.registrations,0,'explicit disable is never automatically undone');
  await h.w.PanthoriumPush.enable();assert(h.w.PanthoriumPush.active());assert.equal(h.state.prompts,0);h.close();

  h=harness({}, {fail:true});await tick();h.card().querySelector('button').click();await tick();await tick();
  assert.equal(h.state.prompts,1);assert(h.w.PanthoriumPush.accepted());assert(!h.card());
  assert(h.state.settings.channels.browser,'accepted native opt-in remains enabled while registration recovers');
  assert(!h.w.PanthoriumPush.active());
  const failed=h.save();h.close();
  h=harness(failed,{permission:'granted',browser:true});h.w.dispatchEvent(new h.w.Event('panthorium:boot-complete'));await tick();
  assert(h.w.PanthoriumPush.active(),'first registration failure recovers without another permission click');
  assert.equal(h.state.prompts,0);assert(!h.card());h.close();

  h=harness({}, {deny:true});await tick();h.card().querySelector('button').click();await tick();
  assert(!h.w.PanthoriumPush.accepted(),'denied OS permission is not recorded as acceptance');
  assert.equal(h.state.subscribed.length,0);h.close();

  h=harness({'panthorium-push-device-v1':JSON.stringify({owner:'alpha',id:'a'.repeat(64),base:'https://panthorium.test',revokeToken:'c'.repeat(43)})},{permission:'granted',fail:true});
  await tick();assert(!h.card(),'existing installations do not repeat onboarding during migration');h.close();
  h=harness({},{permission:'granted',browser:true});await tick();await tick();
  assert(!h.card(),'saved account opt-in and OS permission restore an older lost device record');
  assert(h.w.PanthoriumPush.active());assert.equal(h.state.prompts,0);h.close();
  h=harness({},{permission:'prompt',browser:true});await tick();
  assert(h.card(),'account setting alone cannot grant OS permission on a new device');
  assert.equal(h.state.prompts,0);assert.equal(h.state.registrations,0);h.close();
  console.log('Notification opt-in: first acceptance, reload, offline recovery, account isolation, logout/login, explicit disable, denial and legacy migration passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
