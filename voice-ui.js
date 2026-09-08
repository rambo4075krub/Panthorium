(function () {
  'use strict';

  const VERSION = 'phase14.4-voice-command-runtime-v1';
  const THAI_LOCALE = 'th-TH';
  const FALLBACK_LOCALES = [THAI_LOCALE, 'th', 'en-US'];
  const ROOT_ID = 'panthorium-voice-command-panel';
  const BUTTON_ID = 'panthorium-voice-command-button';

  if (typeof window === 'undefined' || window.__panthoriumVoiceCommandInstalled) return;
  window.__panthoriumVoiceCommandInstalled = true;

  const state = {
    enabled: localStorage.getItem('pt_voice_enabled') !== '0',
    handsFree: localStorage.getItem('pt_voice_hands_free') === '1',
    locale: localStorage.getItem('pt_voice_locale') || THAI_LOCALE,
    activeLocaleIndex: 0,
    listening: false,
    processing: false,
    speaking: false,
    panelOpen: false,
    recognition: null,
    voices: [],
    lastTranscript: '',
    lastAnswer: '',
    lastError: '',
    restartTimer: 0,
    unlocked: false
  };

  const profiles = {
    sentinel: { id: 'sentinel', label: 'Sentinel', lang: THAI_LOCALE, rate: 0.96, pitch: 0.94, volume: 1 },
    'sentinel-core': { id: 'sentinel-core', label: 'Sentinel Core', lang: THAI_LOCALE, rate: 0.9, pitch: 0.72, volume: 1 }
  };

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function short(value, max = 240) { const text = clean(value); return text.length > max ? text.slice(0, max - 1) + '…' : text; }
  function safeHtml(value) { return String(value || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function adminContext() { return /^\/admin(?:\/|\.html)?$/i.test(location.pathname || '') || document.body?.dataset?.panthoriumAccess === 'admin'; }
  function activeProfileId() { return adminContext() ? 'sentinel-core' : 'sentinel'; }
  function getProfile(id = activeProfileId()) { return profiles[id] || profiles.sentinel; }
  function RecognitionCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function emit(type, detail = {}) { try { window.dispatchEvent(new CustomEvent(`panthorium:voice-${type}`, { detail: { version: VERSION, ...detail } })); } catch (_) {} }
  function emitCommand(type, detail = {}) { try { window.dispatchEvent(new CustomEvent(`panthorium:voice-command-${type}`, { detail: { version: VERSION, ...detail } })); } catch (_) {} }
  function toast(message) { if (typeof window.toast === 'function') window.toast(message); else console.log('[Voice]', message); }

  function loadVoices() {
    if (!window.speechSynthesis) return [];
    state.voices = window.speechSynthesis.getVoices() || [];
    render();
    return state.voices;
  }

  function pickThaiVoice() {
    const voices = state.voices.length ? state.voices : loadVoices();
    const preferred = localStorage.getItem('pt_voice_uri') || '';
    if (preferred) {
      const found = voices.find((voice) => voice.voiceURI === preferred);
      if (found) return found;
    }
    return voices.find((voice) => /^th(?:-|$)/i.test(voice.lang || '')) || voices.find((voice) => /thai|ไทย/i.test(voice.name || '')) || voices[0] || null;
  }

  function setStatus(message, type = 'ready') {
    const el = $('voice-command-status');
    if (el) el.textContent = message;
    const btn = $(BUTTON_ID);
    if (btn) {
      btn.dataset.state = type;
      btn.title = message;
    }
  }

  function ensureStyle() {
    if ($('panthorium-voice-command-style')) return;
    const style = document.createElement('style');
    style.id = 'panthorium-voice-command-style';
    style.textContent = `
#${BUTTON_ID}{width:36px;height:28px;border:1px solid rgba(0,255,204,.34);border-radius:12px;background:rgba(0,255,204,.08);color:#cffff7;display:inline-grid;place-items:center;cursor:pointer;box-shadow:0 0 14px rgba(0,255,204,.1);transition:transform .18s ease,background .18s ease,border-color .18s ease;}
#${BUTTON_ID}:hover{background:rgba(0,255,204,.16);transform:translateY(-1px);}#${BUTTON_ID}[data-state="listening"]{background:rgba(0,255,204,.24);border-color:rgba(0,255,204,.82);box-shadow:0 0 18px rgba(0,255,204,.36);}#${BUTTON_ID}[data-state="processing"]{background:rgba(50,120,255,.25);border-color:rgba(80,160,255,.8);}#${BUTTON_ID}[data-state="speaking"]{background:rgba(168,85,247,.26);border-color:rgba(210,170,255,.78);}#${BUTTON_ID}[data-state="error"]{background:rgba(255,80,80,.18);border-color:rgba(255,120,120,.7);}
#${ROOT_ID}{position:fixed;right:18px;bottom:58px;z-index:9997;width:min(390px,calc(100vw - 32px));background:rgba(3,10,18,.86);border:1px solid rgba(0,255,204,.24);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.45),0 0 32px rgba(0,255,204,.08);backdrop-filter:blur(16px);color:#eaffff;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;display:none;}
#${ROOT_ID}.open{display:block;}#${ROOT_ID} .vc-head{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid rgba(0,255,204,.12);}#${ROOT_ID} .vc-title{font-weight:700;font-size:14px;}#${ROOT_ID} .vc-sub{font-size:11px;color:rgba(220,255,255,.62);margin-top:2px;}#${ROOT_ID} .vc-body{padding:14px;display:grid;gap:12px;}#${ROOT_ID} .vc-status{font-size:13px;line-height:1.45;color:#cffff7;min-height:38px;padding:10px;border-radius:14px;background:rgba(0,255,204,.06);border:1px solid rgba(0,255,204,.12);}#${ROOT_ID} .vc-row{display:flex;gap:8px;flex-wrap:wrap;}#${ROOT_ID} button,#${ROOT_ID} select{border:1px solid rgba(0,255,204,.2);border-radius:11px;background:rgba(0,255,204,.09);color:#eaffff;padding:8px 10px;font:inherit;font-size:12px;}#${ROOT_ID} button{cursor:pointer;}#${ROOT_ID} button.primary{background:rgba(0,255,204,.18);color:#bafff3;}#${ROOT_ID} button.danger{background:rgba(255,80,80,.12);border-color:rgba(255,100,100,.28);color:#ffd6d6;}#${ROOT_ID} label{display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(230,255,255,.78);}#${ROOT_ID} input[type="checkbox"]{accent-color:#00ffcc;}#${ROOT_ID} .vc-small{font-size:11px;color:rgba(230,255,255,.58);line-height:1.45;}#${ROOT_ID} .vc-transcript{font-family:Consolas,'Courier New',monospace;font-size:12px;color:#dff;max-height:86px;overflow:auto;background:rgba(255,255,255,.03);border-radius:12px;padding:9px;white-space:pre-wrap;}
@media(max-width:640px){#${ROOT_ID}{right:10px;bottom:54px;width:calc(100vw - 20px);}#${BUTTON_ID}{width:34px;height:28px;}}
`;
    document.head.appendChild(style);
  }

  function ensureButton() {
    if ($(BUTTON_ID)) return $(BUTTON_ID);
    const taskbarRight = document.querySelector('#taskbar .tb-right') || document.getElementById('taskbar');
    if (!taskbarRight) return null;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '🎙️';
    button.setAttribute('aria-label', 'Thai voice commands');
    button.onclick = () => {
      unlock();
      togglePanel();
      if (!state.listening && state.enabled) startListening({ userGesture: true });
    };
    taskbarRight.insertBefore(button, taskbarRight.firstChild);
    return button;
  }

  function ensurePanel() {
    if ($(ROOT_ID)) return $(ROOT_ID);
    const panel = document.createElement('section');
    panel.id = ROOT_ID;
    panel.setAttribute('aria-label', 'Thai Voice Command Runtime');
    panel.innerHTML = `
      <div class="vc-head">
        <div><div class="vc-title">🎙️ Thai Voice Commands</div><div class="vc-sub">พูดสั่ง Sentinel ได้โดยไม่ต้องเปิดแชท</div></div>
        <button id="voice-command-close" type="button">ปิด</button>
      </div>
      <div class="vc-body">
        <div class="vc-status" id="voice-command-status">พร้อมรับคำสั่งเสียงภาษาไทย</div>
        <div class="vc-row">
          <button class="primary" id="voice-command-start" type="button">เริ่มฟัง</button>
          <button id="voice-command-stop" type="button">หยุดฟัง</button>
          <button class="danger" id="voice-command-stop-speech" type="button">หยุดพูด</button>
        </div>
        <div class="vc-row">
          <label><input id="voice-command-enabled" type="checkbox"> เปิดเสียงตอบกลับ</label>
          <label><input id="voice-command-hands-free" type="checkbox"> ฟังต่อเนื่องหลังปลดล็อกไมค์</label>
        </div>
        <div class="vc-row">
          <select id="voice-command-locale" title="ภาษาที่ใช้ฟัง"></select>
          <select id="voice-command-voice" title="เสียงที่ใช้ตอบ"></select>
        </div>
        <div class="vc-transcript" id="voice-command-transcript">คำสั่งล่าสุด: -\nคำตอบล่าสุด: -</div>
        <div class="vc-small">คำสั่งระบบ: “หยุดพูด”, “หยุดฟัง”, “เปิดแชท”, “เปิด Governance”, “เปิด Dual AI”, “เปิด Training Lab” นอกนั้นส่งให้ Sentinel Core ประมวลผลทันที</div>
      </div>`;
    document.body.appendChild(panel);
    $('voice-command-close').onclick = () => togglePanel(false);
    $('voice-command-start').onclick = () => { unlock(); startListening({ userGesture: true }); };
    $('voice-command-stop').onclick = stopListening;
    $('voice-command-stop-speech').onclick = stopSpeaking;
    $('voice-command-enabled').onchange = (event) => setEnabled(event.target.checked);
    $('voice-command-hands-free').onchange = (event) => setHandsFree(event.target.checked);
    $('voice-command-locale').onchange = (event) => setLocale(event.target.value);
    $('voice-command-voice').onchange = (event) => { localStorage.setItem('pt_voice_uri', event.target.value || ''); render(); };
    render();
    return panel;
  }

  function render() {
    const enabled = $('voice-command-enabled'); if (enabled) enabled.checked = state.enabled;
    const hands = $('voice-command-hands-free'); if (hands) hands.checked = state.handsFree;
    const locale = $('voice-command-locale');
    if (locale && !locale.options.length) {
      FALLBACK_LOCALES.forEach((lang) => locale.add(new Option(lang === THAI_LOCALE ? 'ไทย th-TH' : lang, lang)));
    }
    if (locale) locale.value = state.locale;
    const voiceSelect = $('voice-command-voice');
    if (voiceSelect) {
      const chosen = localStorage.getItem('pt_voice_uri') || '';
      const voices = state.voices.length ? state.voices : [];
      voiceSelect.innerHTML = '';
      voiceSelect.add(new Option('Auto Thai voice', ''));
      voices.forEach((voice) => voiceSelect.add(new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI)));
      voiceSelect.value = chosen;
    }
    const transcript = $('voice-command-transcript');
    if (transcript) transcript.textContent = `คำสั่งล่าสุด: ${state.lastTranscript || '-'}\nคำตอบล่าสุด: ${state.lastAnswer || '-'}${state.lastError ? '\nสถานะ: ' + state.lastError : ''}`;
  }

  function togglePanel(force) {
    ensurePanel();
    state.panelOpen = typeof force === 'boolean' ? force : !state.panelOpen;
    $(ROOT_ID)?.classList.toggle('open', state.panelOpen);
  }

  function unlock() {
    state.unlocked = true;
    loadVoices();
    setStatus('ปลดล็อกเสียงแล้ว · พูดคำสั่งได้เลย', 'ready');
  }

  function setEnabled(value) {
    state.enabled = !!value;
    localStorage.setItem('pt_voice_enabled', state.enabled ? '1' : '0');
    render();
    setStatus(state.enabled ? 'เปิดเสียงตอบกลับแล้ว' : 'ปิดเสียงตอบกลับแล้ว', 'ready');
  }

  function setHandsFree(value) {
    state.handsFree = !!value;
    localStorage.setItem('pt_voice_hands_free', state.handsFree ? '1' : '0');
    render();
    if (state.handsFree && !state.listening && !state.speaking && !state.processing) startListening({ userGesture: true });
    else if (!state.handsFree) stopListening();
  }

  function setLocale(locale) {
    state.locale = FALLBACK_LOCALES.includes(locale) ? locale : THAI_LOCALE;
    state.activeLocaleIndex = FALLBACK_LOCALES.indexOf(state.locale);
    localStorage.setItem('pt_voice_locale', state.locale);
    render();
    setStatus(`ตั้งค่าภาษาฟังเป็น ${state.locale}`, 'ready');
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.speaking = false;
    emit('end', { interrupted: true });
    setStatus('หยุดพูดแล้ว', 'ready');
    if (state.handsFree && !state.listening) scheduleRestart(500);
  }

  function speak(text, profileId = activeProfileId(), options = {}) {
    const message = short(text, 900);
    if (!message) return Promise.resolve(false);
    if (!state.enabled || !window.speechSynthesis) {
      state.lastAnswer = message;
      render();
      emit('end', { text: message, skipped: true });
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      try {
        stopListening({ silent: true });
        window.speechSynthesis.cancel();
        const profile = getProfile(profileId);
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = profile.lang || state.locale || THAI_LOCALE;
        utterance.rate = Number(options.rate || profile.rate || 0.95);
        utterance.pitch = Number(options.pitch || profile.pitch || 0.9);
        utterance.volume = Number(options.volume || profile.volume || 1);
        const voice = pickThaiVoice();
        if (voice) utterance.voice = voice;
        state.speaking = true;
        state.lastAnswer = message;
        render();
        setStatus(`${profile.label} กำลังตอบกลับด้วยเสียง`, 'speaking');
        emit('start', { text: message, profile: profile.id, locale: utterance.lang, voice: voice?.name || null });
        utterance.onboundary = (event) => emit('boundary', { charIndex: event.charIndex || 0, name: event.name || '', profile: profile.id });
        utterance.onend = () => {
          state.speaking = false;
          emit('end', { text: message, profile: profile.id });
          setStatus('ตอบด้วยเสียงเสร็จแล้ว', 'ready');
          render();
          if (state.handsFree) scheduleRestart(550);
          resolve(true);
        };
        utterance.onerror = (event) => {
          state.speaking = false;
          state.lastError = `TTS error: ${event.error || 'unknown'}`;
          emit('error', { error: event.error || 'tts_error', profile: profile.id });
          setStatus('เสียงตอบกลับมีปัญหา · แสดงคำตอบบนจอแทน', 'error');
          render();
          if (state.handsFree) scheduleRestart(700);
          resolve(false);
        };
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        state.speaking = false;
        state.lastError = error.message;
        emit('error', { error: error.message });
        setStatus('ไม่สามารถพูดออกเสียงได้', 'error');
        render();
        resolve(false);
      }
    });
  }

  function createRecognition() {
    const Ctor = RecognitionCtor();
    if (!Ctor) return null;
    const recognition = new Ctor();
    recognition.lang = state.locale || THAI_LOCALE;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      state.listening = true;
      state.lastError = '';
      setStatus(`กำลังฟังคำสั่งเสียง (${recognition.lang})`, 'listening');
      emit('user-start', { locale: recognition.lang, profile: activeProfileId(), withoutChat: true });
      emitCommand('start', { locale: recognition.lang, withoutChat: true });
      render();
    };
    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const part = event.results[index]?.[0]?.transcript || '';
        if (event.results[index].isFinal) finalText += part;
        else interim += part;
      }
      if (interim) setStatus(`ได้ยิน: ${short(interim, 80)}`, 'listening');
      if (finalText) handleTranscript(finalText);
    };
    recognition.onerror = (event) => {
      state.listening = false;
      const err = event.error || 'recognition_error';
      state.lastError = err;
      emit('user-error', { error: err, locale: recognition.lang });
      emitCommand('error', { error: err, locale: recognition.lang });
      if (err === 'language-not-supported' || err === 'bad-grammar') {
        const next = nextLocale();
        if (next) {
          setStatus(`ภาษา ${recognition.lang} ไม่รองรับ · ลอง ${next}`, 'error');
          scheduleRestart(600);
          return;
        }
      }
      const message = err === 'not-allowed' || err === 'service-not-allowed'
        ? 'ไมโครโฟนยังไม่ได้รับอนุญาตจาก browser'
        : err === 'no-speech'
          ? 'ยังไม่ได้ยินเสียง · กดพูดอีกครั้ง'
          : `รู้จำเสียงไม่สำเร็จ: ${err}`;
      setStatus(message, 'error');
      render();
    };
    recognition.onend = () => {
      state.listening = false;
      emit('user-end', { locale: recognition.lang, withoutChat: true });
      render();
      if (state.handsFree && !state.processing && !state.speaking) scheduleRestart(450);
    };
    return recognition;
  }

  function nextLocale() {
    const start = Math.max(0, FALLBACK_LOCALES.indexOf(state.locale));
    const nextIndex = start + 1;
    if (nextIndex >= FALLBACK_LOCALES.length) return '';
    state.locale = FALLBACK_LOCALES[nextIndex];
    state.activeLocaleIndex = nextIndex;
    localStorage.setItem('pt_voice_locale', state.locale);
    render();
    return state.locale;
  }

  function startListening(options = {}) {
    clearTimeout(state.restartTimer);
    if (state.speaking || state.processing) return false;
    const Ctor = RecognitionCtor();
    if (!Ctor) {
      state.lastError = 'SpeechRecognition unavailable';
      setStatus('Browser นี้ยังไม่รองรับ SpeechRecognition · ใช้ Chrome/Edge รุ่นล่าสุด', 'error');
      emitCommand('unsupported', { reason: 'SpeechRecognition unavailable' });
      render();
      return false;
    }
    try {
      stopListening({ silent: true });
      state.recognition = createRecognition();
      if (!state.recognition) return false;
      state.recognition.start();
      return true;
    } catch (error) {
      state.lastError = error.message;
      setStatus(`เริ่มฟังไม่ได้: ${error.message}`, 'error');
      emitCommand('error', { error: error.message, at: 'startListening' });
      render();
      if (options.userGesture) toast('ยังเปิดไมค์ไม่ได้ กรุณาตรวจสิทธิ์ไมโครโฟนของ browser');
      return false;
    }
  }

  function stopListening(options = {}) {
    clearTimeout(state.restartTimer);
    const recognition = state.recognition;
    state.recognition = null;
    state.listening = false;
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      try { recognition.abort?.(); } catch (_) {}
    }
    if (!options.silent) {
      setStatus('หยุดฟังคำสั่งเสียงแล้ว', 'ready');
      emitCommand('stop', { withoutChat: true });
      render();
    }
  }

  function scheduleRestart(delay) {
    clearTimeout(state.restartTimer);
    if (!state.handsFree) return;
    state.restartTimer = setTimeout(() => {
      if (state.handsFree && !state.listening && !state.processing && !state.speaking) startListening();
    }, delay || 500);
  }

  function appCommand(transcript) {
    const text = clean(transcript).toLowerCase();
    const openers = [
      { patterns: ['เปิดแชท', 'open chat', 'sentinel chat'], run: () => window.openSentinel?.(), reply: 'เปิด Sentinel Chat แล้ว' },
      { patterns: ['เปิด governance', 'เปิดโกเวอร์แนนซ์', 'governance'], run: () => window.PanthoriumGovernance?.open?.(), reply: 'เปิด Governance แล้ว' },
      { patterns: ['เปิด dual ai', 'dual ai', 'ดูอัลเอไอ'], run: () => window.PanthoriumDualAI?.open?.(), reply: 'เปิด Dual AI แล้ว' },
      { patterns: ['เปิด training lab', 'training lab', 'เทรนนิ่ง'], run: () => window.PanthoriumTraining?.open?.(), reply: 'เปิด Training Lab แล้ว' },
      { patterns: ['เปิด production intelligence', 'production intelligence'], run: () => window.PanthoriumProductionIntelligence?.open?.(), reply: 'เปิด Production Intelligence แล้ว' }
    ];
    for (const item of openers) {
      if (!item.patterns.some((pattern) => text.includes(pattern))) continue;
      try { item.run(); } catch (_) {}
      return item.reply;
    }
    if (['หยุดพูด', 'เงียบ', 'stop speaking', 'mute'].some((pattern) => text.includes(pattern))) {
      stopSpeaking();
      return 'หยุดพูดแล้ว';
    }
    if (['หยุดฟัง', 'ปิดไมค์', 'stop listening'].some((pattern) => text.includes(pattern))) {
      state.handsFree = false;
      localStorage.setItem('pt_voice_hands_free', '0');
      stopListening();
      return 'ปิดการฟังต่อเนื่องแล้ว';
    }
    return '';
  }

  async function askSentinel(transcript) {
    const prompt = clean(transcript);
    if (!prompt) return { ok: false, text: 'ไม่ได้ยินคำสั่งชัดเจน กรุณาพูดใหม่อีกครั้ง', provider: 'voice-runtime' };
    if (window.PanthoriumAIStream?.call) return window.PanthoriumAIStream.call(prompt);
    if (typeof window.callAI === 'function') return window.callAI(prompt);
    throw new Error('ai_runtime_unavailable');
  }

  async function handleTranscript(transcript) {
    const text = short(transcript, 260);
    if (!text || state.processing) return;
    state.lastTranscript = text;
    state.lastAnswer = '';
    state.lastError = '';
    state.processing = true;
    stopListening({ silent: true });
    setStatus(`กำลังประมวลผลคำสั่ง: ${text}`, 'processing');
    emit('user-result', { text, locale: state.locale, withoutChat: true, profile: activeProfileId() });
    emitCommand('result', { text, locale: state.locale, withoutChat: true, profile: activeProfileId() });
    render();
    try {
      const direct = appCommand(text);
      if (direct) {
        state.processing = false;
        state.lastAnswer = direct;
        emitCommand('done', { text, answer: direct, direct: true, withoutChat: true });
        render();
        await speak(direct, activeProfileId());
        return;
      }
      emitCommand('processing', { text, withoutChat: true });
      const result = await askSentinel(text);
      const answer = result?.text || 'Sentinel Core ยังไม่ส่งคำตอบกลับมา';
      state.processing = false;
      state.lastAnswer = short(answer, 320);
      emitCommand('done', { text, answer, provider: result?.provider || null, via: result?.via || null, withoutChat: true });
      render();
      await speak(answer, activeProfileId());
    } catch (error) {
      state.processing = false;
      state.lastError = error.message;
      const fallback = error.message === 'authentication_required'
        ? 'ยังไม่ได้เข้าสู่ระบบหรือ session หมดอายุ กรุณาเข้าสู่ระบบใหม่'
        : error.message === 'ai_runtime_unavailable'
          ? 'ระบบ AI ยังไม่พร้อมรับคำสั่งเสียง กรุณารอสักครู่แล้วลองใหม่'
          : 'ประมวลผลคำสั่งเสียงไม่สำเร็จ';
      emitCommand('error', { error: error.message, text, withoutChat: true });
      setStatus(fallback, 'error');
      render();
      await speak(fallback, activeProfileId());
    } finally {
      state.processing = false;
      if (state.handsFree && !state.speaking) scheduleRestart(650);
    }
  }

  function install() {
    ensureStyle();
    ensureButton();
    ensurePanel();
    loadVoices();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    const supported = !!RecognitionCtor();
    setStatus(supported ? 'พร้อมรับคำสั่งเสียงภาษาไทยโดยไม่ต้องเปิดแชท' : 'Browser นี้ยังไม่รองรับ SpeechRecognition', supported ? 'ready' : 'error');
    emitCommand('ready', { supported, locale: state.locale, handsFree: state.handsFree, profile: activeProfileId(), withoutChat: true });
  }

  window.PanthoriumVoiceCommands = {
    version: VERSION,
    install,
    open: () => togglePanel(true),
    close: () => togglePanel(false),
    toggle: () => togglePanel(),
    start: startListening,
    stop: stopListening,
    ask: handleTranscript,
    speak,
    stopSpeaking,
    setEnabled,
    setHandsFree,
    setLocale,
    status: () => ({ ...state, recognition: !!state.recognition, supported: !!RecognitionCtor(), profile: activeProfileId(), voices: state.voices.map((v) => ({ name: v.name, lang: v.lang })) })
  };
  window.PanthoriumVoice = window.PanthoriumVoiceCommands;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
  window.addEventListener('panthorium:auth-changed', () => setTimeout(() => { render(); emitCommand('profile', { profile: activeProfileId(), withoutChat: true }); }, 80));
})();
