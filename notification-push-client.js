(function(){
  'use strict';
  const key='panthorium-push-device-v1';
  const os=()=>typeof OS!=='undefined'?OS:window.OS;
  const owner=()=>String(os()?.state?.user?.sub||os()?.state?.user?.id||'');
  const native=()=>window.Capacitor?.isNativePlatform?.()===true;
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
  async function disconnect(){
    const device=stored();
    if(native())await plugin()?.unregister().catch(()=>{});
    else if(navigator.serviceWorker){const reg=await navigator.serviceWorker.getRegistration();if(reg){await bind(reg,null);await (await reg.pushManager?.getSubscription())?.unsubscribe();}}
    if(device){
      const response=await fetch(device.base+'/api/notifications/push/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:device.id,token:device.revokeToken}),keepalive:true});
      if(!response.ok)throw Error('ยกเลิกการผูกอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    localStorage.removeItem(key);window.dispatchEvent(new Event('panthorium:push-changed'));
  }
  async function enable(){
    const uid=owner();if(!uid||uid.startsWith('guest:'))throw Error('กรุณาเข้าสู่ระบบก่อน');
    const permissionRequest=!native()&&window.Notification?Notification.requestPermission():null;
    const old=stored();if(old&&old.owner!==uid)await disconnect();
    const config=await api('config');if(!config.available)throw Error('เซิร์ฟเวอร์ยังไม่พร้อมรับ Push Notification');
    let subscription,reg;
    if(native()){
      const p=plugin();if(!config.nativeAvailable||!p)throw Error('แอป Android ยังไม่ได้เชื่อม Firebase หรือจำเป็นต้องอัปเดต APK');
      const permission=await p.requestPermissions();if(permission.receive!=='granted')throw Error('ยังไม่ได้อนุญาตแจ้งเตือนบนอุปกรณ์');
      await p.createChannel({id:'panthorium_alerts',name:'การแจ้งเตือน Panthorium',importance:4,visibility:0});
      await p.createChannel({id:'panthorium_silent',name:'การแจ้งเตือนแบบเงียบ',importance:2,visibility:0});
      const token=await new Promise(async(resolve,reject)=>{
        let success,error;const cleanup=()=>{clearTimeout(timer);success?.remove();error?.remove();};
        const timer=setTimeout(()=>{cleanup();reject(Error('ลงทะเบียนอุปกรณ์หมดเวลา'));},15000);
        try{success=await p.addListener('registration',data=>{cleanup();resolve(data.value);});error=await p.addListener('registrationError',()=>{cleanup();reject(Error('ลงทะเบียน Firebase ไม่สำเร็จ'));});await p.register();}catch(e){cleanup();reject(e);}
      });subscription={kind:'fcm',token};
    }else{
      // Permission request stays inside the explicit user action.
      if(!window.Notification||await permissionRequest!=='granted')throw Error('ยังไม่ได้อนุญาตแจ้งเตือนบนอุปกรณ์');
      reg=await worker();
      const raw=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
      const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});subscription=sub.toJSON();
    }
    if(owner()!==uid){if(native())await plugin().unregister();else await(await reg.pushManager.getSubscription())?.unsubscribe();throw Error('บัญชีเปลี่ยนระหว่างลงทะเบียน');}
    const result=await api('subscribe',{method:'POST',body:JSON.stringify({subscription})});
    localStorage.setItem(key,JSON.stringify({...result,owner:uid,base:base()}));
    if(owner()!==uid){await disconnect();throw Error('บัญชีเปลี่ยนระหว่างลงทะเบียน');}
    if(reg)await bind(reg,result.binding);
    window.dispatchEvent(new Event('panthorium:push-changed'));return result;
  }
  function open(){window.PanthoriumNotifications?.open();}
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='panthorium:open-notifications')open();});
  window.addEventListener('panthorium:auth-changed',()=>{
    const device=stored(),uid=owner();if(device&&device.owner!==uid)disconnect().catch(()=>{});
    if(uid&&!uid.startsWith('guest:')&&new URL(location.href).searchParams.get('notifications')==='1'){open();const url=new URL(location.href);url.searchParams.delete('notifications');history.replaceState(null,'',url);}
  });
  if(native())plugin()?.addListener('pushNotificationActionPerformed',open);
  window.PanthoriumPush={enable,disconnect,active:()=>stored()?.owner===owner()&&(native()||window.Notification?.permission==='granted'),native};
})();
