'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
(async()=>{
  const dom=new JSDOM('<body/>',{url:'https://panthorium.test',runScripts:'outside-only'}),w=dom.window;
  w.OS={state:{user:{sub:'a'}},config:{backendUrl:'https://panthorium.test'}};
  let prompts=0,shown=[];w.Notification={permission:'granted',requestPermission:async()=>{prompts++;return 'granted';}};
  const reg={getNotifications:async({tag})=>shown.filter(n=>n.tag===tag),showNotification:async(title,options)=>{shown.push({title,...options});}};
  Object.defineProperty(w.navigator,'serviceWorker',{value:{register:async()=>reg,ready:Promise.resolve(reg),addEventListener(){}}});
  w.eval(fs.readFileSync('notification-push-client.js','utf8'));
  const item={id:'notice_'+'1'.repeat(64),title:'PRIVATE',body:'PRIVATE'};
  assert(await w.PanthoriumPush.show(item,true));assert.equal(shown.length,1);assert(shown[0].silent);assert(!JSON.stringify(shown).includes('PRIVATE'));
  await w.PanthoriumPush.show(item);assert.equal(shown.length,1,'foreground and remote push share the notification tag');assert.equal(prompts,0);
  w.Notification.permission='denied';assert.equal(await w.PanthoriumPush.show(item),false);assert.equal(shown.length,1);
  let enabled=false,account='';w.panthoriumDesktop={isElectron:true,setBrowserAccount:async uid=>{account=uid;return {ok:true};},setNotificationBackground:async value=>{enabled=value;return {ok:true};},showNotification:async()=>({ok:true})};
  await w.PanthoriumPush.enable();assert(enabled);assert.equal(account,'a');assert(w.PanthoriumPush.active(),'desktop does not require unsupported Chromium Web Push');
  await w.PanthoriumPush.show(item);await w.PanthoriumPush.disconnect();assert(!enabled);assert(!w.PanthoriumPush.active());
  w.close();console.log('Popup client: mobile service-worker display, generic content, deduplication, denied permission and desktop native opt-in passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
