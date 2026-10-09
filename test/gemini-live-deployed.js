const assert = require('node:assert/strict');
const WebSocket = require('ws');
(async () => {
  const base = new URL(process.env.LIVE_SMOKE_URL);
  assert.equal(base.protocol, 'https:');
  const healthResponse = await fetch(new URL('/api/health',base), {signal:AbortSignal.timeout(15000)});
  assert.equal(healthResponse.status,200);
  const health = await healthResponse.json();
  assert.equal(health.aiMode,'gemini-live-only');
  assert.deepEqual(health.sentinel.providers,['gemini-live']);
  const response = await fetch(new URL('/api/auth/guest', base), { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, 'guest authentication');
  const session = await response.json();
  assert(session.accessToken);
  const post = (path,body) => fetch(new URL(path,base), {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.accessToken}`},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  assert.equal((await post('/api/speech',{text:'hello',lang:'en-US'})).status,410);
  assert.equal((await post('/api/speech/transcribe',{})).status,410);
  const chat = await (await post('/api/chat',{message:'ตอบสั้นที่สุดว่า พร้อม',sessionId:'live-only-deploy-chat'})).json();
  assert.equal(chat.ok,true,`Live text failed: ${chat.error}`);
  assert.equal(chat.provider,'gemini-live');
  assert.equal(chat.model,'gemini-3.8-live');
  assert(chat.text?.trim());
  const streamResponse = await post('/api/chat/stream',{message:'ตอบสั้นที่สุดว่า พร้อม',sessionId:'live-only-deploy-stream'});
  assert.equal(streamResponse.status,200);
  const stream = await streamResponse.text();
  assert(stream.includes('event: delta'));
  assert(stream.includes('event: done'));
  assert(!stream.includes('event: error'));
  console.log('Live-only deployment: sole provider, legacy STT/TTS disabled, real text and streaming passed.');
  // A browser shell alone does not prove provider connectivity. Authenticate a
  // short-lived WebSocket and require the backend to relay Google's setupComplete.
  const liveURL = new URL('/api/live', base);
  liveURL.protocol = 'wss:';
  const liveSocket = new WebSocket(liveURL, {
    origin: base.origin,
    handshakeTimeout: 15000,
    maxPayload: 8 * 1024 * 1024,
    perMessageDeflate: false
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        liveSocket.terminate();
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Gemini Live setup handshake timed out')), 45000);
    liveSocket.once('open', () => liveSocket.send(JSON.stringify({ type: 'auth', token: session.accessToken })));
    liveSocket.on('message', data => {
      let frame;
      try { frame = JSON.parse(String(data)); } catch { return; }
      if (frame.type === 'ready') finish();
      else if (frame.error || frame.type === 'error') {
        const detail = JSON.stringify(frame.error || frame).slice(0, 400);
        finish(new Error(`Gemini Live rejected setup: ${detail}`));
      }
    });
    liveSocket.once('error', error => finish(new Error(`Gemini Live WebSocket failed: ${String(error?.message || error).slice(0, 160)}`)));
    liveSocket.once('close', (code, reason) => finish(new Error(`Gemini Live closed before ready (${code}: ${String(reason).slice(0, 120)})`)));
  });
  console.log('Gemini Live handshake passed: authenticated WebSocket received provider setupComplete.');
  const responseAudio = [];
  await new Promise((resolve, reject) => {
    let audioBytes = 0;
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveSocket.removeListener('message', onMessage);
      liveSocket.removeListener('error', onError);
      liveSocket.removeListener('close', onClose);
      if (error) { liveSocket.terminate(); reject(error); }
      else { console.log(`Gemini Live audio passed: received ${audioBytes} bytes of PCM audio.`); resolve(); }
    };
    const onError = error => finish(new Error(`Gemini Live audio socket failed: ${String(error?.message || error).slice(0, 160)}`));
    const onClose = (code, reason) => finish(new Error(`Gemini Live closed before audio (${code}: ${String(reason).slice(0, 120)})`));
    const onMessage = data => {
      let frame;
      try { frame = JSON.parse(String(data)); } catch { return; }
      if (frame.error) return finish(new Error(`Gemini Live audio rejected: ${JSON.stringify(frame.error).slice(0, 400)}`));
      const content = frame.serverContent || frame.server_content;
      if (!content) return;
      for (const part of content.modelTurn?.parts || content.model_turn?.parts || []) {
        const audio = part.inlineData || part.inline_data;
        if (!audio?.data) continue;
        const mime = audio.mimeType || audio.mime_type || '';
        if (!mime.startsWith('audio/pcm')) return finish(new Error(`Unexpected Gemini Live audio format: ${mime}`));
        const bytes = Buffer.from(audio.data, 'base64');
        if (!bytes.length || bytes.length % 2) return finish(new Error('Gemini Live returned invalid PCM audio'));
        audioBytes += bytes.length;
        responseAudio.push(bytes);
      }
      if (content.turnComplete || content.turn_complete) {
        finish(audioBytes > 0 ? null : new Error('Gemini Live finished without audio'));
      }
    };
    const timer = setTimeout(() => finish(new Error('Gemini Live audio response timed out')), 45000);
    liveSocket.on('message', onMessage);
    liveSocket.once('error', onError);
    liveSocket.once('close', onClose);
    liveSocket.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'พูดสั้น ๆ ว่า สวัสดี พร้อมใช้งาน โดยไม่เรียกใช้ฟังก์ชันใด' }] }], turnComplete: true } }));
  });
  // Replay generated speech as microphone-format PCM: verify audio input,
  // not just a text request that happens to receive speech output.
  const captured = Buffer.concat(responseAudio);
  const sampleCount = Math.floor(captured.length / 2 / 1.5);
  const pcm16k = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) pcm16k.writeInt16LE(captured.readInt16LE(Math.floor(i * 1.5) * 2), i * 2);
  await new Promise((resolve,reject) => {
    let bytesReceived=0;
    let settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);liveSocket.removeListener('message',onMessage);liveSocket.removeListener('close',onClose);liveSocket.removeListener('error',onError);if(error){liveSocket.terminate();reject(error);}else{console.log(`Gemini Live PCM microphone-format input passed: received ${bytesReceived} response bytes.`);resolve();}};
    const onClose=code=>finish(new Error(`Live PCM input closed: ${code}`));
    const onError=error=>finish(error);
    const onMessage=data=>{
      let frame;try{frame=JSON.parse(String(data));}catch{return;}
      if(frame.error)return finish(new Error(`Live PCM input error: ${JSON.stringify(frame.error).slice(0,200)}`));
      const content=frame.serverContent||frame.server_content;if(!content)return;
      for(const part of content.modelTurn?.parts||content.model_turn?.parts||[]){const audio=part.inlineData||part.inline_data;if(audio?.data)bytesReceived+=Buffer.from(audio.data,'base64').length;}
      if(content.turnComplete||content.turn_complete)finish(bytesReceived>0?null:new Error('Live PCM input produced no response audio'));
    };
    const timer=setTimeout(()=>finish(new Error('Live PCM input response timed out')),45000);
    liveSocket.on('message',onMessage);liveSocket.once('close',onClose);liveSocket.once('error',onError);
    (async()=>{
      for(let offset=0;offset<pcm16k.length && !settled;offset+=3200){
        liveSocket.send(JSON.stringify({realtimeInput:{audio:{mimeType:'audio/pcm;rate=16000',data:pcm16k.subarray(offset,offset+3200).toString('base64')}}}));
        await new Promise(done=>setTimeout(done,100));
      }
      if(!settled)liveSocket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));
    })().catch(finish);
  });
  await new Promise(resolve => {
    if (liveSocket.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => { liveSocket.terminate(); resolve(); }, 2000);
    liveSocket.once('close', () => { clearTimeout(timer); resolve(); });
    liveSocket.close(1000, 'live-smoke-complete');
  });

})().catch(error => { console.error(error.message); process.exitCode = 1; });
