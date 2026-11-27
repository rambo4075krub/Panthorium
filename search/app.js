(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const input = byId('query'), form = byId('search-form'), dialog = byId('comparison');
  const list = byId('result-list'), status = byId('search-status');
  const host = window.frameElement?.closest('#panthorium-browser-dashboard');
  const storeKey = 'panthorium.search.comparison.v1' + (host ? '.' + host.dataset.browserOwner : '');
  const voiceLanguage = byId('voice-language');
  const languageKey = 'panthorium.search.voiceLanguage' + (host ? '.' + host.dataset.browserOwner : '');
  const scopes = document.querySelectorAll('[data-scope]');
  let query = '', scope = 'all', selected = [], web = [], phase = 'idle', errorCode = '', pending;
  let recording, speaking, comparison = [], reading, suggested = '', visibleCount = 12, problem = '';
  let nextPage = null, moreRequest, moreNotice = '', readerText = '', broaderQuery = '';
  const more = byId('more-results'), reader = byId('reader');
  const readerListen = byId('reader-listen'), readerStatus = byId('reader-voice-status');
  const canSpeak = () => Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  function element(tag, text, css) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (css) node.className = css;
    return node;
  }
  function validItem(item) {
    if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return false;
    try {
      const url = new URL(item.url);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch { return false; }
  }
  function link(label, href, css) {
    const anchor = element('a', label, css);
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  }
  async function read(href, aloud = false) {
    if (!validItem({title:'',url:href})) return;
    reading?.abort();
    stopSpeaking();
    readerText = ''; readerListen.hidden = true; readerStatus.textContent = '';
    const request = new AbortController(); reading = request;
    byId('reader-title').textContent = 'อ่านหน้าเว็บ';
    byId('reader-host').textContent = new URL(href).hostname;
    byId('reader-source').href = href;
    byId('reader-content').textContent = 'กำลังอ่านจากเว็บไซต์ต้นทาง…';
    if (!reader.open) reader.showModal();
    try {
      const response = await fetch('/api/search/read', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:href}), signal:request.signal});
      const page = await response.json();
      if (reading !== request || !reader.open) return;
      byId('reader-title').textContent = page.title || 'อ่านหน้าเว็บ';
      readerText = response.ok && typeof page.content === 'string' ? page.content.trim() : '';
      byId('reader-content').textContent = readerText || page.message || 'อ่านเว็บไซต์นี้ไม่ได้ในขณะนี้';
      readerListen.hidden = !readerText || !canSpeak();
      if (aloud && readerText && !speak(readerText,readerListen)) readerStatus.textContent = 'เบราว์เซอร์นี้ยังอ่านออกเสียงไม่ได้';
    } catch {
      if (reading === request && !request.signal.aborted) byId('reader-content').textContent = 'ยังอ่านหน้าเว็บไม่ได้ กรุณาลองอีกครั้ง';
    } finally { if (reading === request) reading = null; }
  }
  function currentSuggestion() {
    return !byId('spelling').hidden && input.value.trim() === query && !document.querySelector('dialog[open]') ? suggested : '';
  }
  function applySuggestion(expected) {
    const next = currentSuggestion();
    if (!next || (expected !== undefined && expected !== next)) return '';
    navigate(next, scope);
    return next;
  }
  function openWebsite(href) {
    if (!host || !window.parent.PanthoriumBrowser?.openResult(window,href)) read(href);
  }
  function voiceContext() {
    if (reader.open) return JSON.stringify(['reader',byId('reader-source').href]);
    if (dialog.open) return null;
    return JSON.stringify([query,scope,input.value,broaderQuery,scope === 'all' && phase === 'loading',visibleItems().slice(0,visibleCount).map(item => item.url)]);
  }
  function runVoiceCommand(command, expected) {
    const context = voiceContext();
    const reply = (ok,text) => ({ok,text});
    if (!context || (expected !== undefined && expected !== context)) return reply(false,'หน้าที่เปิดอยู่เปลี่ยนแล้ว กรุณาสั่งอีกครั้ง');
    if (command.action === 'stop') { stopSpeaking(); return reply(true,'หยุดอ่านแล้ว'); }
    if (reader.open) {
      if (command.action === 'back') { reader.close(); return reply(true,'กลับไปผลค้นหาแล้ว'); }
      if (command.action === 'listen-page') {
        if (!readerText) return reply(false,reading ? 'กำลังโหลดข้อความจากเว็บไซต์' : 'ไม่มีข้อความจากหน้านี้ให้อ่าน');
        return speak(readerText,readerListen) ? reply(true,'กำลังอ่านหน้าเว็บให้ฟัง') : reply(false,'เบราว์เซอร์นี้ยังอ่านออกเสียงไม่ได้');
      }
      return reply(false,'พูด “กลับไปผลค้นหา” เพื่อเลือกเว็บไซต์อื่น');
    }
    if (input.value.trim() !== query || (scope === 'all' && phase === 'loading')) return reply(false,'รอให้ผลของคำค้นปัจจุบันพร้อมก่อน');
    if (command.action === 'back') return reply(true,'อยู่ที่หน้าผลค้นหาแล้ว');
    if (command.action === 'all-sources') {
      if (broaderQuery) navigate(broaderQuery,'all');
      else if (scope === 'selected') navigate(query,'all');
      else return reply(true,'กำลังใช้ผลจากทุกเว็บไซต์อยู่แล้ว');
      return reply(true,'ค้นจากทุกเว็บไซต์');
    }
    if (command.action === 'more') {
      if (more.hidden || more.disabled) return reply(false,more.disabled ? 'กำลังโหลดผลเพิ่มเติม' : 'ไม่มีผลเพิ่มเติมสำหรับคำค้นนี้');
      more.click(); return reply(true,'แสดงผลเพิ่มเติม');
    }
    if (command.action === 'listen-results') {
      if (!visibleItems().length) return reply(false,'ยังไม่มีผลค้นหาให้อ่าน');
      return speakResults() ? reply(true,'กำลังอ่านผลค้นหา') : reply(false,'เบราว์เซอร์นี้ยังอ่านออกเสียงไม่ได้');
    }
    if (command.action !== 'open' && command.action !== 'read') return reply(false,'เลือกผลที่ต้องการก่อน เช่น “อ่านผลที่หนึ่งให้ฟัง”');
    const links = list.querySelectorAll('.item-title');
    const target = links[command.index-1];
    if (!target) return reply(false,links.length ? 'ตอนนี้มีผลที่แสดง 1 ถึง ' + links.length : 'ยังไม่มีผลค้นหาให้เปิด');
    target.focus({preventScroll:true});
    if (command.action === 'read') read(target.href,true);
    else openWebsite(target.href);
    return reply(true,'เปิดผลที่ ' + command.index + ' ' + target.textContent);
  }
  window.PanthoriumSearchPage = {read, currentSuggestion, applySuggestion, voiceContext, runVoiceCommand};
  byId('close-reader').onclick = () => reader.close();
  reader.addEventListener('close', () => {
    if (reader.open) return;
    reading?.abort(); reading = null; readerText = '';
    stopRecognition(); stopSpeaking();
  });
  document.addEventListener('click', event => {
    const result = event.target.closest?.('a.item-title');
    if (!result || window.parent === window || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openWebsite(result.href);
  });
  function sourceLine(item) {
    const label = item.kind === 'official' && item.recordUrl ? 'เว็บไซต์ทางการตามข้อมูลจาก ' + item.source : item.source;
    const node = element('p', item.kind === 'selected' ? 'เว็บต้นทางที่คัดไว้โดย Panthorium' : label, 'source');
    if (item.retrievedAt && Number.isFinite(Date.parse(item.retrievedAt))) {
      const time = element('time', new Date(item.retrievedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }));
      time.dateTime = item.retrievedAt; node.append(' · ดึงข้อมูลเมื่อ ', time);
    }
    if (item.license === 'https://creativecommons.org/licenses/by-sa/4.0/') node.append(link('CC BY-SA 4.0', item.license));
    if (/^https:\/\/(?:www\.wikidata\.org\/wiki\/Q\d+|(?:th|en)\.wikipedia\.org\/\?curid=\d+|en\.wikivoyage\.org\/\?curid=\d+#(?:Buy|See|Eat|Drink|Sleep))$/.test(item.recordUrl || '')) node.append(link('ดูรายการต้นทาง', item.recordUrl));
    return node;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(storeKey) || '[]');
    if (Array.isArray(saved)) comparison = saved.filter(validItem).slice(0, 3);
  } catch { /* Comparison remains usable in memory when storage is unavailable. */ }
  try {
    if (sessionStorage.getItem(languageKey) === 'en-US') voiceLanguage.value = 'en-US';
  } catch { /* The visible language selection still works without storage. */ }
  voiceLanguage.onchange = () => {
    try { sessionStorage.setItem(languageKey, voiceLanguage.value); } catch {}
  };
  function saveComparison() {
    try {
      if (comparison.length) sessionStorage.setItem(storeKey, JSON.stringify(comparison));
      else sessionStorage.removeItem(storeKey);
    } catch { /* In-memory selection remains available. */ }
    updatePicks();
    if (dialog.open) renderComparison();
  }
  function updatePicks() {
    byId('count').textContent = String(comparison.length);
    for (const button of list.querySelectorAll('[data-pick]')) {
      const picked = comparison.some(item => item.url === button.dataset.pick);
      button.setAttribute('aria-pressed', String(picked));
      button.textContent = picked ? '✓ เลือกแล้ว' : '+ เลือกเทียบ';
      button.disabled = !picked && comparison.length >= 3;
      button.title = button.disabled ? 'นำเว็บหนึ่งออกก่อนเลือกเว็บใหม่' : '';
    }
  }
  function visibleItems() {
    const items = new Map();
    for (const item of (scope === 'all' ? [...web, ...selected] : selected)) if (!items.has(item.url)) items.set(item.url, item);
    return [...items.values()];
  }
  function renderComparison() {
    const cards = comparison.map(item => {
      const card = element('article', '', 'compare-card');
      card.append(element('p', new URL(item.url).hostname, 'host'), link(item.title, item.url, 'item-title'));
      const fields = element('dl', '', 'compare-field');
      for (const [name, value] of [['ประเภท', item.category], ['พื้นที่', item.place], ['รายละเอียด', item.excerpt]]) {
        if (value) fields.append(element('dt', name), element('dd', value));
      }
      const remove = element('button', 'นำออก', 'text-action');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'นำ ' + item.title + ' ออก');
      remove.onclick = () => {
        comparison = comparison.filter(other => other.url !== item.url);
        byId('copy-status').textContent = '';
        saveComparison();
        (byId('comparison-list').querySelector('button') || byId('close-compare')).focus();
      };
      card.append(fields, sourceLine(item), remove);
      return card;
    });
    byId('comparison-list').replaceChildren(...(cards.length ? cards : [element('p', 'กด “เลือกเทียบ” ใต้ผลค้นหา เพื่อดูเว็บไซต์ที่สนใจคู่กัน')]));
    byId('copy').hidden = !cards.length || !navigator.clipboard?.writeText;
    byId('clear').hidden = !cards.length;
  }
  byId('open-compare').onclick = () => {
    byId('copy-status').textContent = '';
    renderComparison();
    dialog.showModal();
  };
  byId('close-compare').onclick = () => dialog.close();
  byId('clear').onclick = () => { comparison = []; byId('copy-status').textContent = ''; saveComparison(); byId('close-compare').focus(); };
  byId('copy').onclick = async () => {
    const brief = comparison.map(item => [item.title, item.place, item.excerpt, item.source, item.url, item.license].filter(Boolean).join('\n')).join('\n\n');
    try { await navigator.clipboard.writeText(brief); byId('copy-status').textContent = 'คัดลอกรายการแล้ว'; }
    catch { byId('copy-status').textContent = 'เบราว์เซอร์ยังไม่อนุญาตให้คัดลอก'; }
  };
  function render() {
    const items = visibleItems();
    const focusUrl = document.activeElement?.dataset.pick;
    const rows = items.slice(0, visibleCount).map((item,index) => {
      const row = element('li', '', 'result-item'), content = element('div');
      const heading = element('h3');
      heading.append(link(item.title, item.url, 'item-title'));
      const domain = element('p', '', 'host'), position = element('span',String(index+1) + '.','result-position');
      position.setAttribute('aria-hidden','true'); domain.append(position,new URL(item.url).hostname);
      content.append(domain,heading);
      if (item.excerpt) content.append(element('p', item.excerpt, 'excerpt'));
      content.append(sourceLine(item));
      const pick = element('button', '', 'pick');
      pick.type = 'button'; pick.dataset.pick = item.url;
      pick.onclick = () => {
        if (comparison.some(other => other.url === item.url)) comparison = comparison.filter(other => other.url !== item.url);
        else if (comparison.length < 3) comparison.push(item);
        saveComparison();
      };
      row.append(content, pick);
      return row;
    });
    list.replaceChildren(...rows);
    const allWeb = byId('all-web');
    allWeb.hidden = !broaderQuery || scope !== 'all';
    if (!allWeb.hidden) {
      allWeb.textContent = 'ค้น “' + broaderQuery + '” จากทุกเว็บไซต์';
      allWeb.href = searchHash(broaderQuery,'all');
    } else allWeb.removeAttribute('href');
    byId('result-voice-hint').hidden = !rows.length;
    more.hidden = items.length <= visibleCount && !(scope === 'all' && nextPage);
    more.disabled = Boolean(moreRequest);
    more.setAttribute('aria-busy', String(Boolean(moreRequest)));
    updatePicks();
    if (focusUrl) Array.from(list.querySelectorAll('[data-pick]')).find(button => button.dataset.pick === focusUrl)?.focus({ preventScroll: true });
    for (const button of scopes) button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
    byId('listen').hidden = !items.length || !canSpeak();
    byId('retry').hidden = scope !== 'all' || !['partial', 'unavailable'].includes(phase);
    const count = items.length ? items.length + ' ผลลัพธ์' : '';
    if (scope === 'selected') status.textContent = count || 'ยังไม่มีเว็บคัดสรรตรงคำนี้ ลองเลือก “ทุกแหล่ง” เพื่อค้นเว็บภายนอก';
    else if (phase === 'loading') status.textContent = [count, 'กำลังค้นแหล่งภายนอก…'].filter(Boolean).join(' · ');
    else if (phase === 'partial') status.textContent = [count || 'ยังไม่พบเว็บที่ตรง', 'บางแหล่งยังไม่ตอบกลับ'].filter(Boolean).join(' · ');
    else if (phase === 'unavailable') status.textContent = [count, errorCode === 'web_rate_limited' ? 'แหล่งค้นหาถึงขีดจำกัดชั่วคราว' : 'ยังติดต่อแหล่งค้นหาภายนอกไม่ได้'].filter(Boolean).join(' · ');
    else if (phase === 'invalid') status.textContent = problem;
    else if (web.length === 1 && web[0].kind === 'address') status.textContent = 'ที่อยู่เว็บไซต์ที่คุณระบุ';
    else if (!items.length && broaderQuery) status.textContent = 'ยังไม่พบเว็บไซต์ที่ตรงกับชื่อ “' + broaderQuery + '” ลองแก้ชื่อหรือค้นจากทุกเว็บไซต์';
    else status.textContent = count || 'ยังไม่พบเว็บที่ตรง ลองเปลี่ยนคำค้นหรือวาง URL ของเว็บไซต์';
    if (scope === 'all' && moreNotice) status.textContent += ' · ' + moreNotice;
  }
  async function fetchPage(controller, page = 1) {
    const response = await fetch('/api/search', {
      method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(page === 1 ? {query} : {query,page}), signal:controller.signal
    });
    return response.json();
  }
  function stopMore() {
    moreRequest?.abort();
    moreRequest = null; moreNotice = '';
  }
  async function loadWeb() {
    stopMore();
    const controller = new AbortController();
    pending?.abort();
    pending = controller; nextPage = null; phase = 'loading'; render();
    try {
      const data = await fetchPage(controller);
      if (pending !== controller) return;
      if (!['ok', 'partial', 'empty', 'unavailable', 'invalid'].includes(data.status)) throw Error('invalid_response');
      nextPage = data.nextPage === 2 ? 2 : null;
      web = (data.results || []).filter(validItem);
      broaderQuery = typeof data.broaderQuery === 'string' ? data.broaderQuery : '';
      selected = (data.selected || []).filter(validItem);
      phase = data.status; errorCode = data.error || ''; problem = data.message || 'กรุณาตรวจคำค้นหรือที่อยู่เว็บไซต์';
      updateSpelling();
    } catch {
      if (pending !== controller) return;
      phase = 'unavailable';
    }
    if (pending === controller) { pending = null; render(); }
  }
  function stopSpeaking() {
    if (speaking) { speaking = null; window.speechSynthesis?.cancel(); }
    byId('listen').textContent = 'ฟังผลค้นหา';
    readerListen.textContent = 'ฟังหน้านี้';
  }
  function speak(text,button) {
    stopSpeaking();
    if (!text || !canSpeak()) return false;
    const lang = /[ก-๙]/u.test(text) ? 'th-TH' : 'en-US';
    const words = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(lang,{granularity:'word'}).segment(text),p => p.segment) : text.split(/(\s+)/u);
    const parts = [''];
    for (const word of words) {
      for (const piece of word.match(/[\s\S]{1,160}/gu) || []) {
        if (parts.at(-1).length + piece.length > 160) parts.push('');
        parts[parts.length-1] += piece;
      }
    }
    const turn = {utterance:null};
    speaking = turn; button.textContent = 'หยุดอ่าน';
    function next() {
      if (speaking !== turn) return;
      const part = parts.shift();
      if (part === undefined) { stopSpeaking(); return; }
      const utterance = new SpeechSynthesisUtterance(part); turn.utterance = utterance;
      utterance.lang = lang; utterance.onend = next;
      utterance.onerror = () => {
        if (speaking !== turn) return;
        stopSpeaking();
        (reader.open ? readerStatus : byId('voice-status')).textContent = 'เครื่องนี้ยังอ่านออกเสียงไม่ได้';
      };
      window.speechSynthesis.speak(utterance);
    }
    next(); return true;
  }
  function speakResults() {
    const words = visibleItems().slice(0,3).map((item,index) =>
      ['ผลที่ ' + (index+1),item.title,item.excerpt,'ที่มา ' + item.source].filter(Boolean).join(' '));
    return speak(words.join('. '),byId('listen'));
  }
  byId('listen').onclick = () => speaking ? stopSpeaking() : speakResults();
  readerListen.onclick = () => speaking ? stopSpeaking() : speak(readerText,readerListen);
  function stopRecognition() {
    if (recording) window.PanthoriumSpeechInput?.stop();
    recording = null; voiceLanguage.disabled = false;
    byId('mic').setAttribute('aria-pressed', 'false'); byId('voice-status').textContent = '';
    byId('reader-mic').setAttribute('aria-pressed','false'); readerStatus.textContent = '';
  }
  function searchHash(value, nextScope) {
    const params = new URLSearchParams({ q:value });
    if (nextScope === 'selected') params.set('scope', 'selected');
    return '#' + params.toString();
  }
  function updateSpelling() {
    const name = scope === 'all' && !web.length && broaderQuery && query.includes(broaderQuery)
      ? PanthoriumSearchDirectory.suggestOrganization(broaderQuery) : '';
    suggested = name ? query.replace(broaderQuery,name) : query && !selected.length ? PanthoriumSearchDirectory.suggest(query) : '';
    byId('spelling').hidden = !suggested || input.value.trim() !== query;
    const link = byId('spelling-query');
    link.textContent = suggested;
    if (suggested) link.href = searchHash(suggested,scope);
    else link.removeAttribute('href');
  }
  function syncLocation() {
    const params = new URLSearchParams(location.hash.slice(1));
    const next = (params.get('q') || '').trim().slice(0, 2048);
    scope = params.get('scope') === 'selected' ? 'selected' : 'all';
    if (scope === 'selected') stopMore();
    stopSpeaking(); stopRecognition();
    if (query !== next) {
      if (reader.open) reader.close();
      pending?.abort(); pending = null; stopMore(); nextPage = null; web = []; broaderQuery = ''; phase = 'idle'; errorCode = ''; visibleCount = 12;
      query = next; selected = query ? PanthoriumSearchDirectory.match(query) : [];
    }
    input.value = query; document.title = query ? query + ' · Panthorium Search' : 'Panthorium Search';
    updateSpelling();
    document.body.classList.toggle('has-query', Boolean(query));
    byId('discovery').hidden = Boolean(query); byId('results').hidden = !query;
    if (query && scope === 'all' && phase === 'idle') loadWeb();
    else render();
  }
  function navigate(value, nextScope) {
    const q = value.trim();
    if (!q) { input.focus(); return; }
    const hash = searchHash(q, nextScope);
    if (location.hash !== hash) location.hash = hash;
    else syncLocation();
  }
  form.onsubmit = event => {
    event.preventDefault();
    const value = input.value.trim();
    navigate(value, /^(?:https?:\/\/|[^\s/]+\.[^\s/]+(?:\/|$))/iu.test(value) ? 'all' : scope);
  };
  for (const button of scopes) button.onclick = () => navigate(query, button.dataset.scope);
  byId('retry').onclick = loadWeb;
  more.onclick = async () => {
    const items = visibleItems();
    const displayed = new Set(items.slice(0,visibleCount).map(item => item.url));
    if (items.length > visibleCount) visibleCount += 12;
    else if (scope === 'all' && nextPage && !moreRequest) {
      const page = nextPage, controller = new AbortController();
      moreRequest = controller; moreNotice = 'กำลังค้นผลเพิ่มเติม…'; render();
      try {
        const data = await fetchPage(controller,page);
        if (moreRequest !== controller) return;
        if (!['ok','partial','empty'].includes(data.status)) throw Error('page_unavailable');
        const known = new Set(web.map(item => item.url));
        for (const item of (data.results || []).filter(validItem)) {
          if (!known.has(item.url)) { known.add(item.url); web.push(item); }
        }
        nextPage = data.nextPage === page + 1 ? data.nextPage : null;
        visibleCount = items.length + 12;
        const added = visibleItems().length - items.length;
        moreNotice = added ? '' : 'หน้านี้ไม่มีเว็บที่ตรงเพิ่มเติม';
      } catch {
        if (moreRequest !== controller) return;
        moreNotice = 'โหลดผลเพิ่มเติมไม่ได้ กดแสดงผลเพิ่มเติมเพื่อลองอีกครั้ง';
      } finally {
        if (moreRequest === controller) { moreRequest = null; render(); }
      }
    }
    render();
    Array.from(list.querySelectorAll('.item-title')).find(node => !displayed.has(node.href))?.focus();
  };
  async function listenCommand(mic,info) {
    const voice = window.PanthoriumSpeechInput;
    if (recording) { voice.submit(); return; }
    stopSpeaking();
    const turn = {suggestion:currentSuggestion(),context:voiceContext()}; recording = turn; voiceLanguage.disabled = true; mic.setAttribute('aria-pressed', 'true');
    try {
      const speech = await voice.listen({
        lang:voiceLanguage.value, hasSuggestion:!!turn.suggestion,
        searchView:reader.open ? 'reader' : visibleItems().length ? 'results' : '',
        localOnly:window.parent !== window && window.parent.document.body.dataset.aiMode === 'local-only',
        notify:label => { if (recording === turn) info.textContent = label; }
      });
      if (recording !== turn || !speech.text) return;
      const command = voice.resultCommand(speech.text);
      if (command) {
        const result = runVoiceCommand(command,turn.context);
        (reader.open ? readerStatus : byId('voice-status')).textContent = result.text;
      } else if (voice.acceptsSpelling(speech.text)) {
        if (!applySuggestion(turn.suggestion)) info.textContent = 'ยังไม่มีคำแนะนำสำหรับผลค้นหานี้';
      } else {
        if (reader.open) reader.close();
        navigate(voice.webSearchTerms(speech.text) || speech.text.slice(0,300),scope);
      }
    } catch (error) {
      if (recording === turn && error.code !== 'cancelled') { info.textContent = voice.describe(error); (reader.open ? mic : input).focus(); }
    } finally {
      if (recording === turn) { recording = null; voiceLanguage.disabled = false; mic.setAttribute('aria-pressed', 'false'); }
    }
  }
  byId('mic').onclick = () => listenCommand(byId('mic'),byId('voice-status'));
  byId('reader-mic').onclick = () => listenCommand(byId('reader-mic'),readerStatus);
  input.addEventListener('input', () => {
    if (recording) stopRecognition();
    byId('spelling').hidden = !suggested || input.value.trim() !== query;
  });
  window.addEventListener('hashchange', syncLocation);
  window.addEventListener('pagehide', () => { stopRecognition(); stopSpeaking(); stopMore(); });
  const initialQuery = new URLSearchParams(location.search).get('q');
  if (initialQuery && !location.hash) history.replaceState(null, '', location.pathname + '#' + new URLSearchParams({ q: initialQuery.slice(0, 2048) }));
  syncLocation();
})();
