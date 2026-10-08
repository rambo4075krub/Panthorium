// Post-deploy staging smoke check, including real provider handshake and audio.
// No administrator credentials. Never print the transient guest token.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const WebSocket = require('ws');
(async () => {
  const base = new URL(process.env.STAGING_URL);
  assert.equal(base.protocol, 'https:');
  assert(base.hostname.includes('staging') && base.hostname.endsWith('.run.app'), 'staging only');
  const healthResponse = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(healthResponse.status, 200, 'staging health endpoint');
  const health = await healthResponse.json();
  assert.equal(health.voiceIdentityConfigured, true, 'speaker and template encryption must be configured');
  assert.equal(health.voiceIdentityGateEnabled, true, 'staging must enforce enrolled-speaker verification');
  const post = (path, body, token) => fetch(new URL(path, base), {
    method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const preflight = await fetch(new URL('/api/auth/login', base), { method: 'OPTIONS', headers: { Origin: base.origin, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204, 'admin login CORS preflight');
  assert.equal(preflight.headers.get('access-control-allow-origin'), base.origin, 'CORS must echo the actual staging origin');
  const electronPreflight = await fetch(new URL('/api/auth/login', base), { method: 'OPTIONS', headers: { Origin: 'null', 'User-Agent': 'Panthorium Electron/36', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(electronPreflight.status, 204, 'Electron file origin preflight');
  assert.equal(electronPreflight.headers.get('access-control-allow-origin'), 'null', 'Electron must receive its original null origin');
  const foreignPreflight = await fetch(new URL('/api/auth/login', base), { method: 'OPTIONS', headers: { Origin: 'https://unrelated.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(foreignPreflight.status, 403, 'unrelated browser origins must stay denied');
  let html;
  for (const route of ['/', '/admin']) {
    const shell = await fetch(new URL(route, base));
    assert.equal(shell.status, 200, `${route} guest/admin shell`);
    const page = await shell.text();
    assert(page.includes('/voice-window-catalog.js?') && page.includes('/external-apps-ui.js?') && page.includes('/voice-command-client.js?') && page.includes('/live-voice-client.js?'), `${route} must load the tested voice and Gemini Live assets`);
    assert(page.includes('data-gemini-live-enabled="true"'), `${route} must enable Gemini Live on staging`);
    if (route === '/') html = page;
  }
  const deployedDOM = new JSDOM(html);
  const testedDOM = new JSDOM(fs.readFileSync(path.join(__dirname, '..', 'sentinel.html'), 'utf8'));
  try {
    const runtime = dom => [...dom.window.document.scripts].find(script => script.textContent.includes('const OS ='))?.textContent;
    assert(runtime(testedDOM), 'test checkout must contain the voice runtime');
    assert.equal(runtime(deployedDOM), runtime(testedDOM), 'deployed inline voice runtime must exactly match the tested shell');
    assert(runtime(deployedDOM).includes('AbortSignal.timeout(40000)'), 'voice request allows the backend verification deadline to return');
    assert(runtime(deployedDOM).includes('voice_verification_unavailable'), 'cloud verification failures have a specific user message');
    assert(runtime(deployedDOM).includes('error?.voiceDiagnostic'), 'staging rejection feedback includes only match score metadata');
  } finally { deployedDOM.window.close(); testedDOM.window.close(); }
  assert.equal((await post('/api/sentinel/command', { command: 'เปิด AI Platform' })).status, 401);
  const sessionResponse = await post('/api/auth/guest', {});
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert(session.accessToken);

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
  console.log('Gemini Live staging handshake passed: authenticated WebSocket received provider setupComplete.');
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
      else { console.log(`Gemini Live staging audio passed: received ${audioBytes} bytes of PCM audio.`); resolve(); }
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
  await new Promise(resolve => {
    if (liveSocket.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => { liveSocket.terminate(); resolve(); }, 2000);
    liveSocket.once('close', () => { clearTimeout(timer); resolve(); });
    liveSocket.close(1000, 'staging-smoke-complete');
  });

  const guestVoiceStatus = await fetch(new URL('/api/biometrics/status', base), { headers: { Origin: base.origin, Authorization: `Bearer ${session.accessToken}` } });
  assert.equal(guestVoiceStatus.status, 200, 'guest voice enrollment status API');
  const guestVoiceProfiles = await fetch(new URL('/api/biometrics/voice/profiles', base), { headers: { Origin: base.origin, Authorization: `Bearer ${session.accessToken}` } });
  assert.equal(guestVoiceProfiles.status, 200, 'guest voice profiles API');
  assert.deepEqual((await guestVoiceProfiles.json()).profiles, [], 'new staging guest starts with its own empty voice profile list');
  for (const [command, expected] of [['เปิด Sentinel AI', 'open_sentinel'], ['ปิด Sentinel AI', 'close_sentinel']]) {
    const response = await post('/api/sentinel/command', { command }, session.accessToken);
    assert.equal(response.status, 200, command);
    const data = await response.json();
    assert.equal(data.uiPending, true);
    assert.equal(data.executed, false, 'server must wait for UI execution');
    assert.equal(data.results[0].output.uiAction, expected);
  }
  const forbidden = await post('/api/sentinel/command', { command: 'เปิด Learning Lab' }, session.accessToken);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, 'voice_action_permission_denied');
  assert.equal((await post('/api/sentinel/command', { command: 'เปิด AI Platform' }, session.accessToken)).status, 403);
  const chatResponse = await fetch(new URL('/api/chat', base), { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` }, body: JSON.stringify({ message: 'ตอบสั้น ๆ ว่า Sentinel พร้อมทดสอบ', sessionId: 'staging-guest-smoke', provider: 'vertex' }), signal: AbortSignal.timeout(90000) });
  assert.equal(chatResponse.status, 200, 'guest chat HTTP status');
  const chat = await chatResponse.json();
  if (!chat.ok && Array.isArray(chat.providerFailureCodes)) console.error('Vertex guest chat diagnostics:', JSON.stringify(chat.providerFailureCodes));
  assert.equal(chat.ok, true, `guest AI chat failed: ${chat.error || 'unknown'}${chat.providerFailureCodes ? ` (${JSON.stringify(chat.providerFailureCodes)})` : ''}`);
  if (chat.provider !== 'vertex') console.error('Vertex fallback diagnostic:', JSON.stringify(chat.providerFailureCodes || []));
  assert.equal(chat.provider, 'vertex', `tuned Vertex endpoint unavailable (fallback: ${chat.provider || 'none'})`);
  assert(chat.text?.trim(), 'guest chat answer must be nonempty');

  const streamStartedAt = Date.now();
  const streamResponse = await fetch(new URL('/api/chat/stream', base), {
    method: 'POST',
    headers: { Origin: base.origin, 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ message: 'ตอบสั้นที่สุดว่า Sentinel พร้อม', sessionId: 'staging-guest-stream-smoke', provider: 'vertex' }),
    signal: AbortSignal.timeout(90000)
  });
  assert.equal(streamResponse.status, 200, 'guest streaming chat HTTP status');
  assert(streamResponse.body, 'guest streaming chat must return an SSE body');
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamText = '';
  let firstDeltaMs = null;
  let streamDone = null;
  let streamError = null;
  const consumeFrames = (frames) => {
    for (const frame of frames) {
      let event = 'message';
      let data = null;
      for (const line of frame.replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10))) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) { try { data = JSON.parse(line.slice(5).trim()); } catch (_) {} }
      }
      if (!data) continue;
      if (event === 'delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - streamStartedAt;
        streamText += data.delta || '';
      } else if (event === 'done') streamDone = data;
      else if (event === 'error') streamError = data.error || 'stream_failed';
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10, 10));
    buffer = frames.pop() || '';
    consumeFrames(frames);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeFrames([buffer]);
  assert.equal(streamError, null, `guest streaming chat failed: ${streamError || ''}`);
  assert(streamDone, 'guest stream must finish with a done event');
  assert.equal(streamDone.provider, 'vertex');
  assert.equal(streamDone.model, 'sentinel-v4');
  assert.equal(streamDone.streaming, 'native');
  assert(streamText.trim(), 'guest stream must contain answer deltas');
  assert(firstDeltaMs !== null && firstDeltaMs < 30000, `first Sentinel V4 delta took ${firstDeltaMs}ms; expected under 30000ms`);
  console.log(`Staging stream: provider=vertex model=sentinel-v4 firstDeltaMs=${firstDeltaMs} streaming=native`);
  console.log('Staging: browser and Electron CORS passed; guest command, tuned Vertex chat/stream, and Gemini Live provider handshake passed. Browser microphone/TTS and function-action acceptance remain.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

