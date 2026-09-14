'use strict';
const path=require('path');
const {app,BrowserWindow,session}=require('electron');
const START_URL=process.env.PANTHORIUM_URL||'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app/admin';
const HOSTS=new Set(['www.youtube.com','www.facebook.com','line.me','www.tiktok.com','www.instagram.com','x.com']);
function allowed(value){try{const u=new URL(value);return u.protocol==='https:'&&HOSTS.has(u.hostname);}catch(_){return false;}}
function create(){const win=new BrowserWindow({width:1440,height:900,minWidth:960,minHeight:640,backgroundColor:'#050811',title:'Panthorium OS',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:true,spellcheck:false}});win.loadURL(START_URL);return win;}
app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((wc,p,cb)=>{const u=wc.getURL();cb((u.startsWith('https://panthorium-backend-')||[...HOSTS].some(h=>u.includes(h)))&&(p==='media'||p==='notifications'));});create();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)create();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
