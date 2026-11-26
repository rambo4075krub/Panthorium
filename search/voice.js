(() => {
  'use strict';
  let current = null;
  const error = code => Object.assign(new Error(code), { code });
  const labels = {
    not_allowed:'กรุณาอนุญาตไมโครโฟนให้ Panthorium ในการตั้งค่าของแอปหรือเว็บไซต์',
    no_speech:'ยังไม่ได้ยินคำสั่ง แตะไมค์แล้วพูดอีกครั้ง',
    speech_busy:'กำลังถอดเสียงให้ผู้ใช้อื่น กรุณาลองอีกครั้ง',
    speech_unavailable:'เครื่องนี้ยังเปิดบริการรับเสียงไม่ได้ แตะช่องข้อความแล้วใช้ไมค์บนแป้นพิมพ์ได้',
    audio_device:'เปิดไมโครโฟนไม่ได้ ตรวจว่าแอปมีสิทธิ์ใช้ไมค์และลองอีกครั้ง'
  };
  function wav(chunks, rate) {
    const samples = new Float32Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) { samples.set(chunk, at); at += chunk.length; }
    const length = Math.min(192000, Math.floor(samples.length * 16000 / rate));
    const bytes = new ArrayBuffer(44 + 2 * length), view = new DataView(bytes);
    const tag = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      const from = Math.floor(i * rate / 16000), to = Math.max(from + 1, Math.floor((i + 1) * rate / 16000));
      let sum = 0; for (let j = from; j < to; j++) sum += samples[j];
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sum / (to - from))) * 32767, true);
    }
    return bytes;
  }
  async function capture(turn, notify) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !navigator.mediaDevices?.getUserMedia) throw error('speech_unavailable');
    const { signal } = turn.controller;
    const context = new Audio();
    let stream, processor, source, muted;
    try {
      await context.resume();
      signal.throwIfAborted();
      stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true}});
      signal.throwIfAborted();
      processor = context.createScriptProcessor(2048, 1, 1);
      source = context.createMediaStreamSource(stream); muted = context.createGain(); muted.gain.value = 0;
      source.connect(processor); processor.connect(muted); muted.connect(context.destination);
      notify('กำลังฟัง พูดแล้วเว้นจังหวะเพื่อส่ง', 'listening');
      return await new Promise((resolve, reject) => {
        const chunks = [];
        let samples = 0, voiced = 0, quiet = 0, done = false;
        const finish = () => {
          if (done) return; done = true;
          clearTimeout(timer); signal.removeEventListener('abort', abort); turn.submit = null;
          if (signal.aborted) reject(error('cancelled'));
          else if (voiced < context.sampleRate * 0.09) reject(error('no_speech'));
          else resolve(wav(chunks, context.sampleRate));
        };
        const abort = () => finish();
        const timer = setTimeout(finish, 12500);
        signal.addEventListener('abort', abort, {once:true}); turn.submit = finish;
        processor.onaudioprocess = event => {
          if (done) return;
          const data = new Float32Array(event.inputBuffer.getChannelData(0)); chunks.push(data); samples += data.length;
          let energy = 0; for (const sample of data) energy += sample * sample;
          if (Math.sqrt(energy / data.length) > 0.009) { voiced += data.length; quiet = 0; } else quiet += data.length;
          if (samples >= context.sampleRate * 12 || (voiced >= context.sampleRate * .14 && quiet >= context.sampleRate * 1.05)) finish();
        };
      });
    } finally {
      if (processor) processor.onaudioprocess = null;
      source?.disconnect(); processor?.disconnect(); muted?.disconnect();
      stream?.getTracks().forEach(track => track.stop()); await context.close().catch(() => {});
    }
  }
  function platform(turn, Recognition, lang, notify) {
    return new Promise((resolve, reject) => {
      const rec = new Recognition(), signal = turn.controller.signal;
      let done = false;
      const finish = (text, code) => {
        if (done) return; done = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort); turn.submit = null;
        rec.onresult = rec.onerror = rec.onend = null;
        try { rec.abort(); } catch {}
        text ? resolve(text) : reject(error(code));
      };
      const abort = () => finish('', 'cancelled');
      const timer = setTimeout(() => finish('', 'no_speech'), 15000);
      signal.addEventListener('abort', abort, {once:true}); turn.submit = () => rec.stop();
      rec.lang = lang; rec.interimResults = false; rec.continuous = false;
      rec.onresult = e => finish(e.results[e.resultIndex]?.[0]?.transcript?.trim(), 'no_speech');
      rec.onerror = e => finish('', e.error === 'not-allowed' ? 'not_allowed' : e.error === 'no-speech' ? 'no_speech' : 'speech_unavailable');
      rec.onend = () => finish('', 'no_speech');
      try { rec.start(); notify('กำลังฟัง พูดแล้วเว้นจังหวะเพื่อส่ง', 'listening'); }
      catch { finish('', 'speech_unavailable'); }
    });
  }
  async function listen({ commands = false, requireIdentity = false, localOnly = false, lang = 'th-TH', notify = () => {} } = {}) {
    if (current) throw error('speech_busy');
    const turn = { controller:new AbortController(), submit:null }; current = turn;
    const signal = turn.controller.signal;
    try {
      notify('กำลังเปิดไมโครโฟน', 'processing');
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const mayUsePlatform = Recognition && !localOnly && !requireIdentity;
      const embedded = /; wv\)|\bElectron\//i.test(navigator.userAgent);
      let triedPlatform = false;
      if (mayUsePlatform && !embedded) {
        triedPlatform = true;
        try { return { text:await platform(turn, Recognition, lang, notify), commands }; }
        catch (e) { if (e.code !== 'speech_unavailable') throw e; }
      }
      const capability = await fetch('/api/voice-input', {cache:'no-store', signal:AbortSignal.any([signal, AbortSignal.timeout(5000)])})
        .then(r => r.ok ? r.json() : null).catch(() => null);
      signal.throwIfAborted();
      if (!capability?.available) {
        if (mayUsePlatform && !triedPlatform) return { text:await platform(turn, Recognition, lang, notify), commands };
        throw error('speech_unavailable');
      }
      const audio = await capture(turn, notify);
      signal.throwIfAborted();
      notify('กำลังถอดเสียง', 'processing');
      const token = commands && window.PanthoriumAuth?.getAccessToken?.();
      const route = token ? 'commands' : 'search';
      const response = await fetch('/api/voice-input/' + route + '?lang=' + (lang === 'en-US' ? 'en' : 'th'), {
        method:'POST', signal:AbortSignal.any([signal, AbortSignal.timeout(42000)]), cache:'no-store',
        headers:{ 'Content-Type':'audio/wav', ...(token ? {Authorization:'Bearer ' + token} : {}) }, body:audio
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.text) throw error(response.status === 429 ? 'speech_busy' : data.error || 'speech_unavailable');
      return { text:data.text, commands:data.commands === true };
    } catch (reason) {
      if (signal.aborted) throw error('cancelled');
      if (['NotAllowedError','SecurityError'].includes(reason.name)) throw error('not_allowed');
      if (['NotFoundError','NotReadableError'].includes(reason.name)) throw error('audio_device');
      throw reason;
    } finally { if (current === turn) current = null; }
  }
  const stop = () => { current?.controller.abort(); };
  window.PanthoriumSpeechInput = { listen, stop, active:() => !!current,
    submit:() => current?.submit ? current.submit() : stop(), describe:e => labels[e?.code] || labels.speech_unavailable };
  window.addEventListener('pagehide', stop);
})();
