'use strict';
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const {spawn}=require('child_process');
const {app,BrowserWindow,session,ipcMain,net,dialog}=require('electron');
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
    const request=net.request({method:'POST',url:new URL('/api/speech/transcribe',API_ORIGIN).href,session:session.defaultSession});
    request.setHeader('Content-Type','application/json');
    request.setHeader('Content-Length',String(body.length));
    request.setHeader('Authorization','Bearer '+payload.token);
    const timer=setTimeout(()=>request.abort(),35000);
    request.on('response',response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){request.abort();reject(new Error('response_too_large'));return;}chunks.push(chunk);});
      response.on('end',()=>{clearTimeout(timer);try{resolve({status:response.statusCode||500,data:JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')});}catch(_){resolve({status:response.statusCode||500,data:{ok:false,error:'invalid_server_response'}});}});
    });
    request.on('error',error=>{clearTimeout(timer);reject(error);});
    request.write(body);
    request.end();
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
    catch(error){return {status:502,data:{ok:false,error:error.message==='transcription_timeout'?'transcription_timeout':('electron_upload_failed:'+String(error.code||error.message||'network').slice(0,80))}};}
  });
}
function newerVersion(current,next){
  const parts=value=>String(value).match(/\d+/g)?.slice(0,3).map(Number)||[0,0,0];
  const a=parts(current),b=parts(next);
  for(let i=0;i<3;i+=1){if((b[i]||0)!==(a[i]||0))return (b[i]||0)>(a[i]||0);}
  return false;
}
async function checkForUpdates(){
  if(!app.isPackaged||process.platform!=='win32')return;
  const manifestUrl='https://github.com/rambo4075krub/Panthorium/releases/download/staging/Panthorium-Browser-'+EDITION+'-update.json';
  try{
    const response=await net.fetch(manifestUrl,{cache:'no-store'});
    if(!response.ok)throw new Error('manifest_http_'+response.status);
    const manifest=await response.json();
    const asset=manifest?.assets?.windows;
    if(manifest.edition!==EDITION||!newerVersion(app.getVersion(),manifest.version)||!asset)return;
    const url=new URL(asset.url);
    if(url.origin!=='https://github.com'||!url.pathname.startsWith('/rambo4075krub/Panthorium/releases/download/staging/'))throw new Error('untrusted_update_url');
    const binaryResponse=await net.fetch(url.href,{cache:'no-store'});
    if(!binaryResponse.ok)throw new Error('update_http_'+binaryResponse.status);
    const expected=Number(binaryResponse.headers.get('content-length')||0);
    if(expected&&expected>200*1024*1024)throw new Error('update_too_large');
    const binary=Buffer.from(await binaryResponse.arrayBuffer());
    if(!binary.length||binary.length>200*1024*1024)throw new Error('update_too_large');
    const digest=crypto.createHash('sha256').update(binary).digest('hex');
    if(digest!==asset.sha256)throw new Error('update_checksum_failed');
    const target=path.join(app.getPath('userData'),'updates',path.basename(asset.name));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,binary,{mode:0o700});
    const choice=await dialog.showMessageBox({type:'info',title:PRODUCT_NAME,message:'มี Panthorium Browser รุ่นใหม่พร้อมติดตั้ง',detail:'ดาวน์โหลดเรียบร้อยแล้ว ต้องการเริ่มโปรแกรมใหม่เพื่ออัปเดตหรือไม่',buttons:['เริ่มใหม่และอัปเดต','ภายหลัง'],defaultId:0,cancelId:1});
    if(choice.response===0){spawn(target,['/S'],{detached:true,stdio:'ignore'}).unref();app.quit();}
  }catch(error){console.warn('[Panthorium Update]',error.message);}
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
  setTimeout(checkForUpdates,15000);
  setInterval(checkForUpdates,6*60*60*1000).unref();
  app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)create();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
