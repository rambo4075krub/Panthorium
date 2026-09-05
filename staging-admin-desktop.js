(function(){
'use strict';
const STAGING_HOST='panthorium-staging.onrender.com';
function isTarget(){return location.hostname===STAGING_HOST&&(/^\/admin(?:\/|\.html)?$/.test(location.pathname));}
if(!isTarget())return;
let initialized=false;
const moved=new Set();
function closeMenu(){document.getElementById('start-menu')?.classList.remove('open');}
function ensureStyle(){if(document.getElementById('staging-admin-desktop-style'))return;const style=document.createElement('style');style.id='staging-admin-desktop-style';style.textContent=`
#desktop-icons.staging-admin-stack{position:absolute!important;top:18px!important;left:18px!important;right:auto!important;bottom:70px!important;width:150px!important;height:auto!important;display:flex!important;flex-direction:column!important;flex-wrap:nowrap!important;align-items:flex-start!important;justify-content:flex-start!important;gap:6px!important;padding:2px!important;overflow-y:auto!important;overflow-x:hidden!important;pointer-events:auto!important;z-index:3;}
#desktop-icons.staging-admin-stack .staging-desktop-app{position:relative!important;inset:auto!important;transform:none!important;width:142px!important;min-height:54px!important;height:auto!important;display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:flex-start!important;gap:10px!important;margin:0!important;padding:5px 4px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#e8f0ff!important;cursor:pointer!important;font:inherit!important;text-align:left!important;box-shadow:none!important;transition:background .12s ease!important;animation:none!important;opacity:1!important;visibility:visible!important;}
#desktop-icons.staging-admin-stack .staging-desktop-app:hover,#desktop-icons.staging-admin-stack .staging-desktop-app:focus-visible{background:rgba(0,255,204,.08)!important;}
#desktop-icons.staging-admin-stack .staging-desktop-app .ico,#desktop-icons.staging-admin-stack .staging-desktop-app .icon-img{flex:0 0 38px!important;width:38px!important;height:38px!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:25px!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;padding:0!important;animation:none!important;}
#desktop-icons.staging-admin-stack .staging-desktop-app span{display:block!important;min-width:0!important;font-size:11px!important;line-height:1.2!important;color:#e8f0ff!important;text-shadow:0 1px 3px #000!important;white-space:normal!important;}
#start-menu #sm-apps{display:none!important;}
#start-menu #btn-settings-quick{display:none!important;}
#start-menu .sm-footer{display:flex!important;gap:8px!important;padding:12px!important;}
#start-menu .sm-footer button{flex:1!important;min-height:38px!important;}
@media(max-width:700px){#desktop-icons.staging-admin-stack{top:10px!important;left:8px!important;width:132px!important;gap:3px!important;}#desktop-icons.staging-admin-stack .staging-desktop-app{width:126px!important;min-height:48px!important;gap:7px!important;}#desktop-icons.staging-admin-stack .staging-desktop-app .ico,#desktop-icons.staging-admin-stack .staging-desktop-app .icon-img{flex-basis:32px!important;width:32px!important;height:32px!important;font-size:22px!important;}#desktop-icons.staging-admin-stack .staging-desktop-app span{font-size:10px!important;}}
`;document.head.appendChild(style);}
function normalizeLauncher(node){if(!(node instanceof HTMLElement))return;node.classList.add('staging-desktop-app');node.removeAttribute('style');const ico=node.querySelector('.ico,.icon-img');if(ico)ico.removeAttribute('style');if(!node.dataset.stagingCloseBound){node.addEventListener('click',closeMenu,{passive:true});node.dataset.stagingCloseBound='1';}}
function moveNewLaunchers(){const source=document.getElementById('sm-apps'),desktop=document.getElementById('desktop-icons');if(!source||!desktop)return;ensureStyle();desktop.classList.add('staging-admin-stack');if(!initialized){desktop.replaceChildren();initialized=true;}const nodes=[...source.children];for(const node of nodes){if(!(node instanceof HTMLElement))continue;const key=node.id||node.textContent?.trim()||String(moved.size);if(moved.has(key)&&node.parentElement===desktop)continue;normalizeLauncher(node);desktop.appendChild(node);moved.add(key);}}
function ensureRestart(){const footer=document.querySelector('#start-menu .sm-footer');if(!footer)return;const settings=document.getElementById('btn-settings-quick');if(settings)settings.style.display='none';let restart=document.getElementById('btn-restart');if(!restart){restart=document.createElement('button');restart.id='btn-restart';restart.textContent='🔄 รีสตาร์ท';restart.title='รีสตาร์ท Panthorium';restart.onclick=()=>{closeMenu();location.reload();};footer.insertBefore(restart,footer.firstChild);}const logout=document.getElementById('btn-logout');if(logout)logout.style.display='';}
function setup(){if(!isTarget())return;moveNewLaunchers();ensureRestart();}
window.addEventListener('panthorium:auth-changed',()=>requestAnimationFrame(setup));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(setup),{once:true});else requestAnimationFrame(setup);
/* A few one-shot syncs cover late module registration without a perpetual observer/poller. */
[250,700,1400,2600].forEach(ms=>setTimeout(setup,ms));
window.PanthoriumStagingAdminDesktop={sync:setup};
})();
