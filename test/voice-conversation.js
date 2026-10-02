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
  const synthesized = [], conversations = [], streamConversations = [], requests = [], playback = [], revoked = [], recognizers = [];
  let failProvider = false, failSpeech = false, blockPlayback = false, rejectOnce = '', rejectAlways = '', refreshOK = true, playing = false, holdPlayback = false, chatFailure = null, ttsInFlight = 0, maxTtsInFlight = 0, fakeTts = false, speechAttempts = 0, pendingDeltaAt = 0, firstSpeechLatencyMs = null;
  // No network access to an AI or speech provider in CI.
  require('../services/sentinelSpeechAudio').synthesizeSentinelMaleVoice = async (text, lang) => {
    speechAttempts += 1;
    if (failSpeech) throw new Error('fixture TTS outage');
    synthesized.push({ text, lang });
    return { audio: Buffer.from('fixture-audio-bytes'), voice: 'th-TH-NiwatNeural' };
  };
  const { createApiRouter } = require('../routes/api');
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'voice-conversation-local-test-secret', accessTokenTtl: '1h' }, audit });
  const sentinel = {
    status: () => ({ name: 'Sentinel', providers: ['fixture'] }),
    chat: async input => { conversations.push(input); return failProvider ? { ok: false, error: 'no_provider_available' } : { ok: true, text: answer, provider: 'fixture' }; },
    streamChat: async input => { streamConversations.push(input); if (failProvider) return { ok: false, error: 'no_provider_available', text: 'no_provider_available' }; input.onDelta(answer); return { ok: true, text: answer, provider: 'fixture', streaming: 'native' }; }
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
      constructor() { this.readyState = 4; }
      load() { this.readyState = 4; }
      addEventListener() {}
      removeEventListener() {}
      removeAttribute(name) { if (name === 'src') this.src = ''; }
      pause() { playing = false; }
      async play() {
        if (this.src.startsWith('data:')) throw new Error('CSP media-src rejects data:');
        assert(objects.has(this.src), 'audio must use a prepared blob URL');
        if (this.volume !== 0) assert.equal(this.preload, 'auto', 'next TTS clip must be decoded before it reaches playback');
        if (this.volume === 0) { this.unlocked = true; return; }
        if (!this.unlocked) throw Object.assign(new Error('media element was not unlocked by a gesture'), { name: 'NotAllowedError' });
        if (blockPlayback) throw Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' });
        assert.equal(this.volume, 1);
        playback.push({ src: this.src, blob: objects.get(this.src) });
        playing = true;
        if (!holdPlayback) setTimeout(() => { playing = false; this.onended?.(); }, 25);
      }
    };
    w.SpeechRecognition = class {
      constructor() { recognizers.push(this); }
      start() { this.starts = (this.starts || 0) + 1; assert.equal(playing, false, 'recognition must not restart while the answer is playing'); this.onstart?.(); }
      stop() { return this.onend?.(); }
    };
    w.addEventListener('panthorium:ai-stream-delta', () => { pendingDeltaAt = Date.now(); });
    w.fetch = async (url, options = {}) => {
      const pathname = new URL(url, base).pathname;
      if (pathname === '/api/speech' && pendingDeltaAt && firstSpeechLatencyMs === null) {
        firstSpeechLatencyMs = Date.now() - pendingDeltaAt;
        pendingDeltaAt = 0;
      }
      requests.push({ pathname, body: options.body && JSON.parse(options.body), token: new Headers(options.headers).get('Authorization') });
      if (pathname === '/api/auth/logout') return Response.json({ ok: true });
      if (pathname === '/api/auth/login' || pathname === '/api/auth/refresh') return refreshOK
        ? Response.json({ ok: true, user, accessToken: auth.signAccessToken(user) }) : Response.json({ ok: false }, { status: 401 });
      if ((pathname === '/api/chat' || pathname === '/api/chat/stream') && chatFailure) return chatFailure();
      if (pathname === rejectOnce || pathname === rejectAlways) { rejectOnce = ''; return Response.json({ ok: false, error: 'authentication_required' }, { status: 401 }); }
      if (pathname === '/api/speech' && fakeTts) {
        ttsInFlight += 1; maxTtsInFlight = Math.max(maxTtsInFlight, ttsInFlight);
        await new Promise(resolve => setTimeout(resolve, 12));
        ttsInFlight -= 1;
        const speechLang = JSON.parse(options.body || '{}').lang;
        return new Response(Buffer.from('fixture-mp3'), { headers: { 'Content-Type': 'audio/mpeg', 'X-Sentinel-Voice-Profile': 'th-TH-NiwatNeural' } });
      }
      return fetch(base + pathname, options);
    };
    const inline = [...w.document.scripts].find(script => script.textContent.includes('const OS =')).textContent;
    evaluate(inline.replace(/\n    boot\(\);/, '\n    OS.state.booted = true;'));
  const quietDetector = evaluate("createAdaptiveVoiceDetector()");
  quietDetector.observe(0.018, 500);
  assert.equal(quietDetector.observe(0.018, 600), true, 'quiet mobile speech must cross the adaptive voice threshold');
  const immediateSpeechDetector = evaluate("createAdaptiveVoiceDetector()");
  immediateSpeechDetector.observe(0.04, 50);
  assert.equal(immediateSpeechDetector.observe(0.04, 150), true, 'speech starting immediately must not be learned as ambient noise');
    for (const file of ['phase2-auth.js', 'voice-window-catalog.js', 'external-apps-ui.js', 'voice-command-client.js', 'ai-stream-client.js']) evaluate(source(file));
    await tick(); await w.PanthoriumAuth.login('admin', 'fixture'); w.PanthoriumAIStream.install();
    evaluate('initGlobalVoice();');
    w.addEventListener('panthorium:voice-start', () => {
      assert.notEqual(w.PanthoriumVoice.state(), 'listening', 'stop the mic before preparing speech');
    });
    const globalMic = recognizers[0];
    for (const phrase of ['หยุด', 'หยุดพูด', 'ไม่ต้องพูด', 'หยุดเดี๋ยวนี้', 'หยุดเสียง', 'พอ', 'เซา', 'เซาๆ', 'หยุดนะ']) assert.equal(evaluate(`isVoiceStopCommand(${JSON.stringify(phrase)})`), true, `recognize voice stop phrase: ${phrase}`);
    assert.equal(evaluate(`isVoiceStopCommand('หยุดทำงานได้ไหม')`), false, 'do not interrupt on an ordinary question that mentions stop');
    for (const phrase of ['พูดต่อ', 'พูดต่อไป', 'พูดต่อได้', 'พูดต่อได้เลย', 'เล่าต่อ', 'อ่านต่อ', 'continue', 'continue speaking', 'please continue', 'go on', 'keep going', 'carry on', 'go ahead']) assert.equal(evaluate(`isVoiceContinueCommand(${JSON.stringify(phrase)})`), true, `recognize continue phrase: ${phrase}`);
    assert.equal(evaluate(`isVoiceContinueCommand('ช่วยอธิบายต่อได้ไหม')`), false, 'do not consume a normal question as a continue command');
    // Let the shell's one-time mic startup finish before injecting transcripts.
    await new Promise(resolve => setTimeout(resolve, 420));
    assert.equal(globalMic.starts, 1, 'hands-free microphone starts once without a click');
    w.PanthoriumVoice.pause();
    w.dispatchEvent(new w.Event('pointerdown')); // unlock both reusable audio elements from a user gesture
    const transcript = (mic, text, final = true, confidence = 0.99) => { const result = [{ transcript: text, confidence }]; result.isFinal = final; mic.onresult({ resultIndex: 0, results: [result] }); };
    async function utter(text, final = true) {
      globalMic.start(); transcript(globalMic, text, final); globalMic.stop();
      for (let i = 0; i < 400 && w.PanthoriumVoice.state() !== 'idle'; i++) await tick();
      assert.equal(w.PanthoriumVoice.state(), 'idle', 'voice request must finish'); w.PanthoriumVoice.pause();
    }
    await utter('การเรียนรู้คืออะไร');
    assert.equal(streamConversations.length, 1, 'a spoken question must use the low-latency streaming route');
    assert.equal(streamConversations[0].voiceMode, true, 'low-latency voice flag reaches the actual server service');
    assert.equal(streamConversations[0].userId, user.id);
    assert.equal(playback.length, 1, 'a successful spoken question must play its answer');
    assert.equal(synthesized[0].text, answer);
    assert.equal(requests.find(r => r.pathname === '/api/chat/stream')?.body?.voice, true, 'voice streaming is explicit at the API boundary');
    assert.equal(requests.filter(r => r.pathname === '/api/speech').length, 1, 'the completed stream must not be spoken a second time');
    assert(firstSpeechLatencyMs !== null && firstSpeechLatencyMs < 500, `streamed text should start TTS promptly (observed ${firstSpeechLatencyMs}ms)`);
    assert(revoked.includes(playback[0].src), 'release audio blob after playback ends');
    assert(!w.document.querySelector('#sentinel-command-result'), 'never add a result popup over the microphone');

    // A browser that terminates with interim-only text must still get an answer.
    await utter('ช่วยอธิบายการเรียนรู้', false);
    assert.equal(playback.length, 2);
    // While a streamed phrase is playing, synthesize later phrases ahead of
    // time so the next clip does not wait for a fresh provider round trip.
    const ttsCallsBeforePrefetch = requests.filter(r => r.pathname === '/api/speech').length;
    holdPlayback = true;
    w.dispatchEvent(new w.CustomEvent('panthorium:ai-stream-delta', { detail: { text: 'การเรียนรู้เกิดจากการรับข้อมูลและสังเกตอย่างต่อเนื่อง ประโยคสั้นแรกมีข้อมูลครบถ้วน. ประโยคสั้นที่สองยังมีข้อมูลครบถ้วน. เมื่อได้รับประสบการณ์ใหม่ ระบบจะปรับปรุงคำตอบให้เหมาะสมมากยิ่งขึ้น โดยพิจารณาบริบทและความต้องการของผู้ใช้เสมอ' } }));
    for (let i = 0; i < 200 && !(evaluate('aiSpeechActive') && playing); i++) await tick();
    assert.equal(playing, true, 'first prefetched phrase begins playback');
    for (let i = 0; i < 30 && requests.filter(r => r.pathname === '/api/speech').length < ttsCallsBeforePrefetch + 2; i++) await tick();
    assert(requests.filter(r => r.pathname === '/api/speech').length >= ttsCallsBeforePrefetch + 2, 'the following phrase is synthesized before current playback finishes');
    const prefetchedBodies = requests.filter(r => r.pathname === '/api/speech').slice(ttsCallsBeforePrefetch).map(r => r.body.text);
    assert(prefetchedBodies[1].length >= 120, 'short sentences are coalesced into a full-length later mobile TTS chunk');
    const stoppedStream = w.PanthoriumVoiceStream.finish();
    evaluate('stopSentinelSpeech();');
    holdPlayback = false;
    await stoppedStream;
    assert.equal(playing, false, 'stopping also drains prefetched clips without leaving audio active');
    evaluate('speechInterruptedByUser = false;');
    // Speech commands spoken during AI playback stop audio and queued segments,
    // without becoming another chat prompt.
    const conversationsBeforeStop = streamConversations.length;
    const playbackBeforeStop = playback.length;
    holdPlayback = true;
    globalMic.start(); transcript(globalMic, 'ช่วยสรุปเรื่องนี้'); globalMic.stop();
    for (let i = 0; i < 200 && !(evaluate('aiSpeechActive') && playing); i++) await tick();
    assert.equal(evaluate('aiSpeechActive'), true, 'the answer is playing before the interrupt command');
    const interruptionMic = recognizers.at(-1);
    transcript(interruptionMic, 'เซาๆ', true, 0.54);
    await tick();
    assert.equal(evaluate('aiSpeechActive'), true, 'a transcript below 0.55 must not chop the answer');
    transcript(interruptionMic, 'เซาๆ', true, 0.55);
    for (let i = 0; i < 250 && evaluate('aiSpeechActive'); i++) await tick();
    assert.equal(evaluate('aiSpeechActive'), false, 'spoken stop command immediately cancels Sentinel speech');
    assert.equal(playing, false, 'interrupted audio playback is cancelled');
    assert.equal(streamConversations.length, conversationsBeforeStop + 1, 'the stop phrase is not submitted as a new chat prompt');
    assert.equal(playback.length, playbackBeforeStop + 1, 'no later queued speech segment plays after interruption');
    holdPlayback = false;
    await new Promise(resolve => setTimeout(resolve, 80));
    w.PanthoriumVoice.pause();
    // Both microphone entry points use the same routing and real speech code.
    const chatRecognizerIndex = recognizers.length;
    evaluate('openSentinel();');
    const chatMic = recognizers[chatRecognizerIndex];
    await w.document.getElementById('chat-mic').onclick();
    transcript(chatMic, 'การเรียนรู้คืออะไร');
    await chatMic.stop(); // natural end, no second click/silence timer needed
    w.PanthoriumVoice.pause();
    assert.equal(playback.length, 5, 'window microphone must also answer natural-ended speech');
    assert.match(w.document.getElementById('chat-messages').textContent, new RegExp(answer));

    rejectOnce = '/api/chat/stream';
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 6, 'refresh expired chat authentication then answer');
    rejectOnce = '/api/speech';
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 7, 'refresh expired TTS authentication then play');
    assert.equal(requests.filter(r => r.pathname === '/api/auth/refresh').length, 3, 'restore existing session on boot, then refresh expired chat and speech requests');

    failProvider = true;
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 7, 'never speak an API failure as a successful AI answer');
    assert.match(w.document.getElementById('toast').textContent, /no_provider_available/);
    failProvider = false; blockPlayback = true;
    await utter('การเรียนรู้คืออะไร');
    assert.equal(playback.length, 7);
    assert.match(w.document.getElementById('toast').textContent, /เล่นเสียง.*ไม่สำเร็จ/);
    blockPlayback = false; failSpeech = true;
    const failedSpeechAttemptsBefore = speechAttempts;
    await utter('การเรียนรู้คืออะไร');
    assert.match(w.document.getElementById('toast').textContent, /เล่นเสียง.*ไม่สำเร็จ/);
    assert.equal(speechAttempts - failedSpeechAttemptsBefore, 1, 'a failed TTS request must not trigger a chain of duplicate retries');
    failSpeech = false;

    rejectAlways = '/api/chat/stream'; refreshOK = false;
    const before = requests.length;
    await utter('การเรียนรู้คืออะไร');
    assert.match(w.document.getElementById('toast').textContent, /เข้าสู่ระบบ/);
    assert.equal(requests.slice(before).filter(r => r.pathname === '/api/chat/stream').length, 1, 'failed refresh must not retry as another user');
    assert.equal(playback.length, 7);
    rejectAlways = ''; refreshOK = true;
    const longSpeech = 'สวัสดีครับ วันนี้ระบบเสียงกำลังทดสอบการตอบกลับต่อเนื่อง '.repeat(18);
    const playbackBeforeLongSpeech = playback.length;
    fakeTts = true;
    assert.equal(await evaluate(`speak(${JSON.stringify(longSpeech)})`), true, 'a long answer should finish playing through sequential chunks');
    fakeTts = false;
    const longSpeechPlaybackCount = playback.length - playbackBeforeLongSpeech;
    assert(maxTtsInFlight <= 3, 'TTS prefetch is bounded to avoid bursts when answers are long');
    const nativeSpeech = [];
    w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    w.speechSynthesis = {
      getVoices: () => [{ name: 'Microsoft Niwat Online (Natural) - Thai (Thailand)', lang: 'th-TH', localService: true }],
      cancel() {}, resume() {},
      speak(utterance) { nativeSpeech.push(utterance.text); setTimeout(() => { utterance.onstart?.(); setTimeout(() => utterance.onend?.(), 1); }, 0); }
    };
    assert.equal(await evaluate(`speak('Hello Sentinel')`), true, 'English text should be spoken through the system Niwat voice');
    assert.deepEqual(nativeSpeech, [], 'device voices must never replace the configured system voice');
    assert.equal(requests.filter(r => r.pathname === '/api/speech').at(-1)?.body?.lang, 'th-TH', 'English and Thai share one Niwat voice profile');
    delete w.speechSynthesis;
    const playbackBeforeInvalidResponses = playback.length;
    for (const [response, expected] of [
      [() => Response.json({ ok: false }, { status: 403 }), /ไม่มีสิทธิ์/],
      [() => Response.json({ ok: false }, { status: 429 }), /ขีดจำกัด/],
      [() => Response.json({ ok: true, text: '' }), /empty_ai_response/],
      [() => new Response('not json'), /empty_ai_response/],
      [() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, /รอคำตอบ AI เกินเวลา/]
    ]) {
      chatFailure = response; await utter('การเรียนรู้คืออะไร');
      assert.match(w.document.getElementById('toast').textContent, expected);
      assert.equal(playback.length, playbackBeforeInvalidResponses, 'invalid/forbidden responses must not produce speech');
    }
    chatFailure = null;

    // Unsupported commands stay commands: never convert a failure to AI prose.
    const chats = streamConversations.length, audioCount = synthesized.length;
    await utter('เปิดฟังก์ชันที่ไม่มีอยู่');
    assert.equal(streamConversations.length, chats);
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
    assert.equal(playback.length, 9 + longSpeechPlaybackCount);
    assert.equal(playing, false);
    w.PanthoriumVoice.pause();

    // A tap on the global microphone during Sentinel playback is a stop
    // action only. It must not immediately restart listening in hands-free mode.
    const startsBeforeSpeechStop = globalMic.starts;
    evaluate('aiSpeechActive = true;');
    await w.document.getElementById('global-voice').onclick();
    assert.equal(evaluate('aiSpeechActive'), false, 'global mic tap cancels active speech');
    assert.equal(w.PanthoriumVoice.state(), 'idle', 'stopping speech returns the voice control to idle');
    await new Promise(resolve => setTimeout(resolve, 420));
    assert.equal(globalMic.starts, startsBeforeSpeechStop, 'stopping speech does not silently restart the microphone');
    await w.document.getElementById('global-voice').onclick();
    assert.equal(globalMic.starts, startsBeforeSpeechStop + 1, 'a later explicit tap starts listening again');
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
    assert.equal(evaluate(`(() => {
      const detector = createAdaptiveVoiceDetector();
      for (let i = 0; i < 5; i += 1) detector.observe(0.018, i * 80);
      return detector.observe(0.065, 520) || detector.observe(0.065, 620);
    })()`), true, 'adaptive VAD must detect speech above a calibrated noisy-room floor');
    assert.equal(evaluate(`(() => {
      const detector = createAdaptiveVoiceDetector();
      for (let i = 0; i < 8; i += 1) detector.observe(0.004, i * 50);
      return detector.observe(0.015, 500) || detector.observe(0.015, 600);
    })()`), true, 'adaptive VAD must still detect a quiet microphone after calibration');
    const browserTranscript = await evaluate(`transcribeWithBrowserSpeechRecognition(class {
      start() { this.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'ทดสอบเสียงภาษาไทย', confidence: 0.82 } }] }); }
      stop() {}
    }, { timeoutMs: 500 })`);
    assert.equal(browserTranscript, 'ทดสอบเสียงภาษาไทย', 'browser fallback accepts a clear final Thai transcript');
    await assert.rejects(evaluate(`transcribeWithBrowserSpeechRecognition(class {
      start() { this.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'คำถอดเสียงไม่แน่ใจ', confidence: 0.54 } }] }); }
      stop() {}
    }, { timeoutMs: 500 })`), /transcription_uncertain/, 'browser fallback asks again below the 0.55 confidence threshold');
    // Android/iOS should synthesize the complete streamed answer once, avoiding
    // repeated short remote audio elements and audible gaps between chunks.
    const originalUserAgent = w.navigator.userAgent;
    Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/154.0 Mobile Safari/537.36' });
    evaluate('speechInterruptedByUser = false;');
    const mobileTtsCallsBefore = requests.filter(r => r.pathname === '/api/speech').length;
    w.dispatchEvent(new w.CustomEvent('panthorium:ai-stream-delta', { detail: { text: 'คำตอบสั้นสำหรับทดสอบเสียงบนมือถือให้พูดต่อเนื่องเป็นคลิปเดียว' } }));
    await tick();
    assert.equal(requests.filter(r => r.pathname === '/api/speech').length, mobileTtsCallsBefore, 'mobile waits for full response instead of requesting fragmented TTS');
    const mobileFinish = w.PanthoriumVoiceStream.finish();
    for (let i = 0; i < 100 && requests.filter(r => r.pathname === '/api/speech').length < mobileTtsCallsBefore + 1; i++) await tick();
    const mobileSpeechRequests = requests.filter(r => r.pathname === '/api/speech').slice(mobileTtsCallsBefore);
    assert.equal(mobileSpeechRequests.length, 1, 'a short mobile answer uses one continuous TTS request');
    assert.equal(mobileSpeechRequests[0].body.text, 'คำตอบสั้นสำหรับทดสอบเสียงบนมือถือให้พูดต่อเนื่องเป็นคลิปเดียว');
    evaluate('stopSentinelSpeech(); speechInterruptedByUser = false;');
    await mobileFinish;
    Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: originalUserAgent });
    let interrupted = false;
    w.addEventListener('panthorium:voice-end', event => { if (event.detail?.interrupted) interrupted = true; }, { once: true });
    evaluate('aiSpeechActive = true; stopSentinelSpeech();');
    assert.equal(evaluate('aiSpeechActive'), false, 'barge-in must stop the current Sentinel speech state');
    assert.equal(interrupted, true, 'barge-in must emit an interrupted voice-end event');
    console.log('PASS: both mics → real authenticated chat route (voice=true) → TTS route → audio ended; interim input, expired sessions, provider/TTS/playback failures, silent command failure and typed streaming');
  } finally { w.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
