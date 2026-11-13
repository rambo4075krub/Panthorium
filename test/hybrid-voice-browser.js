'use strict';
const {chromium}=require('playwright'),express=require('express'),assert=require('node:assert/strict');
const localOnly=process.env.PANTHORIUM_TEST_LOCAL_ONLY==='1';
const app=express();app.use(express.json({limit:'2mb'}));let calls=[],transcript='สวัสดี',failSpeech=false;
const scripts=['voice-window-catalog.js','screen-voice-catalog.js','screen-voice-client.js','voice-command-client.js','speech-buffer.js','hybrid-voice-client.js','live-voice-client.js'];
const wav=Buffer.alloc(44+16000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
app.get('/',(req,res)=>res.send(`<body data-ai-mode="${localOnly?'local-only':'gemini-live-only'}" data-gemini-live-enabled="${!localOnly}"><button id="chat-mic"></button><button id="desktop-voice"></button><div id="chat-messages"></div><div id="toast"></div><script>
window.OS={state:{user:{id:'a',sub:'a',roles:['user'],permissions:['chat']}},config:{},windows:new Map()};
window.PanthoriumAuth={getAccessToken:()=> 'fixture',ensureSession:async()=>true};
window.authorizedFetch=(url,options)=>fetch(url,options);
window.PanthoriumCreativeVoiceCatalog={parse:text=>text==='แบ่งคลิป'?{action:'split'}:null};
window.PanthoriumCreativeStudio={command:async text=>{window.receivedCreativeVoice=text;return{ok:true,text:'แบ่งคลิปแล้ว'};}};
window.openNotes=()=>{if(document.querySelector('[data-id="notes"]'))return;const el=document.createElement('section');el.className='window';el.dataset.id='notes';el.style.zIndex='100';el.innerHTML='<p>งานที่กำลังทำอยู่</p><label for="title">ชื่อ</label><input id="title"><button id="save">บันทึก</button>';document.body.append(el);el.querySelector('button').onclick=()=>window.saved=(window.saved||0)+1;};
window.WebSocket=function(){throw Error('Paid socket must not open at zero credit');};
// Deterministic voiced/silent input through REAL MediaRecorder and AudioContext.
window.microphoneContext=new AudioContext();window.gain=microphoneContext.createGain();gain.gain.value=0;
const oscillator=microphoneContext.createOscillator(),destination=microphoneContext.createMediaStreamDestination();oscillator.connect(gain);gain.connect(destination);oscillator.start();
navigator.mediaDevices.getUserMedia=async()=>{await microphoneContext.resume();return destination.stream.clone();};
</script>${scripts.map(file=>`<script src="/${file}"></script>`).join('')}`));
for(const file of scripts)app.get('/'+file,(req,res)=>res.sendFile(require.resolve('../'+file)));
app.get('/api/hybrid/status',(req,res)=>res.json({geminiAllowed:false,local:{enabled:true,ready:true}}));
app.post('/api/hybrid/transcribe',(req,res)=>{calls.push('asr');assert.match(req.body.audio,/^data:audio/);res.json({ok:true,text:transcript});});
app.post('/api/local/chat',(req,res)=>{calls.push('local');assert.equal(req.body.voice,true);if(req.body.screen)assert.match(req.body.screen.text,/งานที่กำลังทำอยู่/);res.json({ok:true,provider:'local',text:req.body.screen?'สรุปงานปัจจุบัน':'สวัสดี',creditsCharged:0,sessionId:'s'});});
app.post('/api/sentinel/command',(req,res)=>{calls.push('command');if(req.body.command==='แบ่งคลิป')return res.json({ok:true,voiceAction:true,results:[{ok:true,toolId:'studio.command',output:{uiAction:'studio_command:'+encodeURIComponent(req.body.command)+'#split-fixture'}}]});assert.equal(req.body.command,'เปิดโน้ต');res.json({ok:true,voiceAction:true,results:[{ok:true,toolId:'window.open',output:{uiAction:'open_notes'}}]});});
app.post('/api/hybrid/speech',(req,res)=>{calls.push('tts');if(failSpeech)return res.status(503).json({error:'unavailable'});res.type('audio/wav').send(wav);});
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PANTHORIUM_TEST_BROWSER_PATH,channel:process.env.PANTHORIUM_TEST_BROWSER_CHANNEL||(process.platform==='win32'?'chrome':undefined),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({permissions:['microphone']}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>PanthoriumLiveVoice.toggle());await page.waitForFunction(()=>PanthoriumHybridVoice.state().mode==='listening');
  async function say(text){transcript=text;const count=calls.filter(x=>x==='asr').length;await page.evaluate(()=>gain.gain.value=.2);await page.waitForTimeout(450);await page.evaluate(()=>gain.gain.value=0);await page.waitForFunction(before=>document.querySelectorAll('.msg.user').length>before,count);await page.waitForFunction(()=>PanthoriumHybridVoice.state().mode==='listening');assert.equal(calls.filter(x=>x==='asr').length,count+1,'one utterance, one transcription');}
  await say('สวัสดี');assert.deepEqual(calls,['asr','local','tts']);assert.equal(await page.locator('.msg.ai').last().textContent(),'สวัสดี');
  await say('เปิดโน้ต');assert.equal(await page.locator('[data-id="notes"]').count(),1);assert.deepEqual(calls.slice(-3),['asr','command','tts'],'window command bypasses model prose');
  await say('อ่านหน้านี้');assert.match(await page.locator('.msg.ai').last().textContent(),/งานที่กำลังทำอยู่/);
  await say('สรุปหน้านี้');assert.equal(await page.locator('.msg.ai').last().textContent(),'สรุปงานปัจจุบัน');
  await say('แบ่งคลิป');assert.equal(await page.evaluate(()=>receivedCreativeVoice),'แบ่งคลิป');assert.deepEqual(calls.slice(-3),['asr','command','tts'],'creative commands retain their existing command route');
  await say('กรอกช่อง ชื่อ ว่า งานใหม่');assert.equal(await page.locator('#title').inputValue(),'');
  await say('ยืนยัน');assert.equal(await page.locator('#title').inputValue(),'งานใหม่');
  await say('กดปุ่ม บันทึก');assert.equal(await page.evaluate(()=>window.saved||0),0);
  await say('ยืนยัน');assert.equal(await page.evaluate(()=>saved),1);
  failSpeech=true;await say('อ่านหน้านี้');assert.equal(await page.evaluate(()=>PanthoriumHybridVoice.isActive()),true,'TTS failure keeps next command available');failSpeech=false;
  const previous=calls.length;await page.waitForTimeout(1300);assert.equal(calls.length,previous,'silence does not upload or invoke AI');
  transcript='ปิดไมค์';await page.evaluate(()=>gain.gain.value=.2);await page.waitForTimeout(450);await page.evaluate(()=>gain.gain.value=0);await page.waitForFunction(()=>!PanthoriumHybridVoice.isActive());
  assert.equal(calls.at(-1),'asr','stop listening does not invoke chat or TTS');
  await page.evaluate(()=>PanthoriumLiveVoice.toggle());await page.waitForFunction(()=>PanthoriumHybridVoice.state().mode==='listening');
  const beforeSwitch=calls.length;await page.evaluate(()=>{OS.state.user.id=OS.state.user.sub='b';window.dispatchEvent(new Event('panthorium:auth-changed'));});await page.waitForFunction(()=>!PanthoriumHybridVoice.isActive());assert.equal(calls.length,beforeSwitch,'account switch discards unsent audio');
  assert.deepEqual(errors,[]);console.log('Chromium continuous voice: VAD -> ASR -> command/open -> read -> summary -> fill/click/voice approval, TTS recovery, silence, spoken stop and account isolation passed');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
