const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mainRequire = require('node:module').createRequire(require('node:path').join(__dirname, '../electron/main.cjs'));
const { JSDOM } = require('jsdom');
const catalog = require('../voice-window-catalog');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { AgentFunctionCallingService } = require('../services/agentFunctionCallingService');
const read = name => fs.readFileSync(name,'utf8');
(async () => {
  const cases = {'ย่อโน้ต':'minimize_notes','minimise notes':'minimize_notes','hide calculator':'minimize_calculator','ขยายหน้าต่างบันทึก':'maximize_notes','enlarge notes':'maximize_notes','เต็มหน้าจอ notes':'fullscreen_notes','go full screen notes':'fullscreen_notes','คืนขนาดบันทึก':'restore_notes','exit fullscreen notes':'restore_notes','ย่อ Panthorium Browser':'minimize_desktop_browser','maximize this window':'maximize_active_window','ย่อ':'minimize_active_window'};
  for (const [text,action] of Object.entries(cases)) assert.equal(catalog.parse(text)?.action,action,text);
  for (const text of ['อย่าปิดโน้ต',"don't minimize notes",'do not close Panthorium Browser']) assert.equal(catalog.parse(text)?.error,'voice_command_negated',text);
  assert.equal(catalog.parse('เปิดโน้ต แล้วปิดโน้ต')?.error,'ambiguous_voice_command');
  const user={id:'u1',sub:'u1',roles:[],permissions:['chat']};
  const agent=new AgentService({tools:new ToolRegistry()});
  const functions=new AgentFunctionCallingService({agentService:agent});
  for (const operation of ['minimize','maximize','fullscreen','restore']) {
    assert(functions.declarationsFor(user,{surface:'gemini-live'}).some(tool=>tool.name===`panthorium_window_${operation}`));
    const result=await functions.execute({user,source:'gemini-live',call:{id:operation,name:`panthorium_window_${operation}`,args:{appId:'notes'}},requireCallId:true});
    assert.equal(result.output.uiAction,`${operation}_notes`);
  }
  assert.equal((await agent.execute({user,toolId:'window.maximize',args:{appId:'settings'}})).ok,false);
  const dom=new JSDOM('<body><div id="windows"></div></body>',{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;const state=w.OS={windows:new w.Map(),zCounter:10030,state:{user}};
  w.eval(read('panthorium-window-base.js'));const api=w.PanthoriumWindow;
  const manager=w.PanthoriumWindowManager={
    registerExternalWindow(id,title,el,options){const r={id,title,el,displayMode:'flex',external:true,fullscreen:options.fullscreenOnOpen};state.windows.set(id,r);return r;},
    findByAppId(id){const r=state.windows.get(id);return r?{id,...r}:null;},
    restore:id=>api.focus(id),minimize:id=>api.minimize(id),close:id=>api.close(id)
  };
  api.connectShell(state,manager);w.focusWindow=id=>api.focus(id);w.closeWindow=id=>api.close(id);
  w.eval(read('voice-window-catalog.js'));w.eval(read('voice-command-client.js'));
  const notes=api.create({id:'notes',title:'Notes',content:'<input value="draft">',fullscreenOnOpen:false});
  for (const [operation,cls] of [['maximize','pw-maximized-workspace'],['fullscreen','maximized'],['restore',null]]) {
    assert((await w.PanthoriumVoiceCommands.windowAction(`${operation}_notes`)).ok);
    if(cls)assert(notes.classList.contains(cls));else assert(!notes.classList.contains('maximized')&&!notes.classList.contains('pw-maximized-workspace'));
    assert.equal(notes.querySelector('input').value,'draft');
  }
  assert((await w.PanthoriumVoiceCommands.windowAction('minimize_notes')).ok);
  assert.equal(notes.style.display,'none');
  assert((await w.PanthoriumVoiceCommands.windowAction('restore_notes')).ok);assert.equal(notes.style.display,'flex');
  assert((await w.PanthoriumVoiceCommands.windowAction('maximize_active_window')).ok);
  assert(notes.classList.contains('pw-maximized-workspace'));
  const native=[];w.panthoriumDesktop={isElectron:true,controlWindow:async action=>{native.push(action);return {ok:true};}};
  for(const operation of ['open','minimize','maximize','fullscreen','restore','close']) assert((await w.PanthoriumVoiceCommands.windowAction(`${operation}_desktop_browser`)).ok);
  assert.deepEqual(native,['open','minimize','maximize','fullscreen','restore','close']);
  await w.PanthoriumVoiceCommands.windowAction('minimize_notes');
  assert((await w.PanthoriumVoiceCommands.windowAction('close_notes')).ok);assert(!notes.isConnected);
  w.close();
  // Execute the actual main-process IPC with a native-window fixture.
  const handlers=new Map(),timers=[];let min=false,max=false,full=false,closed=false;
  const win={isDestroyed:()=>false,isMinimized:()=>min,isMaximized:()=>max,isFullScreen:()=>full,setFullScreen:value=>{full=value;},unmaximize:()=>{max=false;},minimize:()=>{min=true;},restore:()=>{min=false;},maximize:()=>{max=true;},show(){},focus(){},close(){closed=true;}};
  const electron={app:{getPath:()=>'/tmp',setPath(){},whenReady:()=>({then(){}}),on(){}},BrowserWindow:{fromWebContents:()=>win},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}};
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='../package.json'?{}:mainRequire(name),process:{env:{}},URL,Buffer,console,setTimeout:(fn)=>{timers.push(fn);},setInterval(){}});
  vm.runInContext(read('electron/main.cjs'),context);vm.runInContext('installVoiceBridge()',context);
  const control=handlers.get('panthorium:window-control');const event={sender:{},senderFrame:{url:'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app/'}};
  for(const action of ['minimize','restore','maximize','fullscreen','restore','open']) assert((await control(event,action)).ok,action);
  assert.equal((await control({...event,senderFrame:{url:'https://evil.test/'}},'close')).error,'untrusted_origin');
  assert.equal((await control(event,'delete')).error,'invalid_window_action');
  assert((await control(event,'close')).closing);assert(!closed);timers.at(-1)();assert(closed);
  console.log('PASS bilingual window modes: aliases, RBAC, native IPC, workspace/fullscreen/restore, drafts and minimized close');
})().catch(error=>{console.error(error);process.exitCode=1;});
