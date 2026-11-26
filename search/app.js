(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const input = byId('query'), form = byId('search-form'), dialog = byId('comparison');
  const list = byId('result-list'), status = byId('search-status');
  const storeKey = 'panthorium.search.comparison.v1';
  const scopes = document.querySelectorAll('[data-scope]');
  let query = '', scope = 'all', selected = [], web = [], phase = 'idle', errorCode = '', pending;
  let recognition, speaking, comparison = [];
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
  function sourceLine(item) {
    const node = element('p', item.kind === 'selected' ? 'เว็บต้นทางที่คัดไว้โดย Panthorium' : item.source, 'source');
    if (item.retrievedAt && Number.isFinite(Date.parse(item.retrievedAt))) {
      const time = element('time', new Date(item.retrievedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }));
      time.dateTime = item.retrievedAt; node.append(' · ดึงข้อมูลเมื่อ ', time);
    }
    if (item.license === 'https://creativecommons.org/licenses/by-sa/4.0/') node.append(link('CC BY-SA 4.0', item.license));
    if (/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/.test(item.recordUrl || '')) node.append(link('ดูรายการต้นทาง', item.recordUrl));
    return node;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(storeKey) || '[]');
    if (Array.isArray(saved)) comparison = saved.filter(validItem).slice(0, 3);
  } catch { /* Comparison remains usable in memory when storage is unavailable. */ }
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
    const items = new Map(selected.map(item => [item.url, item]));
    if (scope === 'all') for (const item of web) if (!items.has(item.url)) items.set(item.url, item);
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
    const rows = items.map(item => {
      const row = element('article', '', 'result-item'), content = element('div');
      const heading = element('h3');
      heading.append(link(item.title, item.url, 'item-title'));
      content.append(element('p', new URL(item.url).hostname, 'host'), heading);
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
    updatePicks();
    if (focusUrl) Array.from(list.querySelectorAll('[data-pick]')).find(button => button.dataset.pick === focusUrl)?.focus({ preventScroll: true });
    for (const button of scopes) button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
    byId('listen').hidden = !items.length || !window.speechSynthesis || !window.SpeechSynthesisUtterance;
    byId('retry').hidden = scope !== 'all' || !['partial', 'unavailable'].includes(phase);
    const count = items.length ? items.length + ' เว็บไซต์' : '';
    if (scope === 'selected') status.textContent = count || 'ยังไม่มีเว็บคัดสรรตรงคำนี้ ลองเลือก “ทุกแหล่ง” เพื่อค้นเว็บภายนอก';
    else if (phase === 'loading') status.textContent = [count, 'กำลังค้นแหล่งภายนอก…'].filter(Boolean).join(' · ');
    else if (phase === 'partial') status.textContent = [count, 'บางแหล่งยังไม่ตอบกลับ'].filter(Boolean).join(' · ');
    else if (phase === 'unavailable') status.textContent = [count, errorCode === 'web_rate_limited' ? 'แหล่งค้นหาถึงขีดจำกัดชั่วคราว' : 'ยังติดต่อแหล่งค้นหาภายนอกไม่ได้'].filter(Boolean).join(' · ');
    else status.textContent = count || 'ยังไม่พบเว็บที่ตรง ลองใช้ชื่อเว็บไซต์หรือคำที่สั้นลง';
  }
  async function loadWeb() {
    const controller = new AbortController();
    pending = controller; phase = 'loading'; render();
    try {
      const response = await fetch('/api/search', {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }), signal: controller.signal
      });
      const data = await response.json();
      if (pending !== controller) return;
      if (!['ok', 'partial', 'empty', 'unavailable'].includes(data.status)) throw Error('invalid_response');
      web = (data.results || []).filter(validItem);
      selected = (data.selected || []).filter(validItem);
      phase = data.status; errorCode = data.error || '';
    } catch {
      if (pending !== controller) return;
      phase = 'unavailable';
    }
    if (pending === controller) { pending = null; render(); }
  }
  function stopSpeaking() {
    if (speaking) { speaking = null; window.speechSynthesis.cancel(); }
    byId('listen').textContent = 'ฟังผลค้นหา';
  }
  byId('listen').onclick = () => {
    if (speaking) { stopSpeaking(); return; }
    const words = visibleItems().slice(0, 3).map(item => [item.title, item.excerpt, 'ที่มา ' + item.source].filter(Boolean).join(' '));
    const utterance = new SpeechSynthesisUtterance(words.join('. '));
    utterance.lang = /[ก-๙]/.test(utterance.text) ? 'th-TH' : 'en-US';
    utterance.onend = utterance.onerror = () => { if (speaking === utterance) { speaking = null; byId('listen').textContent = 'ฟังผลค้นหา'; } };
    speaking = utterance; byId('listen').textContent = 'หยุดอ่าน';
    window.speechSynthesis.speak(utterance);
  };
  function stopRecognition() {
    if (recognition) { const previous = recognition; recognition = null; previous.abort(); }
    byId('mic').setAttribute('aria-pressed', 'false'); byId('voice-status').textContent = '';
  }
  function syncLocation() {
    const params = new URLSearchParams(location.hash.slice(1));
    const next = (params.get('q') || '').trim().slice(0, 300);
    scope = params.get('scope') === 'selected' ? 'selected' : 'all';
    stopSpeaking(); stopRecognition();
    if (query !== next) {
      pending?.abort(); pending = null; web = []; phase = 'idle'; errorCode = '';
      query = next; selected = query ? PanthoriumSearchDirectory.match(query) : [];
    }
    input.value = query; document.title = query ? query + ' · Panthorium Search' : 'Panthorium Search';
    document.body.classList.toggle('has-query', Boolean(query));
    byId('discovery').hidden = Boolean(query); byId('results').hidden = !query;
    if (query && scope === 'all' && phase === 'idle') loadWeb();
    else render();
  }
  function navigate(value, nextScope) {
    const q = value.trim();
    if (!q) { input.focus(); return; }
    const params = new URLSearchParams({ q });
    if (nextScope === 'selected') params.set('scope', 'selected');
    if (location.hash.slice(1) !== params.toString()) location.hash = params.toString();
    else syncLocation();
  }
  form.onsubmit = event => { event.preventDefault(); navigate(input.value, scope); };
  for (const button of scopes) button.onclick = () => navigate(query, button.dataset.scope);
  byId('retry').onclick = loadWeb;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    byId('mic').hidden = false;
    byId('mic').onclick = () => {
      if (recognition) { stopRecognition(); return; }
      stopSpeaking();
      const rec = new Recognition();
      recognition = rec; rec.lang = /[a-z]/i.test(input.value) && !/[ก-๙]/.test(input.value) ? 'en-US' : 'th-TH';
      const info = byId('voice-status');
      rec.onresult = event => {
        if (recognition !== rec) return;
        const spoken = event.results[event.resultIndex]?.[0]?.transcript?.trim().slice(0, 300);
        if (spoken) { input.value = spoken; navigate(spoken, scope); }
      };
      rec.onerror = event => { if (recognition === rec) info.textContent = event.error === 'not-allowed' ? 'เบราว์เซอร์ยังไม่อนุญาตให้ใช้ไมโครโฟน พิมพ์เพื่อค้นหาได้เลย' : 'ยังรับเสียงไม่ได้ ลองใหม่หรือพิมพ์คำค้น'; };
      rec.onend = () => {
        if (recognition !== rec) return;
        recognition = null; byId('mic').setAttribute('aria-pressed', 'false');
        if (info.textContent === 'กำลังฟัง…') info.textContent = '';
      };
      try { rec.start(); info.textContent = 'กำลังฟัง…'; byId('mic').setAttribute('aria-pressed', 'true'); }
      catch { recognition = null; info.textContent = 'เริ่มรับเสียงไม่ได้ พิมพ์คำค้นได้เลย'; }
    };
  }
  window.addEventListener('hashchange', syncLocation);
  window.addEventListener('pagehide', () => { stopRecognition(); stopSpeaking(); });
  const initialQuery = new URLSearchParams(location.search).get('q');
  if (initialQuery && !location.hash) history.replaceState(null, '', '/search#' + new URLSearchParams({ q: initialQuery.slice(0, 300) }));
  syncLocation();
})();
