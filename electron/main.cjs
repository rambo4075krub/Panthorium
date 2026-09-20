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
  ipcMain.handle('panthorium:app-info',()=>({
    version:app.getVersion(),
    edition:EDITION,
    platform:process.platform,
    packaged:app.isPackaged,
    productName:PRODUCT_NAME
  }));
  ipcMain.handle('panthorium:check-updates',async()=>{
    try{return await checkForUpdates({manual:true});}
    catch(error){return {ok:false,error:String(error.message||error)};}
  });
}
/** Compare semver-like versions: returns true when next > current */
function newerVersion(current,next){
  const parts=value=>{
    const nums=String(value||'').match(/\d+/g);
    if(!nums||!nums.length)return [0,0,0];
    return nums.slice(0,4).map(n=>Number(n)||0);
  };
  const a=parts(current),b=parts(next);
  const len=Math.max(a.length,b.length);
  for(let i=0;i<len;i+=1){
    const left=a[i]||0,right=b[i]||0;
    if(right!==left)return right>left;
  }
  return false;
}
function platformKey(){
  if(process.platform==='win32')return 'windows';
  if(process.platform==='darwin')return 'macos';
  if(process.platform==='linux')return 'linux';
  return null;
}
function trustedUpdateUrl(url){
  try{
    const u=new URL(url);
    return u.origin==='https://github.com'&&u.pathname.startsWith('/rambo4075krub/Panthorium/releases/download/staging/');
  }catch(_){return false;}
}
function applyUpdateInstaller(target,platform){
  if(platform==='windows'){
    spawn(target,['/S'],{detached:true,stdio:'ignore'}).unref();
    app.quit();
    return true;
  }
  if(platform==='macos'){
    spawn('open',[target],{detached:true,stdio:'ignore'}).unref();
    return true;
  }
  if(platform==='linux'){
    try{fs.chmodSync(target,0o755);}catch(_){}
    spawn(target,[],{detached:true,stdio:'ignore'}).unref();
    app.quit();
    return true;
  }
  return false;
}
async function checkForUpdates(options={}){
  const manual=options.manual===true;
  if(!app.isPackaged){
    if(manual)return {ok:false,error:'dev_build_skips_update',current:app.getVersion()};
    return {ok:false,error:'dev_build_skips_update'};
  }
  const platform=platformKey();
  if(!platform){
    if(manual)return {ok:false,error:'unsupported_platform',platform:process.platform};
    return {ok:false,error:'unsupported_platform'};
  }
  const manifestUrl='https://github.com/rambo4075krub/Panthorium/releases/download/staging/Panthorium-Browser-'+EDITION+'-update.json';
  try{
    const response=await net.fetch(manifestUrl,{cache:'no-store'});
    if(!response.ok)throw new Error('manifest_http_'+response.status);
    const manifest=await response.json();
    if(manifest.edition!==EDITION)throw new Error('edition_mismatch');
    const current=app.getVersion();
    const remote=String(manifest.version||'');
    if(!remote)throw new Error('manifest_missing_version');
    if(!newerVersion(current,remote)){
      if(manual){
        await dialog.showMessageBox({type:'info',title:PRODUCT_NAME,message:'คุณใช้รุ่นล่าสุดแล้ว',detail:'เวอร์ชันปัจจุบัน '+current});
      }
      return {ok:true,upToDate:true,current,remote};
    }
    const asset=manifest?.assets?.[platform];
    if(!asset||!asset.url||!asset.sha256||!asset.name)throw new Error('manifest_missing_'+platform);
    if(!trustedUpdateUrl(asset.url))throw new Error('untrusted_update_url');
    const binaryResponse=await net.fetch(asset.url,{cache:'no-store'});
    if(!binaryResponse.ok)throw new Error('update_http_'+binaryResponse.status);
    const expected=Number(binaryResponse.headers.get('content-length')||asset.size||0);
    if(expected&&expected>250*1024*1024)throw new Error('update_too_large');
    const binary=Buffer.from(await binaryResponse.arrayBuffer());
    if(!binary.length||binary.length>250*1024*1024)throw new Error('update_too_large');
    if(expected&&Math.abs(binary.length-expected)>1024)throw new Error('update_size_mismatch');
    const digest=crypto.createHash('sha256').update(binary).digest('hex');
    if(digest!==asset.sha256)throw new Error('update_checksum_failed');
    const target=path.join(app.getPath('userData'),'updates',path.basename(asset.name));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,binary,{mode:0o700});
    const platformLabel=platform==='windows'?'Windows':platform==='macos'?'macOS':'Linux';
    const detail=[
      'เวอร์ชันปัจจุบัน: '+current,
      'เวอร์ชันใหม่: '+remote,
      'แพลตฟอร์ม: '+platformLabel,
      '',
      platform==='macos'
        ? 'จะเปิดตัวติดตั้ง (.dmg) ให้ลากแอปเข้า Applications แล้วเปิดใหม่'
        : 'ดาวน์โหลดและตรวจสอบ checksum เรียบร้อยแล้ว'
    ].join('\n');
    const choice=await dialog.showMessageBox({
      type:'info',
      title:PRODUCT_NAME,
      message:'มี Panthorium Browser รุ่นใหม่พร้อมติดตั้ง',
      detail,
      buttons:platform==='macos'?['เปิดตัวติดตั้ง','ภายหลัง']:['เริ่มใหม่และอัปเดต','ภายหลัง'],
      defaultId:0,
      cancelId:1
    });
    if(choice.response===0){
      applyUpdateInstaller(target,platform);
      return {ok:true,updated:true,current,remote,platform};
    }
    return {ok:true,deferred:true,current,remote,platform};
  }catch(error){
    console.warn('[Panthorium Update]',error.message);
    if(manual){
      await dialog.showMessageBox({
        type:'warning',
        title:PRODUCT_NAME,
        message:'ตรวจสอบอัปเดตไม่สำเร็จ',
        detail:String(error.message||error)
      }).catch(()=>{});
    }
    return {ok:false,error:String(error.message||error)};
  }
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
  setTimeout(()=>checkForUpdates({manual:false}),15000);
  setInterval(()=>checkForUpdates({manual:false}),6*60*60*1000).unref();
  app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)create();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
