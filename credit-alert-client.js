(function(){
  'use strict';
  let owner='',generation=0,busy=false,timer=null,banner=null;
  const seen=new Map();
  const system=()=>{try{return typeof OS!=='undefined'?OS:null;}catch{return null;}};
  function account(){const user=system()?.state?.user;return user&&!user.isGuest&&!user.roles?.includes('guest')?String(user.sub||user.id||''):'';}
  function reset(){const next=account();if(next===owner)return;owner=next;generation++;busy=false;seen.clear();banner?.remove();banner=null;}
  function prior(key){try{return Math.max(seen.get(key)||0,Number(sessionStorage.getItem('panthorium-credit-alert:'+key))||0);}catch{return seen.get(key)||0;}}
  function remember(key,level){seen.set(key,level);try{sessionStorage.setItem('panthorium-credit-alert:'+key,String(level));}catch{}}
  function show(usage){
    banner?.remove();banner=document.createElement('section');banner.dataset.creditWarning='';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
    banner.style.cssText='position:fixed;bottom:72px;right:16px;max-width:min(420px,calc(100vw - 32px));z-index:11000;background:#172334;color:#fff;border:1px solid #f5c76b;border-radius:12px;padding:16px;box-shadow:0 8px 32px #0006;font:14px/1.5 system-ui';
    const message=document.createElement('p');message.textContent=usage.threshold===100?'เครดิต Sentinel AI หมดแล้ว เลือกแพ็กเกจหรือเพิ่มเครดิตเพื่อใช้งานต่อ':`ใช้เครดิต Sentinel AI ถึง ${usage.threshold}% แล้ว เหลือ ${usage.remaining.toLocaleString('th-TH')} เครดิต`;
    const buy=document.createElement('button');buy.type='button';buy.textContent='ดูแพ็กเกจ / เพิ่มเครดิต';buy.onclick=()=>window.PanthoriumBilling?.open?.();
    const close=document.createElement('button');close.type='button';close.textContent='ปิด';close.onclick=()=>banner?.remove();
    for(const button of [buy,close])button.style.cssText='padding:8px 12px;margin-right:8px;min-height:44px;cursor:pointer';
    banner.append(message,buy,close);document.body.append(banner);
  }
  function observe(state){
    reset();if(!owner)return;
    const usage=state?.creditUsage;
    if(!usage||usage.unlimited||state?.unlimited?.includes('aiCredits')){banner?.remove();banner=null;return;}
    if(!/^[a-f0-9]{32}$/.test(usage.cycleId||'')||!Number.isSafeInteger(usage.remaining)||usage.remaining<0||!Number.isSafeInteger(usage.limit)||usage.limit<=0)return;
    if(![90,95,100].includes(usage.threshold)){banner?.remove();banner=null;return;}
    if(usage.threshold===100&&usage.remaining!==0)return;
    const key=owner+':'+usage.cycleId;if(prior(key)>=usage.threshold)return;
    show(usage);remember(key,usage.threshold);
    // Only open the internal catalog. Never choose an item, submit a checkout,
    // launch an external payment URL, or turn a connection error into a sale.
    if(usage.threshold===100&&window.PanthoriumBilling?.open?.()===false)seen.delete(key);
  }
  async function refresh(){
    reset();if(!owner||busy||document.visibilityState==='hidden')return;
    const auth=window.PanthoriumAuth,token=auth?.getAccessToken?.();if(!token)return;
    const expected=owner,version=generation;busy=true;
    try{
      const base=String(auth?.getBackendUrl?.()||system()?.config?.backendUrl||'').replace(/\/$/,'');
      const response=await fetch(base+'/api/billing/entitlements',{headers:{Authorization:'Bearer '+token},credentials:'include',signal:AbortSignal.timeout(12000)});
      if(!response.ok)return;
      const state=await response.json();
      if(expected===account()&&version===generation)observe(state);
    }catch{/* Connection failures do not imply an empty balance. */}
    finally{if(version===generation)busy=false;}
  }
  function start(){clearInterval(timer);timer=setInterval(refresh,30000);refresh();}
  window.PanthoriumCreditAlerts={refresh,observe};
  window.addEventListener('panthorium:auth-changed',()=>{reset();refresh();});
  window.addEventListener('panthorium:ai-done',event=>{if(!event.detail?.accountId||event.detail.accountId===account())refresh();});
  window.addEventListener('panthorium:live-stop',refresh);
  window.addEventListener('pageshow',start);
  window.addEventListener('pagehide',()=>clearInterval(timer));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden')refresh();});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
