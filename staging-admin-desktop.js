(function(){
'use strict';

const STAGING_HOST='panthorium-staging.onrender.com';
const TARGET_PATH=/^\/admin(?:\/|\.html)?$/;
const APPS=[
  {id:'sentinel',icon:'🤖',label:'Sentinel AI',openers:['openSentinel']},
  {id:'settings',icon:'⚙️',label:'ตั้งค่า',openers:['openSettings']},
  {id:'security',icon:'🛡️',label:'Security',openers:['PanthoriumSecurityDashboard.open','openSecurityDashboard'],launcherId:'phase3-security-start'},
  {id:'ai-platform',icon:'🧠',label:'AI Platform',openers:['PanthoriumAI.open'],launcherId:'phase4-ai-launcher'},
  {id:'sentinel-agent',icon:'🤖',label:'Sentinel Agent',openers:['PanthoriumAgent.open'],launcherId:'phase5-agent-launcher'},
  {id:'agent-automation',icon:'⚡',label:'Agent Automation',openers:['PanthoriumAutomation.open'],launcherId:'phase6-automation-launcher'},
  {id:'memory-knowledge',icon:'🧠',label:'Memory & Knowledge',openers:['PanthoriumMemoryKnowledge.open'],launcherId:'phase7-memory-launcher'},
  {id:'multi-agent',icon:'🧠',label:'Multi-Agent',openers:['PanthoriumMultiAgent.open'],launcherId:'phase8-multi-agent-launcher'},
  {id:'integrations',icon:'🔌',label:'Integrations',openers:['PanthoriumIntegrations.open'],launcherId:'phase9-integrations-launcher'},
  {id:'training-lab',icon:'🎓',label:'Training Lab',openers:['PanthoriumTraining.open'],launcherId:'sentinel-training-launcher'},
  {id:'production',icon:'📈',label:'Production Intelligence',openers:['PanthoriumProductionIntelligence.open'],launcherId:'phase10-production-launcher'},
  {id:'governance',icon:'🧭',label:'Governance',openers:['PanthoriumGovernance.open'],launcherId:'phase13-governance-launcher'},
  {id:'sentinel-control',icon:'🛡️',label:'Sentinel Control',openers:['PanthoriumSentinelControl.open']}
];

let renderedFingerprint='';

function isTarget(){return location.hostname===STAGING_HOST&&TARGET_PATH.test(location.pathname);}
if(!isTarget())return;

function auth(){return window.PanthoriumAuth||null;}
function closeMenu(){document.getElementById('start-menu')?.classList.remove('open');}
function notify(message){try{if(typeof toast==='function')toast(message);else console.warn('[DesktopManagerV2]',message);}catch(_){console.warn('[DesktopManagerV2]',message);}}
function resolve(path){return String(path||'').split('.').reduce((obj,key)=>obj&&obj[key],window);}
function openerReady(app){return (app.openers||[]).some(path=>typeof resolve(path)==='function')||!!(app.launcherId&&document.getElementById(app.launcherId));}
function removeLegacyFloatingLaunchers(){document.querySelectorAll('[data-production-intelligence="1"]').forEach(node=>{if(!node.closest('#sm-apps'))node.remove();});}
function openApp(app){
  closeMenu();
  for(const path of app.openers||[]){const fn=resolve(path);if(typeof fn==='function'){fn();return;}}
  const launcher=app.launcherId?document.getElementById(app.launcherId):null;
  if(launcher){launcher.click();return;}
  notify(`${app.label} ยังโหลดไม่เสร็จ กรุณารอสักครู่แล้วกดใหม่`);
}
function ensureStyle(){
  if(document.getElementById('staging-admin-desktop-v2-style'))return;
  const style=document.createElement('style');style.id='staging-admin-desktop-v2-style';style.textContent=`
#desktop-icons.staging-admin-desktop-v2{top:14px!important;left:14px!important;right:auto!important;bottom:54px!important;width:min(32vw,292px)!important;display:grid!important;grid-auto-flow:column!important;grid-auto-columns:88px!important;grid-template-rows:repeat(auto-fill,64px)!important;align-content:start!important;justify-content:start!important;place-items:start center!important;column-gap:8px!important;row-gap:10px!important;overflow:visible!important;padding:2px 2px 12px!important;z-index:30!important;pointer-events:auto!important;}
#desktop-icons.staging-admin-desktop-v2>*:not([data-desktop-v2="1"]){display:none!important;}
#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app{width:88px!important;min-height:64px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:flex-start!important;gap:4px!important;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:transparent!important;color:#e8f0ff!important;cursor:pointer!important;font:inherit!important;text-align:center!important;box-shadow:none!important;outline-offset:4px!important;opacity:1!important;visibility:visible!important;user-select:none!important;}
#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app:hover,#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app:focus-visible{background:transparent!important;color:#00ffcc!important;text-shadow:0 0 10px rgba(0,255,204,.35)!important;}
#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app-icon{width:38px!important;height:38px!important;min-width:38px!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:25px!important;line-height:1!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;padding:0!important;filter:drop-shadow(0 2px 5px rgba(0,0,0,.75));}
#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app-label{display:block!important;width:88px!important;max-width:88px!important;font-size:10.5px!important;line-height:1.12!important;color:#e8f0ff!important;text-align:center!important;text-shadow:0 1px 3px #000!important;white-space:normal!important;overflow-wrap:anywhere!important;}
#start-menu #sm-apps{display:none!important;}
#start-menu #btn-settings-quick{display:none!important;}
#start-menu .sm-footer{display:flex!important;gap:8px!important;padding:12px!important;}
#start-menu .sm-footer button{flex:1!important;min-height:38px!important;}
@media(max-height:820px){#desktop-icons.staging-admin-desktop-v2{top:10px!important;bottom:48px!important;grid-template-rows:repeat(auto-fill,58px)!important;row-gap:7px!important;}#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app{min-height:58px!important;}#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app-icon{width:34px!important;height:34px!important;min-width:34px!important;font-size:22px!important;}#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app-label{font-size:9.5px!important;line-height:1.08!important;}}
@media(max-width:700px){#desktop-icons.staging-admin-desktop-v2{left:10px!important;width:min(42vw,190px)!important;grid-auto-columns:80px!important;grid-template-rows:repeat(auto-fill,56px)!important;column-gap:6px!important;row-gap:6px!important;}#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app{width:80px!important;min-height:56px!important;}#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app-icon{width:32px!important;height:32px!important;min-width:32px!important;font-size:21px!important;}#desktop-icons.staging-admin-desktop-v2 .panthorium-desktop-app-label{width:80px!important;max-width:80px!important;font-size:9px!important;}}
`;document.head.appendChild(style);
}
function createIcon(app){
  const button=document.createElement('button');button.type='button';button.className='panthorium-desktop-app';button.dataset.desktopV2='1';button.dataset.appId=app.id;button.setAttribute('aria-label',app.label);button.title=app.label;
  const icon=document.createElement('span');icon.className='panthorium-desktop-app-icon';icon.setAttribute('aria-hidden','true');icon.textContent=app.icon;
  const label=document.createElement('span');label.className='panthorium-desktop-app-label';label.textContent=app.label;
  button.append(icon,label);button.onclick=()=>openApp(app);return button;
}
function renderDesktop(){
  if(!isTarget())return false;
  const desktop=document.getElementById('desktop-icons');if(!desktop)return false;
  ensureStyle();removeLegacyFloatingLaunchers();
  const visibleApps=APPS.slice();
  const fingerprint=visibleApps.map(app=>`${app.id}:${openerReady(app)?'ready':'pending'}`).join('|');
  desktop.className='desktop-icons staging-admin-desktop-v2';
  desktop.style.display='grid';
  if(renderedFingerprint===fingerprint&&desktop.querySelectorAll('[data-desktop-v2="1"]').length===visibleApps.length)return true;
  desktop.replaceChildren(...visibleApps.map(createIcon));
  desktop.dataset.desktopManager='v2';
  renderedFingerprint=fingerprint;
  window.dispatchEvent(new CustomEvent('panthorium:desktop-ready',{detail:{manager:'DesktopManagerV2',apps:visibleApps.map(app=>app.id),layout:'wrapped-columns'}}));
  return true;
}
function configureStartMenu(){
  const footer=document.querySelector('#start-menu .sm-footer');
  const apps=document.getElementById('sm-apps');
  const settings=document.getElementById('btn-settings-quick');
  if(apps){apps.style.display='none';apps.setAttribute('aria-hidden','true');}
  if(settings)settings.style.display='none';
  if(!footer)return;
  let restart=document.getElementById('btn-restart');
  if(!restart){restart=document.createElement('button');restart.id='btn-restart';restart.type='button';restart.textContent='🔄 รีสตาร์ท';restart.title='รีสตาร์ท Panthorium';restart.onclick=()=>{closeMenu();location.reload();};footer.insertBefore(restart,footer.firstChild);}
  const logout=document.getElementById('btn-logout');if(logout){logout.style.display='';if(auth()?.isGuest?.()){logout.textContent='🔐 เข้าสู่ระบบผู้ดูแล';logout.onclick=()=>{location.href='/admin';};}else{logout.textContent='🚪 ออกจากระบบ';logout.onclick=()=>auth()?.logout?.();}}
}
function sync(){if(!isTarget())return;removeLegacyFloatingLaunchers();configureStartMenu();renderDesktop();}
function syncAfterShell(){requestAnimationFrame(()=>{sync();requestAnimationFrame(sync);});}

window.addEventListener('panthorium:auth-changed',syncAfterShell);
window.addEventListener('panthorium:apps-changed',syncAfterShell);
window.addEventListener('panthorium:boot-complete',syncAfterShell);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',syncAfterShell,{once:true});else syncAfterShell();
window.PanthoriumStagingAdminDesktop={sync,render:renderDesktop,apps:APPS.slice()};
})();
