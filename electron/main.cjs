'use strict';
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const {spawn}=require('child_process');
const {app,BrowserWindow,session,ipcMain,net,dialog}=require('electron');
const metadata=require('../package.json');
const {createBrowserSecurity}=require('./browser-security.cjs');
const {verifyManifest}=require('./update-signature.cjs');
const {fetchBounded}=require('./update-download.cjs');
const updateTrust=require('./update-trust.json');
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
const browserSecurity=createBrowserSecurity({app,session,trustedOrigin,edition:EDITION});
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
  ipcMain.handle('panthorium:browser-account',(event,accountId)=>{
    if(!browserSecurity.isTrustedShellEvent(event))return {ok:false,error:'untrusted_origin'};
    return browserSecurity.setAccount(event.sender,accountId);
  });
  ipcMain.handle('panthorium:window-control', async (event, action) => {
    if (!trustedOrigin(event.senderFrame?.url || event.sender.getURL())) return {ok:false,error:'untrusted_origin'};
    if (!['open','close','minimize','maximize','fullscreen','restore'].includes(action)) return {ok:false,error:'invalid_window_action'};
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return {ok:false,error:'desktop_window_unavailable'};
    if (action === 'close') { setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 500); return {ok:true,action,closing:true}; }
    if (['minimize','maximize','restore'].includes(action) && win.isFullScreen()) {
      win.setFullScreen(false);
      for(let attempt=0; win.isFullScreen() && attempt<30; attempt++) await new Promise(resolve=>setTimeout(resolve,100));
    }
    if (action === 'open') { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    if (action === 'restore') { win.unmaximize(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') { win.setFullScreen(false); if (win.isMinimized()) win.restore(); win.maximize(); }
    if (action === 'fullscreen') { if (win.isMinimized()) win.restore(); win.setFullScreen(true); }
    const matches = () => action === 'minimize' ? win.isMinimized() : action === 'maximize' ? win.isMaximized() && !win.isFullScreen() : action === 'fullscreen' ? win.isFullScreen() : action === 'open' ? !win.isMinimized() : !win.isMinimized() && !win.isMaximized() && !win.isFullScreen();
    for (let attempt=0; !matches() && attempt<30; attempt++) await new Promise(resolve => setTimeout(resolve,100));
    return {ok:matches(),action,error:matches()?null:'desktop_window_transition_failed'};
  });
  ipcMain.handle('panthorium:transcribe',async(event,input={})=>{
    if(!trustedOrigin(event.senderFrame?.url||event.sender.getURL())) return {status:403,data:{ok:false,error:'untrusted_origin'}};
    const token=typeof input.token==='string'?input.token:'';
    const audio=typeof input.audio==='string'?input.audio:'';
    const language=typeof input.language==='string'?input.language:'th-TH';
    if(!token||token.length>8192||audio.length>700000||!/^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(audio)) return {status:400,data:{ok:false,error:'invalid_audio'}};
    try{return await postTranscription({audio,language,token});}
    catch(error){return {status:502,data:{ok:false,error:error.message==='transcription_timeout'?'transcription_timeout':('electron_upload_failed:'+String(error.code||error.message||'network').slice(0,80))}};}
  });
  ipcMain.handle('panthorium:app-info',event=> trustedOrigin(event.senderFrame?.url||event.sender.getURL()) ? ({
    version:app.getVersion(),
    edition:EDITION,
    platform:process.platform,
    packaged:app.isPackaged,
    productName:PRODUCT_NAME
  }) : ({ok:false,error:'untrusted_origin'}));
  ipcMain.handle('panthorium:update-status',async event=>{
    if(!trustedOrigin(event.senderFrame?.url||event.sender.getURL())) return {ok:false,error:'untrusted_origin'};
    return checkForUpdates({checkOnly:true});
  });
  ipcMain.handle('panthorium:check-updates',async event=>{
    if(!trustedOrigin(event.senderFrame?.url||event.sender.getURL())) return {ok:false,error:'untrusted_origin'};
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
let updateInstallBusy=false;
async function checkForUpdates(options={}){
  if(options.checkOnly)return performUpdateCheck(options);
  if(updateInstallBusy)return {ok:false,error:'update_in_progress'};
  updateInstallBusy=true;
  try{return await performUpdateCheck(options);}finally{updateInstallBusy=false;}
}
async function performUpdateCheck(options={}){
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
    const manifestBytes=await fetchBounded(net.fetch.bind(net),manifestUrl,{maxBytes:64*1024,timeoutMs:20000,prefix:'manifest'});
    const manifest=JSON.parse(manifestBytes.toString('utf8'));
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('invalid_manifest');
    const signature=verifyManifest(manifest,updateTrust);
    // A status check can report an unsigned version, but must never execute it.
    if(!signature.ok&&!options.checkOnly)throw new Error(signature.error);
    if(manifest.edition!==EDITION)throw new Error('edition_mismatch');
    const current=app.getVersion();
    const remote=String(manifest.version||'');
    if(!remote)throw new Error('manifest_missing_version');
    if(!newerVersion(current,remote)){
      if(manual&&!options.checkOnly){
        await dialog.showMessageBox({type:'info',title:PRODUCT_NAME,message:'คุณใช้รุ่นล่าสุดแล้ว',detail:'Panthorium Browser อัปเดตล่าสุดแล้ว'});
      }
      return {ok:true,upToDate:true,available:false,current,remote};
    }
    const asset=manifest?.assets?.[platform];
    if(!asset||!asset.url||!asset.sha256||!asset.name)throw new Error('manifest_missing_'+platform);
    if(!trustedUpdateUrl(asset.url))throw new Error('untrusted_update_url');
    // Rendering the Start Menu must never download an installer or open a dialog.
    if(options.checkOnly)return {ok:true,upToDate:false,available:true,current,remote,platform,installable:signature.ok,verificationError:signature.ok?null:signature.error};
    const expected=asset.size;
    if(!Number.isSafeInteger(expected)||expected<=0||expected>250*1024*1024)throw new Error('update_size_invalid');
    const binary=await fetchBounded(net.fetch.bind(net),asset.url,{maxBytes:expected,timeoutMs:300000,prefix:'update'});
    if(binary.length!==expected)throw new Error('update_size_mismatch');
    const digest=crypto.createHash('sha256').update(binary).digest('hex');
    if(digest!==asset.sha256)throw new Error('update_checksum_failed');
    const target=path.join(app.getPath('userData'),'updates',path.basename(asset.name));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,binary,{mode:0o700});
    const platformLabel=platform==='windows'?'Windows':platform==='macos'?'macOS':'Linux';
    const detail=[
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
    if(manual&&!options.checkOnly){
      await dialog.showMessageBox({
        type:'warning',
        title:PRODUCT_NAME,
        message:'ตรวจสอบอัปเดตไม่สำเร็จ',
        detail:String(error.message||error).startsWith('update_signature_') ? 'ยังไม่สามารถยืนยันผู้เผยแพร่อัปเดตได้ จึงหยุดการติดตั้งเพื่อความปลอดภัย กรุณารออัปเดตที่มีลายเซ็นถูกต้อง' : String(error.message||error)
      }).catch(()=>{});
    }
    return {ok:false,error:String(error.message||error)};
  }
}
function create(){const win=new BrowserWindow({width:1440,height:900,minWidth:960,minHeight:640,backgroundColor:'#050811',frame:false,title:PRODUCT_NAME,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:true,spellcheck:false,backgroundThrottling:false}});win.removeMenu();browserSecurity.registerShell(win.webContents);win.loadURL(START_URL);return win;}
app.whenReady().then(()=>{
  installVoiceBridge();
  browserSecurity.installSession(session.defaultSession);
  create();
  setTimeout(()=>checkForUpdates({manual:false}),15000);
  setInterval(()=>checkForUpdates({manual:false}),6*60*60*1000).unref();
  app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)create();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
