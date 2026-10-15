/* Panthorium Cloud Apps. Browser rendering only; execution and history live in Cloud. */
(function () {
  'use strict';
  const ID = 'cloud-apps';
  const groups = { life: 'ชีวิตประจำวัน · ช่วงวัย', study: 'การเรียน · การสอน', work: 'การทำงาน · ธุรกิจ', specialist: 'วิชาชีพเฉพาะ' };
  const packIcons = { profession_1: 'study', profession_2: 'study', profession_3: 'document', profession_4: 'people', profession_5: 'chart', profession_6: 'work', profession_7: 'people', profession_8: 'pen', profession_9: 'pen', profession_10: 'code', profession_11: 'tool', profession_12: 'tool', profession_13: 'health', profession_14: 'balance', profession_15: 'chart', profession_16: 'organizations', profession_17: 'leaf', profession_18: 'transport', profession_19: 'food', profession_20: 'work', profession_21: 'work', profession_22: 'home', profession_23: 'health', profession_24: 'people' };
  const os = () => typeof OS !== 'undefined' ? OS : null;
  const principal = () => String(os()?.state?.user?.sub || os()?.state?.user?.id || '');
  const allowed = () => !!principal() && !principal().startsWith('guest:') && !(os()?.state?.user?.roles || []).includes('guest') && (os()?.state?.user?.permissions || []).includes('chat');
  let catalog = null, readiness = {}, catalogPromise = null, generation = 0, view = null, context = null, menuObserver = null;
  function authFingerprint() {
    const user = os()?.state?.user || {};
    return JSON.stringify([principal(), [...(user.roles || [])].sort(), [...(user.permissions || [])].sort(), user.ageBand || '', user.isMinor === true]);
  }
  let authStamp = authFingerprint();
  const node = (tag, text, attrs = {}) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };
  const jsonText = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const key = () => window.crypto?.randomUUID?.() || 'cloud-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const isOffline = () => window.navigator.onLine === false;

  function category(pack) {
    if (Object.hasOwn(groups, pack.category)) return pack.category;
    if (pack.group === 'age') return 'life';
    const n = Number(String(pack.id).replace('profession_', ''));
    if (n === 1 || n === 2) return 'study';
    return n >= 3 && n <= 12 || n === 21 ? 'work' : 'specialist';
  }
  function publishContext(next) {
    context = next ? Object.freeze({ ...next }) : null;
    window.dispatchEvent(new CustomEvent('panthorium:cloud-app-context', { detail: context ? { ...context } : null }));
  }
  function current(v) { return view === v && v.root.isConnected && v.owner === principal() && v.generation === generation && allowed(); }
  async function call(path, options = {}) {
    const owner = principal(), epoch = generation;
    if (!allowed()) throw new Error('account_changed');
    if (isOffline()) throw new Error('offline');
    const valid = () => owner === principal() && epoch === generation && allowed();
    const send = () => {
      if (!valid()) throw new Error('account_changed');
      const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
      if (os()?.config?.accessToken) headers.Authorization = 'Bearer ' + os().config.accessToken;
      return fetch(String(os()?.config?.backendUrl || '').replace(/\/$/, '') + '/api/cloud-apps' + path, { ...options, headers, credentials: 'include' });
    };
    let response = await send();
    if (response.status === 401 && valid() && window.PanthoriumAuth?.refreshSession) {
      const ok = await window.PanthoriumAuth.refreshSession().catch(() => false);
      if (ok && valid()) response = await send();
    }
    if (!valid()) throw new Error('account_changed');
    const data = await response.json().catch(() => ({}));
    if (!valid()) throw new Error('account_changed');
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || 'cloud_unavailable'); error.status = response.status; error.data = data; throw error;
    }
    return data;
  }
  function errorMessage(error) {
    if (error.message === 'offline') return 'ยังไม่เชื่อมต่ออินเทอร์เน็ต • ยังไม่ได้ส่งงานใหม่ไป Cloud';
    if (error.message === 'account_changed' || error.status === 401) return 'บัญชีหรือเซสชันเปลี่ยน • ลงชื่อเข้าใช้แล้วเปิดใหม่';
    if (error.status === 403) return 'ยังไม่เปิดใช้งานชุดนี้สำหรับบัญชีนี้ • ตรวจสิทธิ์หรือเงื่อนไขอายุ';
    if (error.status === 429) return 'ถึงขีดจำกัดการใช้งานแล้ว • ตรวจโควต้าก่อนลองอีกครั้ง';
    return 'เชื่อมต่อหรือทำงานไม่สำเร็จ • ตรวจประวัติบน Cloud ก่อนส่งซ้ำ';
  }
  async function loadCatalog(force = false) {
    if (!allowed()) return null;
    if (catalog && !force) return catalog;
    if (catalogPromise) return catalogPromise;
    const epoch = generation;
    const pending = call('/catalog').then(data => {
      if (epoch !== generation) return null;
      catalog = data.catalog || { packs: [] }; readiness = data.readiness || {};
      installMenu(); return catalog;
    }).finally(() => { if (catalogPromise === pending) catalogPromise = null; });
    catalogPromise = pending;
    return pending;
  }
  function installStyle() {
    if (document.getElementById('cloud-apps-style')) return;
    const style = node('style'); style.id = 'cloud-apps-style';
    style.textContent = `
      #sm-apps [data-start-group] .sm-app[data-search-hidden="true"]{display:none!important}
      #sm-apps [data-start-group]{flex:none} #sm-apps [data-start-group] .sm-app{width:100%;text-align:left}
      [data-cloud-apps]{height:100%;overflow:auto;padding:18px;box-sizing:border-box;color:var(--text);font:14px/1.55 inherit}
      [data-cloud-apps] *{box-sizing:border-box} [data-cloud-apps] h2{margin:0 0 5px;font-size:22px}
      [data-cloud-apps] p{margin:7px 0} [data-cloud-apps] small{color:var(--text-dim);line-height:1.55}
      [data-cloud-apps] label{display:grid;gap:5px;margin:10px 0} [data-cloud-apps] textarea,[data-cloud-apps] input,[data-cloud-apps] select{width:100%;padding:10px;font:inherit}
      [data-cloud-apps] textarea{resize:vertical} [data-cloud-apps] button{padding:9px 12px;font:inherit;cursor:pointer}
      [data-cloud-apps] .ca-grid{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,2fr);gap:16px;margin-top:16px}
      [data-cloud-apps] .ca-features{display:grid;align-content:start;gap:8px} [data-cloud-apps] .ca-features button{text-align:left}
      [data-cloud-apps] .ca-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}
      [data-cloud-apps] [data-pt-card]{padding:14px;margin-bottom:12px}
      [data-cloud-apps] [data-status]{color:var(--pt-cyan,var(--accent));white-space:pre-wrap}
      [data-cloud-apps] [data-result] pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:8px 0}
      [data-cloud-apps] [data-sources]>div{padding:9px 0;border-bottom:1px solid var(--pt-border)}
      [data-cloud-apps] [hidden]{display:none!important} [data-cloud-apps] progress{width:100%;height:5px}
      [data-cloud-apps] .ca-history{display:grid;gap:7px} [data-cloud-apps] .ca-history button{text-align:left}
      @media(max-width:650px){[data-cloud-apps]{padding:12px}[data-cloud-apps] .ca-grid{grid-template-columns:1fr}[data-cloud-apps] .ca-features{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }
  function installMenu() {
    if (!allowed() || !catalog) return;
    const menu = document.getElementById('sm-apps');
    if (!menu || !window.PanthoriumStartMenuUI?.group) return;
    installStyle();
    for (const [id, label] of Object.entries(groups)) {
      const packs = (catalog.packs || []).filter(pack => category(pack) === id);
      if (!packs.length) continue;
      const section = window.PanthoriumStartMenuUI.group(id, label, menu);
      section.dataset.cloudPackGroup = 'true';
      const items = window.PanthoriumStartMenuUI.groupItems?.(section) || section;
      for (const pack of packs) {
        if (Array.from(section.querySelectorAll('[data-cloud-pack]')).some(item => item.dataset.cloudPack === pack.id)) continue;
        const button = node('button', null, { type: 'button', class: 'sm-app' });
        button.dataset.appId = ID + '-' + pack.id; button.dataset.cloudPack = pack.id;
        button.dataset.searchText = [label, pack.title, pack.goal, ...(pack.features || []).map(f => f.name)].join(' ');
        const icon = node('span', null, { class: 'ico sm-pack-icon', 'aria-hidden': 'true' });
        const graphic = window.PanthoriumStartMenuUI.icon?.(packIcons[pack.id] || id);
        if (graphic) icon.append(graphic);
        button.append(icon, node('span', pack.title));
        if (pack.blocked) { button.title = 'ดูรายละเอียด • ยังไม่เปิดใช้งานสำหรับบัญชีนี้'; button.append(node('small', ' · ดูรายละเอียด')); }
        button.addEventListener('click', () => { open(pack.id); if (typeof closeStartMenu === 'function') closeStartMenu(); });
        items.appendChild(button);
      }
    }
    window.PanthoriumStartMenuUI.keepPinnedLast(menu);
    window.PanthoriumStartMenuUI.filter(document.getElementById('start-search')?.value || '', menu, document.getElementById('sm-empty'));
    if (!menuObserver && window.MutationObserver) {
      menuObserver = new MutationObserver(() => installMenu());
      menuObserver.observe(menu, { childList: true });
    }
  }
  function markup() {
    return `<div data-cloud-apps>
      <header><small>PANTHORIUM CLOUD APPS</small><h2 data-title>ผู้ช่วยตามบริบท</h2><p data-goal></p></header>
      <label>เลือกชุดผู้ช่วย<select data-pack aria-label="ชุดผู้ช่วย"></select></label>
      <div data-pt-card><strong>สร้างร่างจากข้อมูลที่คุณให้</strong><p data-readiness></p><small>ยังไม่เชื่อมข้อมูลภายนอกหรือสั่งอุปกรณ์อัตโนมัติ ทุกผลลัพธ์ต้องตรวจทานก่อนนำไปใช้</small></div>
      <p data-status role="status" aria-live="polite"></p><progress data-progress aria-label="กำลังทำงานบน Cloud" hidden></progress>
      <div class="ca-grid"><nav class="ca-features" data-features aria-label="ความสามารถ"></nav><main>
        <section data-pt-card><h3 data-feature-title></h3><p data-detail></p><small data-dependency></small>
          <form data-form><label>บริบทส่วนตัวของคุณ<select data-scope><option value="personal">ชีวิตส่วนตัว</option><option value="work">งานของฉัน</option><option value="study">การเรียนของฉัน</option><option value="family">เรื่องครอบครัวของฉัน</option></select></label><small>ทุกบริบทเป็นข้อมูลส่วนตัวของเจ้าของบัญชี ยังไม่แบ่งปันให้ทีม โรงเรียน หรือครอบครัว</small>
          <label>สิ่งที่ต้องการและบริบท<textarea data-input required rows="5" maxlength="4000" placeholder="บอกงานที่ต้องการ ข้อจำกัด และข้อมูลที่ยืนยันแล้ว"></textarea></label>
          <details><summary>ข้อมูลอ้างอิงที่อนุญาตให้ใช้</summary><div data-sources></div><button type="button" data-add-source>เพิ่มข้อมูลอ้างอิง</button><p><small>วางข้อความจากเอกสารที่มีสิทธิ์ใช้ ระบบไม่ได้ดึงเนื้อหาจากลิงก์ให้อัตโนมัติ</small></p></details>
          <div class="ca-actions"><button type="submit" data-execute>สร้างร่างบน Cloud</button><button type="button" data-cancel hidden>ขอยกเลิกงาน</button></div></form>
          <button type="button" data-voice-context>ใช้บริบทนี้ในการสนทนาเสียง</button><p><small>เลือกบริบทเท่านั้น ยังไม่ได้เปิดไมค์หรือส่งข้อความแทนคุณ</small></p>
        </section><section data-pt-card data-result hidden aria-label="ผลลัพธ์งาน"></section>
        <section data-pt-card><div class="ca-actions"><strong>ประวัติบน Cloud</strong><button type="button" data-refresh-history>รีเฟรช</button></div><div data-history class="ca-history"></div></section>
      </main></div></div>`;
  }
  function setStatus(v, message) { if (current(v)) v.root.querySelector('[data-status]').textContent = message; }
  function setBusy(v, busy) {
    if (!current(v)) return;
    v.busy = busy; v.root.querySelector('[data-progress]').hidden = !busy;
    v.root.querySelector('[data-pack]').disabled = busy;
    for (const el of v.root.querySelectorAll('[data-features] button,[data-input],[data-scope],[data-add-source],[data-sources] input,[data-sources] textarea,[data-sources] button')) el.disabled = busy;
    v.root.querySelector('[data-execute]').disabled = busy || !canExecute(v);
    v.root.querySelector('[data-voice-context]').disabled = busy || !canExecute(v);
    v.root.querySelector('[data-cancel]').hidden = !busy;
  }
  function canExecute(v) { return !!v.feature && !v.pack?.blocked && readiness.storageReady === true && readiness.aiReady === true; }
  function contextFor(v) { return v.pack && v.feature && v.session && Date.parse(v.session.expiresAt) > Date.now() ? { packId: v.pack.id, featureId: v.feature.id, scope: v.scope, sessionId: v.session.id } : null; }
  async function ensureSession(v) {
    if (v.session && Date.parse(v.session.expiresAt) > Date.now() + 10000) return v.session;
    const packId = v.pack.id, scope = v.scope;
    const data = await call('/sessions', { method: 'POST', body: JSON.stringify({ packId, scope }) });
    if (!current(v) || v.pack.id !== packId || v.scope !== scope) throw new Error('account_changed');
    v.session = data.session; return v.session;
  }
  function chooseFeature(v, feature) {
    if (!current(v) || v.busy) return;
    v.feature = feature; v.root.querySelector('[data-feature-title]').textContent = feature.name;
    v.root.querySelector('[data-detail]').textContent = feature.detail || '';
    const labels = { Core: 'ช่วยจัดข้อมูลและสร้างร่าง', Connector: 'ร่างจากข้อมูลที่ให้ · การเชื่อมระบบยังไม่เปิด', Specialist: 'ร่างช่วยเตรียมงาน · ต้องให้ผู้เชี่ยวชาญตรวจ', Device: 'ร่างจากข้อมูลที่ให้ · ยังไม่อ่านหรือสั่งอุปกรณ์' };
    v.root.querySelector('[data-dependency]').textContent = labels[feature.dependency] || 'ร่างช่วยเตรียมงาน · ตรวจทานก่อนใช้';
    for (const button of v.root.querySelectorAll('[data-features] button')) button.setAttribute('aria-pressed', String(button.dataset.featureId === feature.id));
    v.root.querySelector('[data-execute]').disabled = !canExecute(v);
    v.root.querySelector('[data-voice-context]').disabled = !canExecute(v);
    publishContext(contextFor(v));
  }
  function choosePack(v, pack) {
    if (!current(v) || v.busy || !pack) return;
    v.pack = pack; v.session = null; v.run = null; v.idempotencyKey = null;
    v.root.querySelector('[data-input]').value = '';
    v.root.querySelector('[data-input]').maxLength = readiness.limits?.maxInputChars || 4000;
    v.root.querySelector('[data-sources]').replaceChildren();
    v.root.querySelector('[data-title]').textContent = pack.title;
    v.root.querySelector('[data-goal]').textContent = pack.goal || '';
    v.root.querySelector('[data-pack]').value = pack.id;
    v.root.querySelector('[data-result]').replaceChildren(); v.root.querySelector('[data-result]').hidden = true;
    const features = v.root.querySelector('[data-features]'); features.replaceChildren();
    for (const feature of pack.features || []) {
      const button = node('button', feature.name, { type: 'button', 'aria-pressed': 'false' });
      button.dataset.featureId = feature.id; button.onclick = () => chooseFeature(v, feature); features.appendChild(button);
    }
    const ready = v.root.querySelector('[data-readiness]');
    ready.textContent = pack.blocked ? 'ชุดนี้ยังไม่เปิดให้ทำงานสำหรับบัญชีนี้' : readiness.storageReady !== true ? 'ระบบจัดเก็บ Cloud ยังไม่พร้อม • ยังเริ่มงานไม่ได้' : readiness.aiReady !== true ? 'AI บน Cloud ยังไม่พร้อม • ดูรายละเอียดและประวัติได้' : readiness.providerConnectionVerified === true ? 'พร้อมสร้างร่างช่วยงานบน Cloud' : 'ตั้งค่าผู้ให้บริการแล้ว • พร้อมลองสร้างร่างบน Cloud';
    if ((pack.features || []).length) chooseFeature(v, pack.features[0]);
    else { v.feature = null; publishContext(null); }
    setBusy(v, false); setStatus(v, pack.blocked ? 'ต้องผ่านเงื่อนไขบัญชีและช่วงวัยก่อนใช้งาน • ไม่อนุมานอายุจากเสียง' : 'เลือกความสามารถและบอกสิ่งที่ต้องการ');
    loadHistory(v);
  }
  function addSource(v) {
    const container = v.root.querySelector('[data-sources]'); if (container.children.length >= (readiness.limits?.maxSources || 5)) return;
    const row = node('div'); const title = node('input', null, { placeholder: 'ชื่อ / ที่มาข้อมูล', maxlength: '120', required: '', 'aria-label': 'ชื่อข้อมูลอ้างอิง' });
    const content = node('textarea', null, { rows: '3', maxlength: String(readiness.limits?.maxSourceChars || 2000), placeholder: 'ข้อความที่อนุญาตให้ใช้', 'aria-label': 'เนื้อหาข้อมูลอ้างอิง' });
    const remove = node('button', 'นำออก', { type: 'button' }); remove.onclick = () => row.remove(); row.append(title, content, remove); container.appendChild(row);
  }
  function renderRun(v, run) {
    if (!current(v)) return; v.run = run;
    const target = v.root.querySelector('[data-result]'); target.replaceChildren(); target.hidden = false;
    const names = { running: 'กำลังทำงานบน Cloud', draft_ready: 'ร่างพร้อมตรวจทาน', completed: 'ร่างพร้อมตรวจทาน', failed: 'งานไม่สำเร็จ', cancelled: 'ยกเลิกงานแล้ว' };
    target.append(node('strong', names[run.status] || 'สถานะ: ' + String(run.status || 'ไม่ทราบ')));
    const result = run.result || {};
    for (const [field, label] of [['draft', 'ร่างผลลัพธ์'], ['sources', 'ข้อมูลอ้างอิง'], ['unknowns', 'สิ่งที่ยังไม่ทราบ'], ['nextActions', 'ขั้นตอนที่เสนอ']]) {
      if (result[field] == null || Array.isArray(result[field]) && !result[field].length) continue;
      target.append(node('h4', label), node('pre', jsonText(result[field])));
    }
    if (run.status === 'failed') target.append(node('p', 'ระบบไม่สามารถสร้างร่างได้ • ตรวจข้อมูลและการเชื่อมต่อก่อนเริ่มงานใหม่'));
    if (run.status === 'cancelled') target.append(node('p', 'Cloud ยืนยันการยกเลิกและจะไม่นำผลของงานนี้มาใช้'));
    if (run.status === 'draft_ready' || run.status === 'completed') target.append(node('small', 'นี่คือร่างช่วยงาน ยังไม่ได้ส่งข้อความ เปลี่ยนข้อมูลภายนอก หรือสั่งอุปกรณ์'));
    if (run.result && run.id) {
      const report = node('button', 'รายงานผลลัพธ์นี้', { type: 'button', 'data-report-result': '' });
      report.onclick = () => {
        if (!current(v)) return;
        if (window.PanthoriumPrivacyPolicy?.openAIReport) window.PanthoriumPrivacyPolicy.openAIReport({ sourceType: 'cloud_app_run', sourceId: run.id });
        else setStatus(v, 'เปิด Privacy/Policy เพื่อรายงานผลลัพธ์นี้ • เลขอ้างอิง ' + run.id);
      };
      target.appendChild(report);
    }
    if (run.status === 'running') {
      const cancel = node('button', 'ขอยกเลิกงานนี้', { type: 'button' }); cancel.onclick = () => cancelRun(v, run.id); target.append(cancel);
    }
  }
  async function loadHistory(v) {
    if (!current(v) || !v.pack) return;
    const packId = v.pack.id, scope = v.scope; const history = v.root.querySelector('[data-history]');
    try {
      const data = await call('/runs?packId=' + encodeURIComponent(packId) + '&scope=' + encodeURIComponent(scope));
      if (!current(v) || v.pack.id !== packId || v.scope !== scope) return;
      history.replaceChildren();
      const runs = data.runs || [];
      if (!runs.length) history.append(node('small', 'ยังไม่มีงานที่บันทึกบน Cloud'));
      for (const run of runs) {
        const feature = (v.pack.features || []).find(f => f.id === run.featureId);
        const button = node('button', (feature?.name || run.featureId || 'งาน') + ' · ' + ({ draft_ready: 'ร่างพร้อม', running: 'กำลังทำ', cancelled: 'ยกเลิก', failed: 'ไม่สำเร็จ' }[run.status] || run.status), { type: 'button' });
        button.onclick = async () => { try { const data = await call('/runs/' + encodeURIComponent(run.id)); if (current(v) && v.pack.id === packId && v.scope === scope) renderRun(v, data.run); } catch (error) { setStatus(v, errorMessage(error)); } };
        history.appendChild(button);
      }
    } catch (error) { if (current(v) && v.pack.id === packId && v.scope === scope) history.replaceChildren(node('small', errorMessage(error))); }
  }
  async function discoverRun(v) {
    if (!current(v) || !v.busy || !v.idempotencyKey) return;
    try {
      const data = await call('/runs?idempotencyKey=' + encodeURIComponent(v.idempotencyKey) + '&scope=' + encodeURIComponent(v.scope));
      if (!current(v) || !v.busy) return;
      const run = (data.runs || []).find(item => item.idempotencyKey === v.idempotencyKey);
      if (run) v.run = run;
      if (v.cancelRequested && run?.id) await cancelRun(v, run.id);
    } catch (_) { /* A lost response never implies cancellation or completion. */ }
    if (current(v) && v.busy) v.pollTimer = window.setTimeout(() => discoverRun(v), 1200);
  }
  async function cancelRun(v, id) {
    if (!current(v) || v.cancelling) return;
    v.cancelRequested = true;
    if (!id) { setStatus(v, 'กำลังค้นหางานบน Cloud เพื่อขอยกเลิก • ยังไม่ยืนยันว่าหยุดแล้ว'); return; }
    v.cancelling = true;
    try {
      const data = await call('/runs/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: '{}' });
      if (!current(v)) return;
      const run = data.run;
      if (run) renderRun(v, run);
      setStatus(v, run?.status === 'cancelled' ? 'Cloud ยืนยันการยกเลิกแล้ว' : 'งานอาจเสร็จแล้ว • ตรวจสถานะล่าสุดจาก Cloud');
      await loadHistory(v);
    } catch (error) { setStatus(v, errorMessage(error) + ' • ยังไม่ยืนยันการยกเลิก'); }
    finally { v.cancelling = false; }
  }
  async function execute(v) {
    if (!current(v) || v.busy || !canExecute(v)) return false;
    const input = v.root.querySelector('[data-input]').value.trim();
    if (!input) { setStatus(v, 'บอกงานและบริบทก่อนเริ่ม'); return false; }
    if (isOffline()) { setStatus(v, errorMessage(new Error('offline'))); return false; }
    const sources = Array.from(v.root.querySelector('[data-sources]').children).map(row => ({ title: row.querySelector('input').value.trim(), content: row.querySelector('textarea').value.trim() })).filter(item => item.content);
    if (sources.some(item => !item.title) || input.length + sources.reduce((sum, item) => sum + item.title.length + item.content.length, 0) > (readiness.limits?.maxTotalChars || 10000)) {
      setStatus(v, 'กรอกชื่อข้อมูลอ้างอิง และลดข้อความรวมให้ไม่เกินขีดจำกัดของงาน'); return false;
    }
    const signature = JSON.stringify({ packId: v.pack.id, featureId: v.feature.id, scope: v.scope, input, sources });
    if (v.requestSignature !== signature || !v.idempotencyKey) v.idempotencyKey = key();
    v.requestSignature = signature; v.run = null; v.cancelRequested = false; v.cancelling = false;
    setBusy(v, true); setStatus(v, 'กำลังเปิดงานบน Cloud…');
    try {
      await ensureSession(v);
      if (v.cancelRequested) { setStatus(v, 'ยกเลิกก่อนส่งงานแล้ว'); return false; }
      publishContext(contextFor(v)); setStatus(v, 'Cloud กำลังสร้างร่าง • การปิดหน้าต่างไม่ใช่การยกเลิกงาน');
      const response = call('/sessions/' + encodeURIComponent(v.session.id) + '/execute', { method: 'POST', body: JSON.stringify({ featureId: v.feature.id, input, sources, idempotencyKey: v.idempotencyKey }) });
      v.pollTimer = window.setTimeout(() => discoverRun(v), 600);
      const data = await response;
      if (!current(v)) return false;
      renderRun(v, data.run);
      setStatus(v, data.run.status === 'cancelled' ? 'Cloud ยืนยันการยกเลิกแล้ว' : data.run.status === 'failed' ? 'งานไม่สำเร็จ • ตรวจประวัติก่อนเริ่มใหม่' : 'ร่างพร้อมตรวจทาน • ยังไม่มีการกระทำต่อระบบภายนอก');
      await loadHistory(v); return true;
    } catch (error) {
      if (current(v)) { setStatus(v, errorMessage(error)); await loadHistory(v); }
      return false;
    } finally { window.clearTimeout(v.pollTimer); if (current(v)) setBusy(v, false); }
  }
  async function open(packId) {
    if (!allowed()) return false;
    try { await loadCatalog(); } catch (_) { /* Open a recoverable error state. */ }
    if (!allowed() || typeof createWindow !== 'function') return false;
    installStyle();
    if (view && current(view)) {
      window.PanthoriumWindowManager?.restore?.(ID);
      if (typeof focusWindow === 'function') focusWindow(ID);
      const pack = catalog?.packs?.find(item => item.id === packId); if (pack) choosePack(view, pack); return true;
    }
    createWindow(ID, 'ผู้ช่วยชีวิตและการทำงาน', markup(), { width: 980, height: 760 });
    const root = document.querySelector('.window[data-id="cloud-apps"] [data-cloud-apps]'); if (!root) return false;
    const v = view = { root, owner: principal(), generation, pack: null, feature: null, scope: 'personal', session: null, busy: false, pollTimer: null };
    root.querySelector('[data-form]').onsubmit = event => { event.preventDefault(); execute(v); };
    root.querySelector('[data-add-source]').onclick = () => addSource(v);
    root.querySelector('[data-cancel]').onclick = () => cancelRun(v, v.run?.id);
    root.querySelector('[data-refresh-history]').onclick = () => loadHistory(v);
    root.querySelector('[data-scope]').onchange = () => {
      if (!current(v) || v.busy) return;
      const scope = root.querySelector('[data-scope]').value;
      if (!['personal', 'work', 'study', 'family'].includes(scope)) return;
      v.scope = scope; v.session = null; v.run = null; v.idempotencyKey = null;
      root.querySelector('[data-input]').value = ''; root.querySelector('[data-sources]').replaceChildren();
      root.querySelector('[data-result]').replaceChildren(); root.querySelector('[data-result]').hidden = true;
      publishContext(null); setStatus(v, 'เปลี่ยนบริบทส่วนตัวแล้ว • งานและประวัติแยกตามบริบท'); loadHistory(v);
    };
    root.querySelector('[data-voice-context]').onclick = async () => {
      if (!current(v) || !canExecute(v)) return;
      const button = root.querySelector('[data-voice-context]'); button.disabled = true;
      try { await ensureSession(v); if (current(v)) { publishContext(contextFor(v)); setStatus(v, 'เลือกบริบทนี้สำหรับเสียงแล้ว • เริ่มสนทนาจากปุ่มเสียงของ Panthorium'); } }
      catch (error) { setStatus(v, errorMessage(error)); }
      finally { if (current(v)) button.disabled = !canExecute(v); }
    };
    const select = root.querySelector('[data-pack]');
    for (const [id, label] of Object.entries(groups)) {
      const group = node('optgroup', null, { label });
      for (const pack of catalog?.packs || []) if (category(pack) === id) group.append(node('option', pack.title, { value: pack.id }));
      if (group.children.length) select.append(group);
    }
    select.onchange = () => choosePack(v, catalog.packs.find(pack => pack.id === select.value));
    if (catalog?.packs?.length) choosePack(v, catalog.packs.find(pack => pack.id === packId) || catalog.packs[0]);
    else { setStatus(v, 'โหลดชุดผู้ช่วยจาก Cloud ไม่สำเร็จ • ปิดหน้าต่างแล้วลองใหม่เมื่อเชื่อมต่อได้'); root.querySelector('[data-execute]').disabled = true; }
    return true;
  }
  function clearAccount() {
    generation++; catalog = null; catalogPromise = null; readiness = {};
    if (view) { window.clearTimeout(view.pollTimer); view.root.replaceChildren(); }
    if (typeof closeWindow === 'function' && document.querySelector('.window[data-id="cloud-apps"]')) closeWindow(ID);
    else document.querySelector('.window[data-id="cloud-apps"]')?.remove();
    view = null; publishContext(null);
    document.querySelectorAll('#sm-apps [data-cloud-pack-group="true"]').forEach(item => item.remove());
    if (allowed()) loadCatalog().catch(() => {});
  }
  window.PanthoriumCloudApps = Object.freeze({ open, refreshCatalog: () => loadCatalog(true), voiceContext: () => allowed() && view && current(view) && context ? contextFor(view) : null });
  window.addEventListener('panthorium:auth-changed', () => {
    const next = authFingerprint();
    if (next === authStamp) { installMenu(); if (allowed() && !catalog) loadCatalog().catch(() => {}); return; }
    authStamp = next; clearAccount();
  });
  window.addEventListener('online', () => { if (allowed()) loadCatalog().catch(() => {}); });
  window.addEventListener('offline', () => { if (view) setStatus(view, view.busy ? 'การเชื่อมต่อขาด • งานที่ Cloud รับแล้วอาจยังทำต่อ ตรวจประวัติเมื่อเชื่อมต่อได้' : 'ยังไม่เชื่อมต่ออินเทอร์เน็ต • ไม่รับงานใหม่และไม่ทำงานออฟไลน์'); });
  const start = () => { if (allowed()) loadCatalog().catch(() => {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
