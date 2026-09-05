(function(){
'use strict';
const BACKOFFICE_IDS=['sentinel-training-launcher','phase4-ai-launcher','phase5-agent-launcher','phase6-automation-launcher','phase7-memory-launcher','phase8-multi-agent-launcher','phase9-integrations-launcher','phase10-production-launcher','phase3-security-launcher','phase2-user-manager-launcher'];
const BACKOFFICE_WORDS=['Sentinel Training Lab','AI Platform','Sentinel Agent','Agent Automation','Memory & Knowledge','Multi-Agent','Integrations','Production Intelligence','Security Dashboard','User Management'];
function auth(){return window.PanthoriumAuth;}
function guest(){try{return auth()?.isGuest?.()===true;}catch(_){return false;}}
function admin(){try{return auth()?.isAdministrator?.()===true;}catch(_){return false;}}
function sync(){
 const menu=document.getElementById('start-menu'); if(!menu)return;
 const isGuest=guest();
 BACKOFFICE_IDS.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=isGuest?'none':'';});
 menu.querySelectorAll('button').forEach(btn=>{const text=(btn.textContent||'').trim();if(BACKOFFICE_WORDS.some(word=>text.includes(word)))btn.style.display=isGuest?'none':'';});
 const settingsQuick=document.getElementById('btn-settings-quick');if(settingsQuick)settingsQuick.style.display=isGuest?'none':'';
 if(typeof APP_LIST!=='undefined'&&Array.isArray(APP_LIST)){
   document.querySelectorAll('#sm-apps .sm-app').forEach(el=>{const text=(el.textContent||'').trim();if(isGuest&&text.includes('ตั้งค่า'))el.style.display='none';else if(!isGuest)el.style.display='';});
 }
 const footer=document.getElementById('btn-logout');if(footer){if(isGuest){footer.textContent='🔐 เข้าสู่ระบบผู้ดูแล';footer.title='ไปหน้าผู้ดูแล';footer.onclick=()=>{location.href='/admin';};}else if(admin()){footer.textContent='🚪 ออกจากระบบ';footer.title='ออกจากระบบ';footer.onclick=()=>auth()?.logout?.();}}
}
function loadStagingAdminDesktop(){
 if(location.hostname!=='panthorium-staging.onrender.com'||!(/^\/admin(?:\/|\.html)?$/.test(location.pathname)))return;
 if(document.getElementById('staging-admin-desktop-script'))return;
 const script=document.createElement('script');script.id='staging-admin-desktop-script';script.src='/staging-admin-desktop.js?v=staging-admin-desktop-v1';script.defer=true;document.head.appendChild(script);
}
window.addEventListener('panthorium:auth-changed',()=>setTimeout(sync,0));
document.addEventListener('DOMContentLoaded',sync,{once:true});
setInterval(sync,750);setTimeout(sync,0);loadStagingAdminDesktop();
window.PanthoriumAccessShell={sync};
})();
