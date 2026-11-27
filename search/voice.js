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
  function webSearchTerms(text) {
    const spoken = text.trim();
    const prefix = /^(?:(?:ค้น(?:หา)?|คน|คล้น)(?:ใน|บน)?(?:เว็บไซต์|เว็บ|อินเทอร์เน็ต)(?:เรื่อง|ว่า|คำว่า|ให้)?|(?:เสิร์ช|เซิร์ช|เสิร์จ|เซิร์จ)\s*(?:หา|เว็บ)?|(?:search(?: the web)? for|web search)\b)/iu.exec(spoken);
    return prefix ? spoken.slice(prefix[0].length).trim().slice(0, 300) : '';
  }
  const acceptsSpelling = text => /^(?:ใช้คำ(?:ค้น)?ที่แนะนำ|ค้นด้วยคำที่แนะนำ|use (?:the )?suggested (?:query|spelling))(?:\s*(?:ครับ|ค่ะ))?[.!?]*$/iu.test(text.trim());
  const ordinals = [
    ['แรก','หนึ่ง','first','one'], ['สอง','second','two'], ['สาม','third','three'], ['สี่','fourth','four'],
    ['ห้า','fifth','five'], ['หก','sixth','six'], ['เจ็ด','seventh','seven'], ['แปด','eighth','eight'],
    ['เก้า','ninth','nine'], ['สิบ','tenth','ten'], ['สิบเอ็ด','eleventh','eleven'], ['สิบสอง','twelfth','twelve'],
    ['สิบสาม','thirteenth','thirteen'], ['สิบสี่','fourteenth','fourteen'], ['สิบห้า','fifteenth','fifteen'],
    ['สิบหก','sixteenth','sixteen'], ['สิบเจ็ด','seventeenth','seventeen'], ['สิบแปด','eighteenth','eighteen'], ['สิบเก้า','nineteenth','nineteen']
  ];
  function resultNumber(value) {
    const digits = /^(\d+)(?:st|nd|rd|th)?$/u.exec(value);
    if (digits) return Number(digits[1]);
    const named = ordinals.findIndex(names => names.includes(value)) + 1;
    if (named) return named;
    const thai = /^(ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)สิบ(เอ็ด|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?$/u.exec(value);
    if (thai) {
      const tens = thai[1] === 'ยี่' ? 2 : ordinals.findIndex(names => names.includes(thai[1])) + 1;
      const unit = thai[2] === 'เอ็ด' ? 1 : ordinals.findIndex(names => names.includes(thai[2])) + 1;
      return tens * 10 + unit;
    }
    const [tens,unit] = value.split(/[- ]/u);
    const tensNames = ['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
    const decade = tensNames.indexOf(tens.replace(/ieth$/u,'y'));
    const unitNumber = unit ? ordinals.slice(0,9).findIndex(names => names.includes(unit)) + 1 : 0;
    return decade < 0 || (unit && !unitNumber) ? 0 : (decade + 2) * 10 + unitNumber;
  }
  function resultCommand(text) {
    const spoken = text.normalize('NFC').toLowerCase().trim().replace(/^(?:ช่วย|กรุณา|please\s+)\s*/u,'')
      .replace(/(?:ให้หน่อย|หน่อย|นะครับ|นะคะ|ครับ|ค่ะ|please)?[.!?。]*$/u,'').trim()
      .replace(/[๐-๙]/gu, digit => String(digit.charCodeAt(0) - 0xe50));
    const thai = spoken.replace(/\s+/gu,'');
    if (/^(?:กลับ(?:ไป)?(?:หน้า)?ผล(?:การ)?ค้นหา|กลับ(?:ไป)?(?:หน้า)?ผลลัพธ์)$/u.test(thai) || /^(?:go )?back to (?:the )?(?:search )?results$/u.test(spoken)) return {action:'back'};
    if (/^(?:แสดง|ดู|โหลด)ผล(?:การค้นหา|ค้นหา|ลัพธ์)?(?:เพิ่มเติม|เพิ่ม|ถัดไป)$/u.test(thai) || /^(?:show|load)(?: me)? more (?:search )?results$/u.test(spoken)) return {action:'more'};
    if (/^(?:ค้น(?:หา)?|ดูผล)(?:จาก)?ทุกเว็บไซต์$/u.test(thai) || spoken === 'search all websites') return {action:'all-sources'};
    if (/^(?:ฟัง|อ่าน)ผล(?:การ)?ค้นหา(?:ให้ฟัง)?$/u.test(thai) || /^read (?:the )?(?:search )?results(?: aloud)?$/u.test(spoken)) return {action:'listen-results'};
    if (/^(?:ฟัง|อ่าน)(?:หน้าเว็บนี้|หน้านี้|บทความนี้)(?:ให้ฟัง)?$/u.test(thai) || /^read (?:this|the) (?:page|article)(?: aloud)?$/u.test(spoken)) return {action:'listen-page'};
    if (thai === 'หยุดอ่าน' || spoken === 'stop reading') return {action:'stop'};
    const english = spoken.replace(/\bsearch result\b/u,'result').replace(/ aloud$/u,'');
    const match = /^(เปิด|อ่าน)(?:ผล(?:การค้นหา|ค้นหา|ลัพธ์(?:การค้นหา)?)?|ลิงก์)(?:หมายเลข|อันดับ(?:ที่)?|ลำดับ(?:ที่)?|ที่)?([ก-๙]+|\d+)$/u.exec(thai.replace(/ให้ฟัง$/u,'')) ||
      /^(open|read) (?:the )?result (?:number )?([a-z0-9]+(?:[ -][a-z]+)?)$/u.exec(english) ||
      /^(open|read) (?:the )?([a-z0-9]+(?:[ -][a-z]+)?) result$/u.exec(english);
    if (!match) return null;
    const index = resultNumber(match[2]);
    if (!index || !Number.isSafeInteger(index)) return null;
    return {action:['อ่าน','read'].includes(match[1]) ? 'read' : 'open', index};
  }
  async function listen({ commands = false, requireIdentity = false, localOnly = false, hasSuggestion = false, lang = 'th-TH', notify = () => {} } = {}) {
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
      const params = new URLSearchParams({lang:lang === 'en-US' ? 'en' : 'th'});
      if (commands && !token) params.set('purpose', 'command');
      if (hasSuggestion) params.set('spelling', '1');
      const response = await fetch('/api/voice-input/' + route + '?' + params, {
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
  window.PanthoriumSpeechInput = { listen, stop, webSearchTerms, acceptsSpelling, resultCommand, active:() => !!current,
    submit:() => current?.submit ? current.submit() : stop(), describe:e => labels[e?.code] || labels.speech_unavailable };
  window.addEventListener('pagehide', stop);
})();
