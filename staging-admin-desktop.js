(function(){
'use strict';
const STAGING_HOST='panthorium-staging.onrender.com';
function isTarget(){return location.hostname===STAGING_HOST&&(/^\/admin(?:\/|\.html)?$/.test(location.pathname));}
if(!isTarget())return;
let observer=null;let initialized=false;
function closeMenu(){try{document.getElementById('start-menu')?.classList.remove('open');}catch(_){}}
function ensureStyle(){if(document.getElementById('staging-admin-desktop-style'))return;const style=document.createElement('style');style.id='staging-admin-desktop-style';style.textContent=`
#desktop-icons.staging-admin-grid{top:18px;left:18px;right:18px;bottom:70px;width:auto;display:grid!important;grid-template-columns:repeat(auto-fill,minmax(92px,112px));grid-auto-rows:min-content;align-content:start;gap:18px 14px;overflow:auto;padding:4px;pointer-events:auto;}
#desktop-icons.staging-admin-grid .staging-desktop-app{width:100%;min-height:88px;display:flex!important;flex-direction:column;align-items:center;justify-content:flex-start;gap:7px;padding:7px 4px;border:0!important;border-radius:10px;background:transparent!important;color:#e8f0ff!important;cursor:pointer;font:inherit;text-align:center;box-shadow:none!important;outline-offset:3px;}
#desktop-icons.staging-admin-grid .staging-desktop-app:hover,#desktop-icons.staging-admin-grid .staging-desktop-app:focus-visible{background:rgba(0,255,204,.08)!important;}
#desktop-icons.staging-admin-grid .staging-desktop-app .ico,#desktop-icons.staging-admin-grid .staging-desktop-app .icon-img{width:48px!important;height:48px!important;display:flex;align-items:center;justify-content:center;font-size:30px!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;}
#desktop-icons.staging-admin-grid .staging-desktop-app span{display:block;font-size:12px;line-height:1.25;color:#e8f0ff;text-shadow:0 1px 3px #000;white-space:normal;}
#start-menu #sm-apps{display:none!important;}
#start-menu #btn-settings-quick{display:none!important;}
#start-menu .sm-footer{display:flex!important;gap:8px;padding:12px;}
#start-menu .sm-footer button{flex:1;min-height:38px;}
@media(max-width:700px){#desktop-icons.staging-admin-grid{grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:12px 8px;}#desktop-icons.staging-admin-grid .staging-desktop-app{min-height:80px;}#desktop-icons.staging-admin-grid .staging-desktop-app .ico,#desktop-icons.staging-admin-grid .staging-desktop-app .icon-img{font-size:26px!important;width:42px!important;height:42px!important;}}
`;document.head.appendChild(style);}
function normalizeLauncher(node){if(!(node instanceof HTMLElement))return;node.classList.add('staging-desktop-app');node.style.display='';node.style.background='transparent';node.style.border='0';node.style.boxShadow='none';const ico=node.querySelector('.ico,.icon-img');if(ico){ico.style.background='transparent';ico.style.border='0';ico.style.boxShadow='none';}node.addEventListener('click',closeMenu,{passive:true});}
function moveLaunchers(){const source=document.getElementById('sm-apps'),desktop=document.getElementById('desktop-icons');if(!source||!desktop)return;ensureStyle();desktop.classList.add('staging-admin-grid');if(!initialized){desktop.innerHTML='';initialized=true;}[...source.children].forEach(node=>{normalizeLauncher(node);desktop.appendChild(node);});}
function ensureRestart(){const footer=document.querySelector('#start-menu .sm-footer');if(!footer)return;const settings=document.getElementById('btn-settings-quick');if(settings)settings.style.display='none';let restart=document.getElementById('btn-restart');if(!restart){restart=document.createElement('button');restart.id='btn-restart';restart.textContent='🔄 รีสตาร์ท';restart.title='รีสตาร์ท Panthorium';restart.onclick=()=>{closeMenu();location.reload();};footer.insertBefore(restart,footer.firstChild);}const logout=document.getElementById('btn-logout');if(logout){logout.style.display='';}}
function setup(){if(!isTarget())return;moveLaunchers();ensureRestart();const source=document.getElementById('sm-apps');if(source&&!observer){observer=new MutationObserver(()=>{moveLaunchers();ensureRestart();});observer.observe(source,{childList:true});}}
window.addEventListener('panthorium:auth-changed',()=>setTimeout(setup,0));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(setup,0),{once:true});else setTimeout(setup,0);
setTimeout(setup,500);setTimeout(setup,1600);
window.PanthoriumStagingAdminDesktop={sync:setup};
})();
