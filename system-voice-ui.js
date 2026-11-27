(() => {
  'use strict';
  const user = () => { try { return OS.state.user; } catch { return null; } };
  const owner = () => { const who = user(); return JSON.stringify([who?.sub || who?.id, who?.roles, who?.permissions]); };
  const catalog = () => window.PanthoriumWindowCatalog;
  const norm = value => catalog()?.normalize(value) || '';
  const clean = value => String(value || '').normalize('NFC').trim()
    .replace(/^(?:(?:sentinel|เซนทิเนล|เซนติเนล)[\s,]+)?(?:ช่วย|กรุณา|please\s+)?\s*/iu, '')
    .replace(/(?:ให้หน่อย|หน่อยนะ|หน่อย|นะครับ|นะคะ|ครับ|ค่ะ|คะ|please)?[.?!。]*$/iu, '').trim();
  const searchNames = new Set(['ค้นหา','คนหา','ค้นเว็บ','ค้นเว็บไซต์','เสิร์ช','เสิร์ซ','เสิร์จ','เซิร์ช','เซิร์จ','เซิร์ซ','เสิร์ชเอนจิน','search','websearch','panthoriumsearch','แพนโทเรียมเสิร์ช','แพนธอเรียมเซิร์ช','เบราว์เซอร์','บราวเซอร์','บราวเซอร์ภายใน','เบราว์เซอร์ภายใน','เว็บเบราว์เซอร์','panthoriumbrowser','browser']);
  function searchIntent(text) {
    const spoken = clean(text);
    const name = norm(spoken).replace(/^(เปิด|เรียก|เข้า|ไปที่|open|launch|show)/u, '').replace(/^(หน้าต่าง|หน้า|ระบบ|แอป)/u, '');
    if (searchNames.has(name)) return {query:''};
    const query = window.PanthoriumSpeechInput?.webSearchTerms?.(spoken);
    if (query) return {query};
    if (/^(?:(?:ขอ|หา|เปิด)\s*(?:เว็บไซต์|เว็ปไซต์|เว็ป|เว็บ)|(?:เว็บไซต์|เว็บ)\s*(?:อย่างเป็นทางการ|ทางการ|ของ)|(?:find|open|show)\s+(?:the\s+)?official\s+(?:website|site)\s+(?:of|for)\s+)\s*\S/iu.test(spoken)
        && !catalog()?.parse(spoken)) return {query:spoken.slice(0,2048)};
    const ordinary = /^ค้นหา\s*(.+)$/u.exec(spoken);
    if (ordinary && !/^(?:ไฟล์|บันทึก|โน้ต|อีเมล|แชท|แชต|ข้อความ|รายชื่อ|ความรู้|ในระบบ|ในแอป|ในเครื่อง)/u.test(ordinary[1].trim())) return {query:ordinary[1].trim().slice(0,300)};
    return null;
  }
  function launchers() {
    const menu = document.getElementById('sm-apps');
    if (!menu) return [];
    return Array.from(menu.querySelectorAll('button.sm-app[data-app-id]')).flatMap(button => {
      const id = button.dataset.appId, known = catalog()?.apps.find(app => app.id === id);
      if (known && !catalog().allowed(known,user())) return [];
      const parent = button.parentElement;
      if (parent !== menu && !(parent?.hasAttribute('data-start-group-items') && parent.closest('[data-start-group]')?.parentElement === menu)) return [];
      if (!known && (!user() || user().roles?.includes('guest')) && !['account-register','account-login','contact','privacy-policy','billing'].includes(id)) return [];
      if (id === 'account-logout' || button.disabled || button.matches('[aria-disabled="true"],[data-voice-launcher="false"]')) return [];
      for (let el = button; el && el !== menu; el = el.parentElement) {
        if (el.hasAttribute('data-start-group-items')) continue;
        if (el.hidden || getComputedStyle(el).display === 'none' || el.matches('[inert],[aria-hidden="true"]')) return [];
      }
      const label = button.dataset.baseLabel || button.querySelector('span:not(.ico)')?.textContent || button.getAttribute('aria-label') || button.textContent;
      if (!label?.trim()) return [];
      const aliases = [id, label, ...(button.dataset.voiceAliases || '').split('|')].filter(Boolean).map(norm);
      return [{ id, label, button, aliases }];
    });
  }
  function resolveLocal(text) {
    if (window.PanthoriumCloudApps?.voiceContext?.()) return null;
    const command = window.PanthoriumSpeechInput?.resultCommand?.(clean(text));
    if (command && window.PanthoriumBrowser?.searchVoiceContext?.() != null) return {kind:'search-result',command};
    if (window.PanthoriumSpeechInput?.acceptsSpelling?.(clean(text))) return {kind:'search-spelling'};
    const search = searchIntent(text);
    if (search) return {kind:'search', ...search};
    const target = /^(?:เปิด|เรียก|เข้า|launch\s+|open\s+)\s*(?:แอป|แอพ|ระบบ|หน้าต่าง)?\s*(.+)$/iu.exec(clean(text));
    if (!target || catalog()?.parse(clean(text))) return null;
    const matches = launchers().filter(item => item.aliases.includes(norm(target[1])));
    if (matches.length) return {kind:'launcher', matches};
    return null;
  }
  function dispatch(intent, expectedSuggestion, expectedSearchContext) {
    if (intent.kind === 'search-result') return window.PanthoriumBrowser.runSearchCommand(intent.command,expectedSearchContext);
    if (intent.kind === 'search-spelling') {
      const query = window.PanthoriumBrowser?.applySearchSuggestion?.(expectedSuggestion);
      return {ok:!!query, text:query ? 'ค้นเว็บ “' + query + '”' : 'ยังไม่มีคำแนะนำในหน้าค้นหาที่เปิดอยู่'};
    }
    if (intent.kind === 'search') {
      const ok = window.PanthoriumBrowser?.openSearch(intent.query) === true;
      return {ok, text:ok ? (intent.query ? 'ค้นเว็บ “' + intent.query + '”' : 'เปิด Panthorium Search แล้ว') : 'เบราว์เซอร์ยังไม่พร้อม'};
    }
    if (intent.matches.length !== 1) return {ok:false,text:'พบหลายแอปชื่อนี้ กรุณาเลือกจากเมนูเริ่มต้น'};
    const item = intent.matches[0];
    if (!launchers().some(current => current.button === item.button)) return {ok:false,text:'รายการแอปเปลี่ยนแล้ว กรุณาสั่งใหม่'};
    item.button.click();
    return {ok:true, text:'เรียก ' + item.label + ' แล้ว'};
  }
  let listening = false, generation = 0;
  const stop = () => { generation++; if (listening) window.PanthoriumSpeechInput?.stop(); listening = false; };
  async function listen(notify) {
    if (listening) { window.PanthoriumSpeechInput?.submit(); return; }
    const id = ++generation, account = owner(), current = () => id === generation && account === owner();
    const report = (text, mode) => {
      if (!current()) return;
      notify(text, mode); window.PanthoriumOrb?.setTranscript?.(text, 0);
    };
    listening = true;
    try {
      const suggestion = window.PanthoriumBrowser?.searchSuggestion?.() || '';
      const searchContext = window.PanthoriumBrowser?.searchVoiceContext?.() ?? null;
      const speech = await window.PanthoriumSpeechInput.listen({ commands:true, hasSuggestion:!!suggestion,
        requireIdentity:document.body.dataset.voiceIdentityRequired === 'true', localOnly:document.body.dataset.aiMode === 'local-only', notify:report });
      if (!current() || window.PanthoriumCloudApps?.voiceContext?.()) return;
      const text = speech.text, commands = window.PanthoriumVoiceCommands;
      const local = commands?.hasPending?.() ? null : resolveLocal(text);
      let result;
      if (local?.kind === 'search' || local?.kind === 'search-spelling' || local?.kind === 'search-result') result = dispatch(local, suggestion, searchContext);
      else if (!speech.commands) result = {ok:false,text:'บัญชีนี้ใช้เสียงค้นเว็บได้ กรุณายืนยันตัวตนเพื่อสั่งงานส่วนอื่น'};
      else if (local) result = dispatch(local);
      else if (catalog()?.parse(text) || catalog()?.parseFunction(text) || window.PanthoriumScreenVoiceCatalog?.parse(text) ||
               window.PanthoriumCreativeVoiceCatalog?.parse(text) || commands?.hasPending?.()) result = await commands.executeSystem(text);
      else result = {ok:false,text:'ลองพูด “เปิดหน้าค้นหา” “เปิดปฏิทิน” หรือ “คำสั่งเสียงทั้งหมด”'};
      report(result.text, result.ok ? 'idle' : 'error');
    } catch (e) {
      if (e.code !== 'cancelled') report(window.PanthoriumSpeechInput.describe(e), 'error');
    } finally {
      if (current()) listening = false;
    }
  }
  window.PanthoriumSystemVoice = { searchIntent, resolveLocal, dispatch, launchers, listen, stop, active:() => listening };
  let lastOwner = owner();
  window.addEventListener('panthorium:auth-changed', () => { const next = owner(); if (next !== lastOwner) stop(); lastOwner = next; });
  window.addEventListener('panthorium:cloud-app-context', stop);
  window.addEventListener('pagehide', stop);
  function menuStatus(label, mode) {
    const mic = document.getElementById('desktop-voice');
    if (!mic) return;
    mic.title = label; mic.setAttribute('aria-label', label);
    mic.setAttribute('aria-pressed', String(mode === 'listening' || mode === 'processing'));
    mic.classList.toggle('listening', mode === 'listening'); mic.classList.toggle('processing', mode === 'processing');
    window.dispatchEvent(new CustomEvent('panthorium:live-state', {detail:{label,mode}}));
  }
  document.getElementById('start-command-mic')?.addEventListener('click', () => {
    window.PanthoriumStartMenuUI?.close?.();
    if (window.PanthoriumSocialRTC?.isActive?.() || window.PanthoriumCloudApps?.voiceContext?.()) {
      window.PanthoriumOrb?.setTranscript?.('โปรดจบสายหรือออกจากบริบทงานก่อนใช้คำสั่งระบบ', 0); return;
    }
    if (!listening && window.PanthoriumLiveVoice?.isBusy?.()) window.PanthoriumLiveVoice.stop();
    listen(menuStatus);
  });
  // Older shell profiles also use the same visible microphone for system commands.
  if (document.body.dataset.aiMode !== 'local-only' && document.body.dataset.geminiLiveEnabled !== 'true') {
    const mic = document.getElementById('desktop-voice');
    mic?.addEventListener('click', () => listen(menuStatus));
  }
})();
