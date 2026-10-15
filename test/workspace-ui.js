'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(name, 'utf8');
(async () => {
  const dom = new JSDOM('<body><button id="start-btn">Start</button><div id="windows"></div></body>', { runScripts:'outside-only', pretendToBeVisual:true, url:'https://panthorium.test/' });
  const w = dom.window;
  const state = w.OS = { windows:new w.Map(), zCounter:10030, state:{ user:{ sub:'member', roles:[], permissions:['chat'] } } };
  w.eval(read('panthorium-window-base.js')); w.eval(read('voice-window-catalog.js'));
  const api = w.PanthoriumWindow;
  const manager = w.PanthoriumWindowManager = {
    registerExternalWindow(id,title,el,options) { const rec={el,title,fullscreen:options.fullscreenOnOpen,displayMode:'flex'}; state.windows.set(id,rec); return rec; },
    findByAppId(id) { const rec=state.windows.get(id); return rec?{id,...rec}:null; }
  };
  api.connectShell(state,manager);
  w.eval(read('window-theme-ui.js')); w.eval(read('workspace-ui.js'));
  const ui = w.PanthoriumWorkspace;
  w.openNotes = () => api.create({id:'notes',title:'Notes',content:'<input value="unsaved draft">'});
  const notes = w.openNotes();
  assert.equal(notes.querySelectorAll('.pt-sidebar').length,1);
  assert(notes.querySelector('.pt-brand strong').textContent === 'Panthorium');
  assert.equal(notes.querySelector('.pt-brand-logo').getAttribute('src'), '/panthorium-logo.svg?v=original-orange-20261015', 'new windows use the approved logo');
  assert.equal(notes.querySelectorAll('.pt-brand > svg').length, 0, 'the placeholder cube is removed');
  assert(!notes.classList.contains('maximized'),'normal reference frame is the default');
  assert(Number.parseInt(notes.style.width) < w.innerWidth,'reference has desktop margins');
  assert.deepEqual(Array.from(notes.querySelectorAll('.win-btn')).map(b=>b.className),['win-btn min','win-btn max','win-btn close']);
  assert.equal(notes.querySelectorAll('.win-btn svg').length,3);
  ui.apply(notes); ui.scan(); assert.equal(notes.querySelectorAll('.pt-sidebar').length,1);
  // External windows keep identity, values and original app cleanup handlers.
  const root=w.document.createElement('section');root.id='phase5-agent-ui';
  root.innerHTML='<header><h2>Agent</h2><button id="agent-history">History</button><button id="agent-close">Close</button></header><textarea>draft</textarea>';
  const input=root.querySelector('textarea');let history=0,closed=0;
  root.querySelector('#agent-history').onclick=()=>history++;
  root.querySelector('#agent-close').onclick=()=>{closed++;api.close('sentinel-agent');};
  w.document.body.append(root); manager.registerExternalWindow('sentinel-agent','Sentinel Agent',root,{fullscreenOnOpen:false});
  assert.equal(root.querySelector('.pt-app-content textarea'),input);
  assert.equal(root.parentElement,notes.parentElement,'external and native apps share the desktop stacking context');
  assert.equal(root.getAttribute('role'),'dialog');
  await new Promise(resolve=>w.requestAnimationFrame(resolve));
  assert.equal(w.document.activeElement,root,'new external windows receive keyboard focus');
  root.querySelector('#agent-history').click(); assert.equal(history,1);
  assert(root.querySelector('#agent-close').hidden);
  assert.equal(root.querySelectorAll('.pt-sidebar').length,1);
  function key(code, options={}, target=w.document.body) {
    const e=new w.KeyboardEvent('keydown',{code,key:code,altKey:true,shiftKey:true,bubbles:true,cancelable:true,...options});target.dispatchEvent(e);return e;
  }
  api.focus('sentinel-agent'); key('Digit1'); assert.equal(root.dataset.ptSnap,'left');
  key('Digit2'); assert.equal(root.dataset.ptSnap,'right');
  key('KeyX'); assert(!root.classList.contains('pt-snapped')); assert.equal(input.value,'draft');
  key('KeyM'); assert(api.get('sentinel-agent').minimized);
  key('ArrowRight'); assert(!api.get('sentinel-agent').minimized);
  key('KeyW',{},input); assert(root.isConnected,'window commands do not discard typing');
  key('KeyW',{isComposing:true}); assert(root.isConnected,'IME does not trigger window actions');
  assert(!key('KeyW',{ctrlKey:true,altKey:false,shiftKey:false}).defaultPrevented,'browser close is untouched');
  key('KeyD'); assert.equal(notes.style.display,'none'); assert.equal(root.style.display,'none');
  key('KeyD'); assert.equal(root.style.display,'flex'); assert.equal(notes.querySelector('input').value,'unsaved draft');
  key('KeyW'); assert.equal(closed,1); assert(!root.isConnected);
  // Palette obeys RBAC even if a caller tries launching a restricted app directly.
  let settings=0;w.openSettings=()=>settings++;
  assert.equal(ui.launch('settings'),false); assert.equal(settings,0);
  key('KeyK',{key:'า'}); // physical code still works on Thai layout
  let search=w.document.querySelector('.pt-command-input'); assert(search);
  assert(!w.document.getElementById('pt-result-settings'));
  assert.equal(w.document.activeElement,search);
  search.value='Notes';search.dispatchEvent(new w.Event('input'));
  search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert(!w.document.querySelector('.pt-overlay')); assert.equal(api.get('notes').el,notes);
  assert.equal(w.document.activeElement,notes,'opening an existing app moves focus out of the previous window');
  ui.openHelp(); assert(w.document.querySelector('.pt-shortcut-list').textContent.includes('ครึ่งจอ'));
  key('Escape',{key:'Escape',altKey:false,shiftKey:false});assert(!w.document.querySelector('.pt-overlay'));
  state.state.user={sub:'admin',roles:['administrator'],permissions:['chat','settings']};
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert(notes.querySelector('.pt-sidebar').textContent.includes('ระบบอัตโนมัติ'));
  ui.openPalette(); assert(w.document.getElementById('pt-result-settings'));
  state.state.user={sub:'guest:1',roles:['guest'],permissions:['chat']};
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert(!w.document.querySelector('.pt-overlay')); assert(!notes.querySelector('.pt-sidebar').textContent.includes('ระบบอัตโนมัติ'));
  // Run the real chat opener and keyboard submission handler with a fake AI transport.
  w.$=id=>w.document.getElementById(id);w.createWindow=(id,title,content,opts)=>api.create({...opts,id,title,content,legacyContent:true});
  w.createAdaptiveVoiceDetector=()=>({});w.unlockVoiceAudio=()=>{};w.toast=()=>{};w.voiceResponseNeedsSpeech=()=>false;
  let requests=0;w.callAI=async()=>{requests++;return {ok:true,text:'reply'};};
  const shell=read('sentinel.html'); const start=shell.indexOf('    function openSentinel()');
  w.eval(shell.slice(start,shell.indexOf('    // ---------- App: Settings',start)));w.openSentinel();
  const chat=w.document.getElementById('chat-input'); assert.equal(chat.tagName,'TEXTAREA');
  assert.equal(w.document.querySelectorAll('.pt-action[data-pt-prompt]').length,3);
  assert(w.document.querySelector('.pt-hero h1').textContent.includes('ทุกความคิด'));
  assert.equal(w.document.querySelector('#chat-messages canvas'),null,'no orb in chat');
  w.document.querySelector('[data-pt-prompt]').click();assert(chat.value);
  chat.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));assert.equal(requests,0);
  chat.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));assert.equal(requests,0);
  chat.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(requests,1);assert(!w.document.getElementById('chat-send').disabled);
  assert(w.document.querySelector('#chat-messages').textContent.includes('reply'));
  // App search mirrors additional shell visibility rules, not just catalog permissions.
  const menu=w.document.createElement('div');menu.id='sm-apps';
  menu.innerHTML='<button class="sm-app" data-app-id="sentinel"><span>Sentinel AI</span></button><button class="sm-app" data-app-id="account-login"><span>เข้าสู่ระบบ</span></button>';
  w.document.body.append(menu);let login=0;menu.lastElementChild.onclick=()=>login++;
  ui.openPalette();assert(!w.document.getElementById('pt-result-notes'));
  assert(w.document.getElementById('pt-result-account-login'));ui.launch('account-login');assert.equal(login,1);
  assert.equal(ui.launch('notes'),false,'palette cannot expose an app the shell has removed');
  w.close();
  console.log('Workspace: shared structure, external cleanup, reference chat, IME, shortcuts, snap/restore, draft preservation and RBAC passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
