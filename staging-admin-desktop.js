(function(){
'use strict';
const STAGING_HOST='panthorium-staging.onrender.com';
function isTarget(){return location.hostname===STAGING_HOST&&(/^\/admin(?:\/|\.html)?$/.test(location.pathname));}
if(!isTarget())return;
let observer=null;let syncTimer=null;let attempts=0;
const MAX_ATTEMPTS=40;
function closeMenu(){document.getElementById('start-menu')?.classList.remove('open');}
function ensureStyle(){if(document.getElementById('staging-admin-desktop-style'))return;const style=document.createElement('style');style.id='staging-admin-desktop-style';style.textContent=`
#desktop-icons.staging-admin-list{top:18px!important;left:18px!important;bottom:70px!important;width:180px!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:8px!important;overflow:auto!important;padding:4px 6px!important;z-index:20!important;}
#desktop-icons.staging-admin-list .staging-desktop-app{width:168px!important;min-height:54px!important;display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:flex-start!important;gap:12px!important;padding:6px 4px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#e8f0ff!important;cursor:pointer!important;font:inherit!important;text-align:left!important;box-shadow:none!important;outline-offset:3px!important;opacity:1!important;visibility:visible!important;}
#desktop-icons.staging-admin-list .staging-desktop-app:hover,#desktop-icons.staging-admin-list .staging-desktop-app:focus-visible{background:rgba(0,255,204,.08)!important;}
#desktop-icons.staging-admin-list .staging-desktop-app .ico,#desktop-icons.staging-admin-list .staging-desktop-app .icon-img{width:42px!important;height:42px!important;min-width:42px!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:26px!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;}
#desktop-icons.staging-admin-list .staging-desktop-app span{display:block!important;font-size:12px!important;line-height:1.25!important;color:#e8f0ff!important;text-shadow:0 1px 3px #000!important;white-space:normal!important;}
#start-menu #sm-apps{display:none!important;}
#start-menu #btn-settings-quick{display:none!important;}
#start-menu .sm-footer{display:flex!important;gap:8px!important;padding:12px!important;}
#start-menu .sm-footer button{flex:1!important;min-height:38px!important;}
@media(max-width:700px){#desktop-icons.staging-admin-list{width:150px!important;}#desktop-icons.staging-admin-list .staging-desktop-app{width:140px!important;}#desktop-icons.staging-admin-list .staging-desktop-app .ico,#desktop-icons.staging-admin-list .staging-desktop-app .icon-img{width:38px!important;height:38px!important;min-width:38px!important;font-size:23px!important;}}
`;document.head.appendChild(style);}
function ensureRestart(){const footer=document.querySelector('#start-menu .sm-footer');if(!footer)return;const settings=document.getElementById('btn-settings-quick');if(settings)settings.style.display='none';let restart=document.getElementById('btn-restart');if(!restart){restart=document.createElement('button');restart.id='btn-restart';restart.textContent='🔄 รีสตาร์ท';restart.title='รีสตาร์ท Panthorium';restart.onclick=()=>{closeMenu();location.reload();};footer.insertBefore(restart,footer.firstChild);}const logout=document.getElementById('btn-logout');if(logout)logout.style.display='';}
function keyFor(node,index){return node.id||node.dataset?.desktopKey||('menu-'+index+'-'+(node.textContent||'app').trim().replace(/\s+/g,'-').toLowerCase());}
function buildDesktop(){const source=document.getElementById('sm-apps');const desktop=document.getElementById('desktop-icons');if(!source||!desktop)return 0;ensureStyle();desktop.classList.add('staging-admin-list');const children=[...source.children].filter(node=>node instanceof HTMLElement);let created=0;children.forEach((sourceNode,index)=>{const key=keyFor(sourceNode,index);let clone=desktop.querySelector(`[data-staging-source="${CSS.escape(key)}"]`);if(!clone){clone=sourceNode.cloneNode(true);clone.removeAttribute('id');clone.dataset.stagingSource=key;clone.classList.add('staging-desktop-app');clone.style.display='flex';clone.style.opacity='1';clone.style.visibility='visible';clone.style.background='transparent';clone.style.border='0';clone.style.boxShadow='none';clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));clone.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();try{sourceNode.click();}finally{closeMenu();}});desktop.appendChild(clone);created++;}}
);return children.length+created;}
function sync(){if(!isTarget())return;ensureStyle();ensureRestart();const count=buildDesktop();attempts++;if(count===0&&attempts<MAX_ATTEMPTS){clearTimeout(syncTimer);syncTimer=setTimeout(sync,250);}const source=document.getElementById('sm-apps');if(source&&!observer){observer=new MutationObserver(()=>{buildDesktop();ensureRestart();});observer.observe(source,{childList:true});}}
window.addEventListener('panthorium:auth-changed',()=>setTimeout(sync,0));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(sync,0),{once:true});else setTimeout(sync,0);
setTimeout(sync,300);setTimeout(sync,900);setTimeout(sync,1800);setTimeout(sync,3500);
window.PanthoriumStagingAdminDesktop={sync};
})();
