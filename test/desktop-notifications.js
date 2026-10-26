'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createDesktopNotifications}=require('../electron/notifications.cjs');
(async()=>{
  const app=new EventEmitter(),handlers={},shown=[];let quit=0,menu;
  app.quit=()=>{quit++;app.emit('before-quit');};
  class Notice extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;shown.push(this);}show(){this.shown=true;}close(){this.closed=true;this.emit('close');}}
  class FakeTray extends EventEmitter{setToolTip(){}setContextMenu(value){menu=value;}destroy(){}}
  const wc=new EventEmitter();wc.id=1;wc.send=name=>{wc.sent=name;};
  const win=new EventEmitter();Object.assign(win,{webContents:wc,visible:true,isDestroyed:()=>false,isVisible:()=>win.visible,isMinimized:()=>false,hide:()=>{win.visible=false;},show:()=>{win.visible=true;},focus(){}});
  const bridge=createDesktopNotifications({app,ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}},Notification:Notice,Tray:FakeTray,
    Menu:{buildFromTemplate:x=>x},nativeImage:{createFromPath:()=>({isEmpty:()=>false,resize(){return this;}})},security:{isTrustedShellEvent:e=>e.trusted},iconPath:'fixture.png'});
  bridge.attach(win);const event={sender:wc,trusted:true};
  const background=value=>handlers['panthorium:notification-background'](event,value);
  const show=input=>handlers['panthorium:notification-show'](event,input);
  assert.equal((await background(true)).error,'notifications_requires_account');
  bridge.setAccount(wc,'user-a');
  assert.equal((await handlers['panthorium:notification-background']({...event,trusted:false},true)).error,'untrusted_origin');
  assert.equal((await background('true')).error,'invalid_notification_setting');
  assert((await background(true)).enabled);
  let prevented=false;win.emit('close',{preventDefault(){prevented=true;}});assert(prevented);assert(!win.visible,'closing opted-in window keeps a hidden receiver');
  const notice={id:'notice_'+'a'.repeat(64),silent:true};
  assert((await show(notice)).ok);assert(shown[0].shown);assert(shown[0].options.silent);assert(!('url' in shown[0].options));
  assert((await show(notice)).duplicate);assert.equal(shown.length,1);
  assert.equal((await show({...notice,body:'untrusted content'})).error,'invalid_notification');
  shown[0].emit('click');assert(win.visible);assert.equal(wc.sent,'panthorium:open-notifications');
  bridge.setAccount(wc,'user-b');assert(shown[0].closed);assert.equal((await show(notice)).error,'device_notifications_disabled');
  await background(true);await show(notice);assert.equal(shown.length,2,'account change clears stale notification state');
  await background(false);prevented=false;win.emit('close',{preventDefault(){prevented=true;}});assert(!prevented,'not opted in closes normally');
  await background(true);menu[1].click();assert.equal(quit,1);prevented=false;win.emit('close',{preventDefault(){prevented=true;}});assert(!prevented,'explicit Quit must not be trapped by background mode');
  app.emit('will-quit');assert(shown[1].closed);
  console.log('Desktop notifications: trusted account-only opt-in, hidden-window delivery, generic payloads, deduplication, account cleanup and explicit Quit passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
