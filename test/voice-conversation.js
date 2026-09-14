// Real shell, auth/stream wrappers, command client and HTTP router. Only the
// external AI/TTS providers and browser speech hardware are deterministic fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { JSDOM, VirtualConsole } = require('jsdom');
const { AuthService } = require('../services/authService');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { AgentWorkflowService } = require('../services/agentWorkflowService');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const answer = 'การเรียนรู้คือการพัฒนาความเข้าใจจากประสบการณ์';
const user = { id: 'voice-test', username: 'admin', permissions: ['chat', 'settings', 'sentinel:command'], roles: ['administrator'] };

(async () => {
  const synthesized = [], conversations = [], requests = [], playback = [], revoked = [], recognizers = [];
  let failProvider = false, failSpeech = false, blockPlayback = false, rejectOnce = '', rejectAlways = '', refreshOK = true, playing = false, chatFailure = null;
  // No network access to an AI or speech provider in CI.
  require('../services/sentinelSpeechAudio').synthesizeSentinelMaleVoice = async (text, lang) => {
    if (failSpeech) throw new Error('fixture TTS outage');
    synthesized.push({ text, lang });
    return { audio: Buffer.from('fixture-audio-bytes'), voice: 'en-US-AndrewMultilingualNeural' };
  };
  const { createApiRouter } = require('../routes/api');
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'voice-conversation-local-test-secret', accessTokenTtl: '1h' }, audit });
  const sentinel = {
    chat: async input => { conversations.push(input); return failProvider ? { ok: false, error: 'no_provider_available' } : { ok: true, text: answer, provider: 'fixture' }; },
    streamChat: async ({ onDelta }) => { onDelta(answer); return { ok: true, text: answer }; }
  };
  const tools = new ToolRegistry({ sentinel });
  const agent = new AgentService({ tools, audit });
  const workflow = new AgentWorkflowService({ agentService: agent, audit, gateway: { complete: async () => ({ ok: true, text: JSON.stringify({ steps: [], answer: 'not an action' }) }) } });
  const app = express(); app.use(express.json());
  app.use('/api', createApiRouter(sentinel, auth, audit, {}, agent, {}, workflow, {}, {}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM(source('sentinel.html'), { url: 'https://staging.example.test/admin', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  const evaluate = code => vm.runInContext(code, dom.getInternalVMContext());
  const objects = new Map();
  try {
    Object.assign(w, { Headers, AbortSignal, AbortController, Blob, TextDecoder, TextEncoder });
    w.URL.createObjectURL = blob => { const url = `blob:https://staging.example.test/${objects.size}`; objects.set(url, blob); return url; };
    w.URL.revokeObjectURL = url => revoked.push(url);
    w.Audio = class {
      pause() { playing = false; }
      async play() {
        if (this.src.startsWith('data:')) throw new Error('CSP media-src rejects data:');
        assert(objects.has(this.src), 'audio must use a prepared blob URL');
        if (this.volume === 0) return; // gesture warmup, not an AI reply
        if (blockPlayback) throw Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' });
        assert.equal(this.volume, 1);
        playback.push({ src: this.src, blob: objects.get(this.src) });
        playing = true;
        setTimeout(() => { playing = false; this.onended?.(); }, 25);
      }
    };
    w.SpeechRecognition = class {
      constructor() { recognizers.push(this); }
      start() { this.starts = (this.starts || 0) + 1; assert.equal(playing, false, 'recognition must not restart while the answer is playing'); this.onstart?.(); }
      stop() { return this.onend?.(); }
    };
    w.fetch = async (url, options = {}) => {
      const pathname = new URL(url, base).pathname;
      requests.push({ pathname, body: options.body && JSON.parse(options.body), token: new Headers(options.headers).get('Authorization') });
      if (pathname === '/api/auth/logout') return Response.json({ ok: true });
      if (pathname === '/api/auth/login' || pathname === '/api/auth/refresh') return refreshOK
        ? Response.json({ ok: true, user, accessToken: auth.signAccessToken(user) }) : Response.json({ ok: false }, { status: 401 });
      if (pathname === '/api/chat' && chatFailure) return chatFailure();
      if (pathname === rejectOnce || pathname === rejectAlways) { rejectOnce = ''; return Response.json({ ok: false, error: 'authentication_required' }, { status: 401 }); }
      return fetch(base + pathname, options);
    };
    const inline = [...w.document.scripts].find(script => script.textContent.includes('const OS =')).textContent;
    evaluate(inline.replace(/\n    boot\(\);/, '\n    OS.state.booted = true;'));
    for (const file of ['phase2-auth.js', 'voice-window-catalog.js', 'external-apps-ui.js', 'voice-command-client.js', 'ai-stream-client.js']) evaluate(source(file));
    await tick(); await w.PanthoriumAuth.login('admin', 'fixture'); w.PanthoriumAIStream.install();
    evaluate('initGlobalVoice();');
    w.addEventListener('panthorium:voice-start', () => {
      assert.notEqual(w.PanthoriumVoice.state(), 'listening', 'stop the mic before preparing speech');
    });
    const globalMic = recognizers[0];
    // Let the shell's one-time mic startup finish before injecting transcripts.
    await new Promise(resolve => setTimeout(resolve, 420)); w.PanthoriumVoice.pause();
    const transcript = (mic, text, final = true) => { const result = [{ transcript: text, confidence: 0.99 }]; result.isFinal = final; mic.onresult({ resultIndex: 0, results: [result] }); };
    async function utter(text, final = true) {
      globalMic.start(); transcript(globalMic, text, final); globalMic.stop();
      for (let i = 0; i < 400 && w.PanthoriumVoice.state() !== 'idle'; i++) await tick();
      assert.equal(w.PanthoriumVoice.state(), 'idle', 'voice request must finish'); w.PanthoriumVoice.pause();
    }
    await utter('การเรียนรู้คืออะไร');
    assert.equal(conversations.length, 1, 'a spoken question must reach /api/chat, not disappear into the streaming wrapper');
    assert.equal(conversations[0].voiceMode, true, 'low-latency voice flag reaches the actual server service');
    assert.equal(conversations[0].userId, user.id);
    assert.equal(playback.length, 1, 'a successful spoken question must play its answer');
    assert.equal(synthesized[0].text, answer);
    assert(!requests.some(r => r.pathname === '/api/chat/stream'), 'voice questions bypass text streaming');
    assert(revoked.includes(playback[0].src), 'release audio blob after playback ends');
    assert(!w.document.querySelector('#sentinel-command-result'), 'never add a result popup over the microphone');

    // A browser that terminates with interim-only text must still get an answer.
    await utter('ช่วยอธิบายการเรียนรู้', false);
    assert.equal(playback.length, 2);
    // Both microphone entry points use the same routing and real speech code.
    evaluate('openSentinel();');
    const chatMic = recognizers[1];
    await w.document.getElementById('chat-mic').onclick();
    transcript(chatMic, 'การเรียนรู้คืออะไร');
    await chatMic.stop(); // natural end, no second click/silence timer needed
    w.PanthoriumVoice.pause();
    assert.equal(playback.length, 3, 'window microphone must also answer natural-ended speech');
    assert.match(w.document.getElementById('chat-messages').textContent, new RegExp(answer));

    rejectOnce = '/api/chat';
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 4, 'refresh expired chat authentication then answer');
    rejectOnce = '/api/speech';
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 5, 'refresh expired TTS authentication then play');
    assert.equal(requests.filter(r => r.pathname === '/api/auth/refresh').length, 2);

    failProvider = true;
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 5, 'never speak an API failure as a successful AI answer');
    assert.match(w.document.getElementById('toast').textContent, /no_provider_available/);
    failProvider = false; blockPlayback = true;
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 5);
    assert.match(w.document.getElementById('toast').textContent, /เล่นเสียง.*ไม่สำเร็จ/);
    blockPlayback = false; failSpeech = true;
    await utter('การเรียนรู้คืออะไร');
    assert.match(w.document.getElementById('toast').textContent, /เล่นเสียง.*ไม่สำเร็จ/);
    failSpeech = false;

    rejectAlways = '/api/chat'; refreshOK = false;
    const before = requests.length;
    await utter('การเรียนรู้คืออะไร');
    assert.match(w.document.getElementById('toast').textContent, /เข้าสู่ระบบ/);
    assert.equal(requests.slice(before).filter(r => r.pathname === '/api/chat').length, 1, 'failed refresh must not loop/retry as another user');
    assert.equal(playback.length, 5);
    rejectAlways = ''; refreshOK = true;
    for (const [response, expected] of [
      [() => Response.json({ ok: false }, { status: 403 }), /ไม่มีสิทธิ์/],
      [() => Response.json({ ok: false }, { status: 429 }), /ขีดจำกัด/],
      [() => Response.json({ ok: true, text: '' }), /empty_ai_response/],
      [() => new Response('not json'), /empty_ai_response/],
      [() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, /chat_timeout/]
    ]) {
      chatFailure = response; await utter('การเรียนรู้คืออะไร');
      assert.match(w.document.getElementById('toast').textContent, expected);
      assert.equal(playback.length, 5, 'invalid/forbidden responses must not produce speech');
    }
    chatFailure = null;

    // Unsupported commands stay commands: never convert a failure to AI prose.
    const chats = conversations.length, audioCount = synthesized.length;
    await utter('เปิดฟังก์ชันที่ไม่มีอยู่');
    assert.equal(conversations.length, chats);
    assert.equal(synthesized.length, audioCount);
    // Text chat retains streaming; the voice fix must not disable it globally.
    const typed = await w.callAI('การเรียนรู้คืออะไร');
    assert.equal(typed.via, 'sentinel-stream');
    assert.equal(typed.text, answer);

    // Allow the actual hands-free restart. Media play asserts it cannot start
    // recognition mid-answer; this assertion also proves playback fully ended.
    w.PanthoriumVoice.resume();
    await new Promise(resolve => setTimeout(resolve, 400));
    transcript(globalMic, 'การเรียนรู้คืออะไร'); globalMic.stop();
    for (let i = 0; i < 400 && w.PanthoriumVoice.state() !== 'listening'; i++) await tick();
    assert.equal(w.PanthoriumVoice.state(), 'listening');
    assert.equal(playback.length, 6);
    assert.equal(playing, false);
    w.PanthoriumVoice.pause();

    // Electron exposes SpeechRecognition even when its remote service fails.
    // An error followed by onend/resume must never create a 350ms retry loop.
    w.panthoriumDesktop = { isElectron: true };
    w.PanthoriumVoice.resume();
    await new Promise(resolve => setTimeout(resolve, 400));
    const startsBeforeFailure = globalMic.starts;
    globalMic.onerror({ error: 'network' });
    globalMic.stop();
    w.PanthoriumVoice.resume();
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(globalMic.starts, startsBeforeFailure, 'network failure latches across onend and resume');
    assert.match(w.document.getElementById('toast').textContent, /Electron.*network/);
    assert.equal(w.PanthoriumVoice.state(), 'idle');
    await w.document.getElementById('global-voice').onclick();
    assert.equal(globalMic.starts, startsBeforeFailure + 1, 'explicit mic click permits a fresh attempt');
    w.PanthoriumVoice.pause();
    await w.document.getElementById('chat-mic').onclick();
    const beforeChatError = globalMic.starts;
    chatMic.onerror({ error: 'network' });
    await chatMic.stop();
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(globalMic.starts, beforeChatError, 'chat mic failure must not transfer the retry loop to global mic');
    assert.match(w.document.getElementById('toast').textContent, /Electron.*network/);
    const afterMicFailure = await w.callAI('การเรียนรู้คืออะไร');
    assert.equal(afterMicFailure.text, answer, 'typing still works after recognition fails');

    evaluate('unlockVoiceAudio();'); await tick();
    const warmups = [...objects.values()].filter(b => b.type === 'audio/wav');
    assert(warmups.length > 0, 'warmup uses CSP-compatible WAV blob, not a blocked data URL');
    assert(warmups.every(b => b.size > 44), 'WAV must include nonzero-duration sample data');
    for (const text of ['การเรียนรู้คืออะไร', 'Sentinel คืออะไร', 'เปิด Learning Lab ยังไง', 'how do I open Learning Lab?', 'what is Sentinel?', 'สวัสดี', 'รู้จัก Learning Lab ไหม']) {
      assert.equal(w.PanthoriumWindowCatalog.classifyVoiceInput(text).kind, 'conversation', text);
    }
    for (const text of ['เปิด Learning Lab', 'ปิด Learning Lab', 'อย่าเปิด Learning Lab', 'ช่วยเปิด Learning Lab', 'Sentinel เปิด Learning Lab', 'แสดงสถานะระบบ', 'ค้นความรู้ คู่มือ', 'ยืนยัน', 'ยกเลิก', 'เปิดสิ่งที่ไม่มีอยู่']) {
      assert.equal(w.PanthoriumWindowCatalog.classifyVoiceInput(text).kind, 'command', text);
    }
    assert.equal(evaluate('voiceResponseNeedsSpeech("command", { ok:true, text:"permission for next step", confirmationRequired:true, confirmedCommand:true })'), true, 'a subsequent pending step must ask permission again');
    assert.equal(evaluate('voiceResponseNeedsSpeech("command", { ok:true, text:"done", uiResults:[] })'), false, 'empty results must not accidentally enable command speech');
    assert.equal(evaluate('voiceResponseNeedsSpeech("conversation", { ok:true, text:"answer", via:"sentinel-stream" })'), true, 'speech policy must not depend on transport names');
    console.log('PASS: both mics → real authenticated chat route (voice=true) → TTS route → audio ended; interim input, expired sessions, provider/TTS/playback failures, silent command failure and typed streaming');
  } finally { w.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
