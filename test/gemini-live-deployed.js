const assert = require('node:assert/strict');
const WebSocket = require('ws');
(async () => {
  const base = new URL(process.env.LIVE_SMOKE_URL);
  assert.equal(base.protocol, 'https:');
  const response = await fetch(new URL('/api/auth/guest', base), { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, 'guest authentication');
  const session = await response.json();
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
  console.log('Gemini Live handshake passed: authenticated WebSocket received provider setupComplete.');
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
    liveSocket.close(1000, 'live-smoke-complete');
  });

})().catch(error => { console.error(error.message); process.exitCode = 1; });
