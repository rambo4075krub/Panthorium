'use strict';
const path=require('path');
const https=require('https');
const {app,BrowserWindow,session,ipcMain}=require('electron');
const metadata=require('../package.json');
const EDITION=metadata.panthoriumEdition==='admin'?'admin':'user';
const PRODUCT_NAME='Panthorium Browser '+(EDITION==='admin'?'Admin':'User');
const START_URL=process.env.PANTHORIUM_URL||('https://panthorium-backend-staging-124818950958.asia-southeast1.run.app'+(EDITION==='admin'?'/admin':'/'));
app.setPath('userData',path.join(app.getPath('appData'),'Panthorium-Browser-'+EDITION));
const API_ORIGIN=new URL(START_URL).origin;
const HOSTS=new Set(['www.youtube.com','www.facebook.com','line.me','www.tiktok.com','www.instagram.com','x.com']);
function allowed(value){try{const u=new URL(value);return u.protocol==='https:'&&HOSTS.has(u.hostname);}catch(_){return false;}}
function trustedOrigin(value){
  try {
    const u=new URL(value);
    return u.protocol==='https:' && u.origin===new URL(START_URL).origin;
  } catch(_) {
    return false;
  }
}
function postTranscription(payload){
  return new Promise((resolve,reject)=>{
    const body=Buffer.from(JSON.stringify(payload));
    const url=new URL('/api/speech/transcribe',API_ORIGIN);
    const request=https.request(url,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Content-Length':String(body.length),
        Authorization:'Bearer '+payload.token
      }
    },response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){request.destroy(new Error('response_too_large'));return;}chunks.push(chunk);});
      response.on('end',()=>{
        try{resolve({status:response.statusCode||500,data:JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')});}
        catch(_){resolve({status:response.statusCode||500,data:{ok:false,error:'invalid_server_response'}});}
      });
    });
    request.setTimeout(35000,()=>request.destroy(new Error('transcription_timeout')));
    request.on('error',reject);
    request.end(body);
  });
}
function installVoiceBridge(){
  ipcMain.handle('panthorium:transcribe',async(event,input={})=>{
    if(!trustedOrigin(event.senderFrame?.url||event.sender.getURL())) return {status:403,data:{ok:false,error:'untrusted_origin'}};
    const token=typeof input.token==='string'?input.token:'';
    const audio=typeof input.audio==='string'?input.audio:'';
    const language=typeof input.language==='string'?input.language:'th-TH';
    if(!token||token.length>8192||audio.length>700000||!/^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(audio)) return {status:400,data:{ok:false,error:'invalid_audio'}};
    try{return await postTranscription({audio,language,token});}
    catch(error){return {status:502,data:{ok:false,error:error.message==='transcription_timeout'?'transcription_timeout':'electron_upload_failed'}};}
  });
}
function create(){const win=new BrowserWindow({width:1440,height:900,minWidth:960,minHeight:640,backgroundColor:'#050811',title:PRODUCT_NAME,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:true,spellcheck:false}});win.loadURL(START_URL);return win;}
app.whenReady().then(()=>{
  installVoiceBridge();
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
