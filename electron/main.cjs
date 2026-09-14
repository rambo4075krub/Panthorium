'use strict';
const path=require('path');
const {app,BrowserWindow,session}=require('electron');
const START_URL=process.env.PANTHORIUM_URL||'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app/admin';
const HOSTS=new Set(['www.youtube.com','www.facebook.com','line.me','www.tiktok.com','www.instagram.com','x.com']);
function allowed(value){try{const u=new URL(value);return u.protocol==='https:'&&HOSTS.has(u.hostname);}catch(_){return false;}}
function trustedOrigin(value){
  try {
    const u=new URL(value);
    return u.protocol==='https:' && (u.hostname.endsWith('.run.app') || HOSTS.has(u.hostname));
  } catch(_) {
    return value==='null';
  }
}
function create(){const win=new BrowserWindow({width:1440,height:900,minWidth:960,minHeight:640,backgroundColor:'#050811',title:'Panthorium OS',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:true,spellcheck:false}});win.loadURL(START_URL);return win;}
app.whenReady().then(()=>{
  session.defaultSession.setPermissionCheckHandler((_wc,permission,origin)=>{
    return trustedOrigin(origin) && (permission==='media'||permission==='notifications');
  });
  session.defaultSession.setPermissionRequestHandler((wc,permission,callback)=>{
    callback(trustedOrigin(wc.getURL()) && (permission==='media'||permission==='notifications'));
  });
  create();
  app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)create();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
