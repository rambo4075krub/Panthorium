const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const { completeLive } = require('../services/geminiLiveCompletion');
const { ProviderManager } = require('../services/providerManager');

async function main() {
  const names = ['PANTHORIUM_AI_MODE','GEMINI_LIVE_ENABLED','GROQ_API_KEY','AI_PRIORITY'];
  const previous = Object.fromEntries(names.map(n => [n,process.env[n]]));
  try {
    process.env.PANTHORIUM_AI_MODE = 'gemini-live-only';
    process.env.GEMINI_LIVE_ENABLED = '1';
    process.env.GROQ_API_KEY = 'must-not-be-used';
    process.env.AI_PRIORITY = 'vertex,groq,openai';
    const providers = new ProviderManager();
    assert.deepEqual(providers.available(), ['gemini-live']);
    assert.deepEqual(providers.evaluationAvailable(), ['gemini-live']);
    assert.deepEqual(Object.keys(providers.keys), []);
    assert.deepEqual(providers.catalog().map(p=>p.provider), ['gemini-live']);
    assert.equal(providers.vertexConfigured(), false);
    await assert.rejects(providers.callDetailed('vertex','',[]), /provider_not_available/);
    await assert.rejects(providers.streamDetailed('groq','',[]), /provider_not_available/);
    await assert.rejects(providers.transcribeAudio(Buffer.alloc(2)), /gemini_live_microphone_required/);
  } finally { for (const n of names) previous[n] === undefined ? delete process.env[n] : process.env[n] = previous[n]; }

  const socket = new EventEmitter(); socket.readyState = 1;
  socket.close = () => { socket.readyState = 3; };
  socket.send = json => {
    const frame = JSON.parse(json);
    assert.equal(frame.client_content.turns[0].parts[0].text, 'hello');
    socket.emit('message', Buffer.from(JSON.stringify({serverContent:{outputTranscription:{text:'สวัสดี'}}})));
    socket.emit('message', Buffer.from(JSON.stringify({serverContent:{turnComplete:true}})));
  };
  const deltas = [];
  const result = await completeLive({history:[{role:'user',content:'hello'}],onDelta:t=>deltas.push(t),connect:async options=>{
    assert.equal(options.transcription,true);
    setImmediate(()=>socket.emit('message',Buffer.from('{"setupComplete":{}}')));
    return socket;
  }});
  assert.equal(result.text,'สวัสดี'); assert.equal(result.model,'gemini-3.8-live');
  assert.deepEqual(deltas,['สวัสดี']); assert.equal(socket.readyState,3);

  // Browser and Electron share this client. Exercise a real mic-processing
  // callback and provider audio while proving no REST STT/TTS request occurs.
  const events = []; let processAudio; let sent=[]; let outputPlayed=0; let trackStopped=false;
  const button = { title:'', classList:{toggle(){}}, addEventListener(){} };
  class AudioContext {
    constructor(){ this.sampleRate=48000;this.state='running';this.currentTime=0; }
    async resume(){} async close(){}
    createMediaStreamSource(){return {connect(){}};}
    createScriptProcessor(){ processAudio={connect(){},disconnect(){}};return processAudio; }
    createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
    createBuffer(channels,length,rate){return {duration:length/rate,getChannelData:()=>new Float32Array(length)};}
    createBufferSource(){return {connect(){},start(){outputPlayed++;},stop(){}};}
  }
  class Socket {
    static OPEN=1;static CLOSING=2;constructor(url){assert(url.endsWith('/api/live'));this.readyState=1;Socket.latest=this;setImmediate(()=>{this.onopen();this.onmessage({data:'{"type":"ready"}'});});}
    send(data){sent.push(JSON.parse(data));} close(){this.readyState=3;}
  }
  const window={AudioContext,location:{origin:'https://panthorium.test'},PanthoriumAuth:{ensureSession:async()=>{},getAccessToken:()=> 'test-token'},speechSynthesis:{cancel(){events.push('cancel-tts');}},dispatchEvent(e){events.push(e.type);},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../live-voice-client.js'),'utf8'), {window,document:{body:{dataset:{geminiLiveEnabled:'true',aiMode:'gemini-live-only'}},getElementById:()=>button,querySelectorAll:()=>[]},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){trackStopped=true;}}]})}},WebSocket:Socket,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},TextDecoder,Uint8Array,DataView,Float32Array,Set,Math,Promise,setTimeout,clearTimeout,console,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')});
  await window.PanthoriumLiveVoice.toggle();
  processAudio.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1024).fill(0.2)}});
  assert.equal(sent[0].type,'auth');
  assert.equal(sent[1].realtimeInput.audio.mimeType,'audio/pcm;rate=16000');
  Socket.latest.onmessage({data:JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{data:Buffer.alloc(100).toString('base64')}}]}}})});
  assert.equal(outputPlayed,1);assert(events.includes('cancel-tts'));assert(events.includes('panthorium:live-start'));
  await window.PanthoriumLiveVoice.toggle();assert.equal(trackStopped,true);assert.equal(window.PanthoriumLiveVoice.isActive(),false);
  console.log('Gemini Live only: isolated provider, text transcript, browser/Electron PCM input/output and cleanup passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
