(function(){
  'use strict';
  const key='panthorium-push-device-v1';
  let pendingEnable=null,pendingDisconnect=null,generation=0,lastRenewal=0,verified=false;
  const os=()=>typeof OS!=='undefined'?OS:window.OS;
  const owner=()=>String(os()?.state?.user?.sub||os()?.state?.user?.id||'');
  const native=()=>window.Capacitor?.isNativePlatform?.()===true;
  const desktop=()=>window.panthoriumDesktop?.isElectron===true;
  const plugin=()=>window.Capacitor?.Plugins?.PushNotifications;
  const stored=()=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
  const base=()=>String(os()?.config?.backendUrl||'').replace(/\/$/,'');
  async function api(path,options={}){
    const response=await authorizedFetch(base()+'/api/notifications/push/'+path,{...options,headers:{'Content-Type':'application/json'}});
    const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'push_failed');return data;
  }
  async function worker(){
    if(!window.isSecureContext||!navigator.serviceWorker||!window.PushManager)throw Error('อุปกรณ์นี้ไม่รองรับ Web Push กรุณาเปิดผ่าน Chrome หรือเพิ่มเว็บบนหน้าจอหลัก');
    await navigator.serviceWorker.register('/sw.js');return navigator.serviceWorker.ready;
  }
  async function bind(reg,binding){
    const target=reg.active;if(!target)throw Error('push_worker_not_ready');
    await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('push_worker_timeout')),5000);channel.port1.onmessage=()=>{clearTimeout(timer);channel.port1.close();resolve();};target.postMessage({type:'panthorium:push-binding',binding},[channel.port2]);});
  }
  async function disconnectDevice(){
    verified=false;
    const device=stored();
    if(device)localStorage.setItem(key,JSON.stringify({...device,disabled:true}));
    if(desktop())await window.panthoriumDesktop.setNotificationBackground?.(false);
    else if(native())await plugin()?.unregister().catch(()=>{});
    else if(navigator.serviceWorker){const reg=await navigator.serviceWorker.getRegistration();if(reg){await bind(reg,null);await (await reg.pushManager?.getSubscription())?.unsubscribe();}}
    if(device&&device.kind!=='desktop'){
      const response=await fetch(device.base+'/api/notifications/push/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:device.id,token:device.revokeToken}),keepalive:true});
      if(!response.ok)throw Error('ยกเลิกการผูกอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    localStorage.removeItem(key);window.dispatchEvent(new Event('panthorium:push-changed'));
  }
  function disconnect(){
    generation++;
    if(!pendingDisconnect)pendingDisconnect=(async()=>{await pendingEnable?.catch(()=>{});await disconnectDevice();})().finally(()=>{pendingDisconnect=null;});
    return pendingDisconnect;
  }
  function enable(renew=false){
    if(pendingEnable)return pendingEnable;
    // Invoke the browser prompt in the user gesture, before any network await.
    const permissionRequest=!native()&&!desktop()&&window.Notification?Promise.resolve(renew?Notification.permission:Notification.requestPermission()).catch(()=> 'denied'):null;
    pendingEnable=register(renew,permissionRequest).finally(()=>{pendingEnable=null;});
    return pendingEnable;
  }
  async function register(renew,permissionRequest){
    if(pendingDisconnect)await pendingDisconnect;
    const epoch=generation;
    const uid=owner();if(!uid||uid.startsWith('guest:'))throw Error('กรุณาเข้าสู่ระบบก่อน');
    const old=stored();if(old&&(old.owner!==uid||old.disabled))await disconnectDevice();
    if(desktop()){
      const bridge=window.panthoriumDesktop;
      if(!bridge.setNotificationBackground||!bridge.showNotification)throw Error('กรุณาอัปเดต Panthorium Browser เพื่อเปิดป๊อบอัพและรับแจ้งเตือนเมื่อปิดหน้าต่าง');
      const account=await bridge.setBrowserAccount(uid);if(!account.ok)throw Error('ผูกการแจ้งเตือนกับบัญชีไม่สำเร็จ');
      const result=await bridge.setNotificationBackground(true);
      if(!result.ok)throw Error('เปิดการแจ้งเตือนบนคอมพิวเตอร์ไม่สำเร็จ: '+result.error);
      if(owner()!==uid||epoch!==generation){await bridge.setNotificationBackground(false);throw Error('ยกเลิกการลงทะเบียนอุปกรณ์แล้ว');}
      localStorage.setItem(key,JSON.stringify({kind:'desktop',owner:uid}));verified=true;lastRenewal=Date.now();
      window.dispatchEvent(new Event('panthorium:push-changed'));return result;
    }
    const config=await api('config');if(!config.available)throw Error('เซิร์ฟเวอร์ยังไม่พร้อมรับ Push Notification');
    let subscription,reg;
    if(native()){
      const p=plugin();if(!config.nativeAvailable||!p)throw Error('แอป Android ยังไม่ได้เชื่อม Firebase หรือจำเป็นต้องอัปเดต APK');
      const permission=await (renew?p.checkPermissions():p.requestPermissions());if(permission.receive!=='granted')throw Error('ยังไม่ได้อนุญาตแจ้งเตือนบนอุปกรณ์');
      const channels=await window.Capacitor?.Plugins?.PanthoriumNotifications?.prepareChannels();
      if(channels&&channels.enabled!==true)throw Error('ระบบ Android ปิดการแจ้งเตือนของแอพอยู่ กรุณาเปิดในการตั้งค่าอุปกรณ์');
      if(!channels){
        await p.createChannel({id:'panthorium_alerts',name:'การแจ้งเตือน Panthorium',importance:4,visibility:0});
        await p.createChannel({id:'panthorium_silent',name:'การแจ้งเตือนแบบเงียบ',importance:2,visibility:0});
      }
      const token=await new Promise(async(resolve,reject)=>{
        let success,error;const cleanup=()=>{clearTimeout(timer);success?.remove();error?.remove();};
        const timer=setTimeout(()=>{cleanup();reject(Error('ลงทะเบียนอุปกรณ์หมดเวลา'));},15000);
        try{success=await p.addListener('registration',data=>{cleanup();resolve(data.value);});error=await p.addListener('registrationError',()=>{cleanup();reject(Error('ลงทะเบียน Firebase ไม่สำเร็จ'));});await p.register();}catch(e){cleanup();reject(e);}
      });subscription={kind:'fcm',token,...(channels?.version===2?{popupChannels:2}:{})};
    }else{
      // Permission request stays inside the explicit user action.
      if(!window.Notification||await permissionRequest!=='granted')throw Error('ยังไม่ได้อนุญาตแจ้งเตือนบนอุปกรณ์');
      reg=await worker();
      const raw=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
      const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});subscription=sub.toJSON();
    }
    if(owner()!==uid||epoch!==generation){if(native())await plugin().unregister();else await(await reg.pushManager.getSubscription())?.unsubscribe();throw Error('ยกเลิกการลงทะเบียนอุปกรณ์แล้ว');}
    const result=await api('subscribe',{method:'POST',body:JSON.stringify({subscription})});
    localStorage.setItem(key,JSON.stringify({...result,owner:uid,base:base()}));
    if(owner()!==uid||epoch!==generation){await disconnectDevice();throw Error('ยกเลิกการลงทะเบียนอุปกรณ์แล้ว');}
    try{if(reg)await bind(reg,result.binding);}catch(error){await disconnectDevice().catch(()=>{});throw error;}
    if(owner()!==uid||epoch!==generation){await disconnectDevice();throw Error('ยกเลิกการลงทะเบียนอุปกรณ์แล้ว');}
    if(old&&old.id!==result.id)await fetch(old.base+'/api/notifications/push/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:old.id,token:old.revokeToken})}).catch(()=>{});
    verified=true;lastRenewal=Date.now();
    window.dispatchEvent(new Event('panthorium:push-changed'));return result;
  }
  function open(){window.PanthoriumNotifications?.open();}
  window.addEventListener('panthorium:open-notifications',open);
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='panthorium:open-notifications')open();});
  window.addEventListener('panthorium:auth-changed',()=>{
    const device=stored(),uid=owner();if(device&&device.owner!==uid)disconnect().catch(()=>{});
    else renewDevice();
    if(uid&&!uid.startsWith('guest:')&&new URL(location.href).searchParams.get('notifications')==='1'){open();const url=new URL(location.href);url.searchParams.delete('notifications');history.replaceState(null,'',url);}
  });
  function renewDevice(){const device=stored();if(device&&!device.disabled&&device.owner===owner()&&Date.now()-lastRenewal>3600000)enable(true).catch(()=>{verified=false;window.dispatchEvent(new Event('panthorium:push-changed'));});}
  window.addEventListener('panthorium:boot-complete',renewDevice);
  window.addEventListener('online',renewDevice);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')renewDevice();});
  if(native())plugin()?.addListener('pushNotificationActionPerformed',open);
  async function show(item,silent=true){
    const uid=owner();
    if(desktop()){
      if(!verified)return false;
      const result=await window.panthoriumDesktop.showNotification({id:item.id,silent});
      if(!result.ok)throw Error('แสดงป๊อบอัพไม่สำเร็จ: '+result.error);
      return true;
    }
    if(native()||window.Notification?.permission!=='granted')return false;
    // showNotification works on Android browsers, where new Notification()
    // is unsupported. Use the same tag as remote Push to avoid duplicate cards.
    if(navigator.serviceWorker){
      const reg=await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if(uid!==owner())return false;
      if(!(await reg.getNotifications({tag:item.id})).length)await reg.showNotification('Panthorium',{body:'มีการแจ้งเตือนใหม่ เปิด Panthorium เพื่อดูรายละเอียด',tag:item.id,silent,data:{url:'/?notifications=1'},icon:'/panthorium-logo.png'});
      return true;
    }
    return false;
  }
  async function check(){
    const device=stored();if(!device||device.disabled||device.owner!==owner())return {registered:false};
    if(desktop())return {registered:verified,kind:'desktop'};
    const result=await api('status?id='+encodeURIComponent(device.id));
    if(!result.registered){verified=false;window.dispatchEvent(new Event('panthorium:push-changed'));}
    return result;
  }
  window.PanthoriumPush={enable:()=>enable(false),disconnect,show,check,active:()=>verified&&!!stored()&&!stored().disabled&&stored().owner===owner()&&(native()||desktop()||window.Notification?.permission==='granted'),native,desktop};
})();
