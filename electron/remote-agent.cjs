'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const {RemoteAgentCore}=require('./remote-agent-core.cjs');
const {SCOPES}=require('./remote-protocol.cjs');
const LABELS={'files.read':'อ่านไฟล์ในโฟลเดอร์ที่เลือก','files.write':'สร้างและแก้ไขไฟล์ในโฟลเดอร์ที่เลือก','files.delete':'ลบไฟล์ในโฟลเดอร์ที่เลือก','chat.sync':'เก็บและเรียกดูประวัติแชทส่วนตัว','browser.open':'เปิดเว็บไซต์','process.run':'รันคำสั่งและโปรแกรมด้วยสิทธิ์บัญชี Windows/macOS/Linux นี้','desktop.control':'ดูหน้าจอ คลิก และพิมพ์ในแอปที่เปิดอยู่'};

function powershell(script,signal) {
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let result='',error='';const timer=setTimeout(()=>child.kill(),15000);
    const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',b=>{if(result.length<100000)result+=b.toString();});child.stderr.on('data',b=>{if(error.length<2000)error+=b.toString();});
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);code===0?resolve(result.trim()):reject(Error(error?'desktop_action_failed':'desktop_session_unavailable'));});
  });
}
const INPUT_DESKTOP=`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class PTDesktop{[DllImport("user32.dll")]public static extern IntPtr OpenInputDesktop(uint f,bool i,uint a);[DllImport("user32.dll")]public static extern bool SwitchDesktop(IntPtr d);[DllImport("user32.dll")]public static extern bool CloseDesktop(IntPtr d);[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);}';$ptDesk=[PTDesktop]::OpenInputDesktop(0,$false,256);if($ptDesk -eq [IntPtr]::Zero){exit 3};$ptUnlocked=[PTDesktop]::SwitchDesktop($ptDesk);[void][PTDesktop]::CloseDesktop($ptDesk);if(-not $ptUnlocked){exit 3};`;

function createNativeRemoteAgent({electron,security,origin,background}) {
  const {app,ipcMain,dialog,safeStorage,shell,desktopCapturer,screen,clipboard}=electron;
  let state=null,core=null,status={enabled:false,online:false},quitting=false;
  const accounts=new Map(),stateFile=path.join(app.getPath('userData'),'remote-agent.enc');
  function protectedStorage(){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('secure_device_storage_unavailable');}
  async function save(){protectedStorage();await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});const temp=stateFile+'.tmp';await fs.writeFile(temp,safeStorage.encryptString(JSON.stringify(state)),{mode:0o600});await fs.rename(temp,stateFile);}
  async function request(route,body,{token,credential=state}={}) {
    const response=await electron.net.fetch(new URL('/api/remote'+route,origin).href,{method:'POST',headers:{'Content-Type':'application/json',
      ...(token?{Authorization:'Bearer '+token}:credential?{Authorization:'Device '+credential.deviceId+':'+credential.secret}:{})},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(20000),credentials:'omit',redirect:'error'});
    const data=await response.json();if(!response.ok||!data.ok)throw Object.assign(Error(data.error||'remote_connection_failed'),{status:response.status});return data;
  }
  async function desktop(op,args,signal) {
    if(process.platform!=='win32')throw Error('desktop_platform_unavailable');
    await powershell(INPUT_DESKTOP,signal);
    if(op==='desktop.screenshot') {
      const display=screen.getPrimaryDisplay();const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1280,height:720}});
      const source=sources.find(s=>s.display_id===String(display.id))||sources[0];if(!source)throw Error('desktop_capture_unavailable');
      let bytes=source.thumbnail.toJPEG(45);if(bytes.length>120000)bytes=source.thumbnail.resize({width:960}).toJPEG(30);
      return {image:{mimeType:'image/jpeg',data:bytes.toString('base64')},imageSize:source.thumbnail.getSize(),displayBounds:display.bounds};
    }
    if(op==='desktop.click') {await powershell(INPUT_DESKTOP+`[void][PTDesktop]::SetCursorPos(${args.x},${args.y});[PTDesktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[PTDesktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero);`,signal);return {clicked:true,x:args.x,y:args.y};}
    const keys={ENTER:'{ENTER}',TAB:'{TAB}',ESC:'{ESC}',BACKSPACE:'{BACKSPACE}',DELETE:'{DELETE}',UP:'{UP}',DOWN:'{DOWN}',LEFT:'{LEFT}',RIGHT:'{RIGHT}','CTRL+A':'^a','CTRL+C':'^c','CTRL+V':'^v','CTRL+S':'^s','ALT+TAB':'%{TAB}'};
    if(op==='desktop.type') {
      const old=clipboard.readText();clipboard.writeText(args.text);
      try{await powershell(INPUT_DESKTOP+`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('^v');Start-Sleep -Milliseconds 250;`,signal);}
      finally{if(clipboard.readText()===args.text)clipboard.writeText(old);}
      return {typed:true,characters:args.text.length};
    }
    if(op==='desktop.key'&&keys[args.key]){await powershell(INPUT_DESKTOP+`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${keys[args.key]}');`,signal);return {pressed:args.key};}
    throw Error('desktop_operation_unavailable');
  }
  async function autoStart(enabled) {
    if(['win32','darwin'].includes(process.platform))app.setLoginItemSettings({openAtLogin:enabled,path:app.getPath('exe'),args:['--remote-background']});
    else if(process.platform==='linux') {
      const folder=path.join(app.getPath('home'),'.config','autostart'),file=path.join(folder,'panthorium-remote.desktop');
      if(enabled){const executable=process.env.APPIMAGE||app.getPath('exe');if(/[\r\n]/.test(executable))throw Error('invalid_executable_path');await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,'[Desktop Entry]\nType=Application\nName=Panthorium Remote Agent\nExec="'+executable.replace(/(["\\$`])/g,'\\$1')+'" --remote-background\nX-GNOME-Autostart-enabled=true\n',{mode:0o600});}
      else await fs.rm(file,{force:true});
    }
  }
  async function start() {
    core?.stop();if(!state?.enabled)return;
    core=new RemoteAgentCore({root:state.root,userId:state.userId,scopes:state.scopes,request:(url,body)=>request(url,body),desktop:process.platform==='win32'?desktop:null,openUrl:url=>shell.openExternal(url)});
    core.onStatus=value=>{status={...status,...value,enabled:state?.enabled===true};};
    background(true);status={enabled:true,online:false};await core.start();
  }
  const trusted=event=>{if(!security.isTrustedShellEvent(event))throw Error('untrusted_origin');const account=accounts.get(event.sender.id);if(!account||account.startsWith('guest:'))throw Error('remote_account_required');return account;};
  const handle=(name,fn)=>ipcMain.handle(name,async(event,input)=>{try{return {ok:true,...await fn(event,input)};}catch(e){return {ok:false,error:e.message};}});
  handle('panthorium:remote-status',event=>{const account=trusted(event);return state&&state.userId===account?{...status,deviceId:state.deviceId,workspace:state.root,scopes:state.scopes,autoScopes:state.autoScopes}:{enabled:false,pairedElsewhere:!!state};});
  handle('panthorium:remote-connect',async(event,input={})=>{
    const account=trusted(event);protectedStorage();
    if(state)throw Error('device_already_paired');
    if(typeof input.token!=='string'||input.token.length>8192||typeof input.name!=='string'||input.name.length>80)throw Error('invalid_device_setup');
    const scopes=Array.isArray(input.scopes)?[...new Set(input.scopes)]:['files.read','files.write','chat.sync'];
    if(scopes.some(s=>!SCOPES.includes(s)||s==='desktop.control'&&process.platform!=='win32'))throw Error('invalid_device_permissions');
    const autoScopes=Array.isArray(input.autoScopes)?input.autoScopes:[];
    if(autoScopes.some(s=>!scopes.includes(s)))throw Error('invalid_device_permissions');
    const confirm=await dialog.showMessageBox({type:'question',title:'เชื่อมเครื่องนี้กับ Panthorium',message:'อนุญาตให้บัญชีนี้สั่งงานเครื่องจากระยะไกล',
      detail:scopes.map(s=>'• '+LABELS[s]+(autoScopes.includes(s)?' — ทำได้อัตโนมัติ':' — ยืนยันแต่ละงาน')).join('\n')+'\n\nตัวรับงานจะเริ่มเมื่อเข้าสู่ระบบคอมพิวเตอร์ และทำงานต่อเมื่อปิดหน้าต่าง Panthorium คุณหยุดหรือยกเลิกการเชื่อมต่อได้เสมอ',buttons:['ยกเลิก','อนุญาตและเลือกพื้นที่'],defaultId:0,cancelId:0});
    if(confirm.response!==1)return {cancelled:true};
    const folder=await dialog.showOpenDialog({title:'เลือกโฟลเดอร์สำหรับพื้นที่งานของคุณ',defaultPath:app.getPath('documents'),properties:['openDirectory','createDirectory']});
    if(folder.canceled||!folder.filePaths[0])return {cancelled:true};
    const pairing=await request('/pairing/start',{name:input.name,platform:process.platform,scopes,autoScopes},{credential:null});
    await request('/pairing/confirm',{code:pairing.code},{token:input.token,credential:null});
    const paired=await request('/pairing/status',{pairingId:pairing.pairingId,deviceSecret:pairing.deviceSecret},{credential:null});
    if(paired.userId!==account)throw Error('device_account_mismatch');
    state={enabled:true,deviceId:paired.deviceId,userId:paired.userId,secret:pairing.deviceSecret,scopes,autoScopes,
      root:path.join(folder.filePaths[0],'PanthoriumWorkspace',createHash('sha256').update(paired.userId).digest('hex').slice(0,20)),origin};
    await save();await autoStart(true);await start();return {deviceId:state.deviceId,workspace:state.root,enabled:true};
  });
  handle('panthorium:remote-pause',async(event,input)=>{const account=trusted(event);if(!state||state.userId!==account)throw Error('device_account_mismatch');
    state.enabled=input?.paused!==true;await save();await autoStart(state.enabled);if(state.enabled)await start();else{core?.stop();background(false);status={enabled:false,online:false};}return {enabled:state.enabled};});
  handle('panthorium:remote-disconnect',async event=>{const account=trusted(event);if(!state||state.userId!==account)throw Error('device_account_mismatch');
    // Revoke server credentials before erasing the only local copy.
    try{await request('/agent/disconnect',{});}catch(e){if(e.status!==401&&e.status!==403)throw e;}core?.stop();await autoStart(false);await fs.rm(stateFile,{force:true});state=null;background(false);status={enabled:false,online:false};return status;});
  app.on('before-quit',()=>{quitting=true;core?.stop();});
  return {
    setAccount(wc,account){accounts.set(wc.id,account);},
    enabled:()=>state?.enabled===true,
    async restore(){try{protectedStorage();state=JSON.parse(safeStorage.decryptString(await fs.readFile(stateFile)));if(state.origin!==origin)throw Error('device_origin_changed');await start();}catch(e){if(e.code!=='ENOENT'){if(state)state.enabled=false;background(false);status={enabled:false,error:e.message};}}},
    close(){if(!quitting)core?.stop();}
  };
}
module.exports={createNativeRemoteAgent};
