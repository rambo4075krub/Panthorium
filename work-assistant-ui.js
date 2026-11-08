/* Private document work, editable outputs, projects and linked deadlines. */
(function () {
  'use strict';
  const ID = 'work-assistant', PREFIX = 'panthorium.work.recovery:';
  const os = () => typeof OS === 'undefined' ? null : OS;
  const owner = () => String(os()?.state?.user?.sub || os()?.state?.user?.id || '');
  const allowed = () => !!owner() && !/^guest[:_-]/i.test(owner()) && !(os()?.state?.user?.roles || []).includes('guest') && (os()?.state?.user?.permissions || []).includes('chat');
  const el = (tag, text, attrs = {}) => { const node = document.createElement(tag); if (text != null) node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
  const button = (text, handler, attrs = {}) => { const node = el('button', text, { type: 'button', ...attrs }); node.onclick = handler; return node; };
  let view = null, lastOwner = owner(), menuObserver = null;
  const current = v => view === v && v.root.isConnected && v.owner === owner() && allowed();
  const q = (v, selector) => v.root.querySelector(selector);
  const messages = {
    account_required: 'กรุณาเข้าสู่ระบบ', account_changed: 'บัญชีเปลี่ยนแล้ว กรุณาเปิดผู้ช่วยงานใหม่', session_expired: 'กรุณาเข้าสู่ระบบอีกครั้ง',
    work_version_conflict: 'งานบนระบบมีฉบับใหม่กว่า ร่างของคุณยังอยู่ เลือกเก็บเป็นงานใหม่หรือโหลดฉบับบนระบบ',
    work_source_required: 'เลือกไฟล์หรือใส่ข้อความต้นทางก่อน', work_scanned_pdf_requires_ocr: 'PDF นี้เป็นภาพสแกน กรุณาใช้ PDF ที่เลือกข้อความได้ หรือวางข้อความที่อ่านแล้ว',
    work_context_too_large: 'เนื้อหารวมมากเกินไป กรุณาเลือกไฟล์น้อยลงหรือแยกเอกสารเป็นส่วน', work_source_text_too_large: 'ข้อความในไฟล์ยาวเกินขอบเขต กรุณาแยกไฟล์',
    work_source_too_large: 'ไฟล์สำหรับอ่านต้องไม่เกิน 6 MB', work_source_too_many_pages: 'PDF สำหรับอ่านต้องไม่เกิน 100 หน้า',
    work_source_type_unsupported: 'รองรับ PDF ที่มีข้อความ, DOCX, XLSX, PPTX, TXT, CSV, TSV, Markdown และ JSON',
    work_source_encoding_unsupported: 'ไฟล์ข้อความต้องใช้ UTF-8', work_source_parse_failed: 'อ่านไฟล์นี้ไม่ได้ กรุณาตรวจไฟล์หรือใช้ฉบับอื่น', work_source_timeout: 'อ่านไฟล์ไม่ทันเวลา กรุณาใช้ไฟล์ขนาดเล็กลง',
    work_ai_unavailable: 'AI ยังประมวลผลไม่สำเร็จ ร่างเดิมยังอยู่', work_invalid_citation: 'คำตอบอ้างตำแหน่งที่ไม่มีในต้นฉบับ จึงยังไม่แทนที่ร่างเดิม',
    work_table_required: 'การส่งออก Excel ต้องมีตารางอย่างน้อย 2 คอลัมน์และ 2 แถวในร่าง', work_busy: 'บัญชีนี้กำลังประมวลผลงานอยู่',
    work_reminder_already_started: 'การเตือนเริ่มส่งหรือยังยืนยันผลการส่งไม่ได้ จึงยังไม่เปลี่ยนรายการเพื่อป้องกันการเตือนซ้ำ',
    reminder_time_must_be_future: 'เวลาเตือนต้องอยู่ในอนาคตอย่างน้อย 30 วินาที', verified_email_required: 'ยืนยันอีเมลบัญชีก่อนตั้งเตือน',
    reminder_email_unavailable: 'ช่องทางส่งอีเมลยังไม่พร้อม เลือกไม่ตั้งเตือนเพื่อบันทึกงานก่อนได้',
    file_not_found: 'ไม่พบไฟล์ในบัญชีนี้ กรุณาเลือกไฟล์อีกครั้ง', work_project_limit: 'บัญชีนี้มีแฟ้มงานครบ 40 แฟ้มแล้ว',
    work_storage_unavailable: 'พื้นที่เก็บแฟ้มงานยังไม่พร้อม', work_task_closed: 'งานนี้เสร็จหรือยกเลิกแล้ว',
    network_error: 'เชื่อมต่อไม่สำเร็จ ร่างที่ยังไม่บันทึกยังอยู่บนหน้าจอ', work_cancelled: 'หยุดประมวลผลแล้ว',
    invalid_office_content: 'ร่างยาวหรือมีโครงสร้างที่ส่งออกไม่ได้ กรุณาแบ่งเป็นเอกสารย่อย', work_invalid_due_time: 'เลือกวันและเวลากำหนดส่งให้ครบ',
    work_invalid_text: 'กรุณาตรวจความยาวและข้อมูลในช่องกรอก', work_output_too_large: 'คำตอบยาวเกินขอบเขต กรุณาขอให้สรุปสั้นลง'
  };
  const friendly = failure => messages[failure?.code || failure?.message] || 'ดำเนินการไม่สำเร็จ (' + String(failure?.message || 'work_unavailable') + ')';
  function report(v, text, bad = false) { if (!current(v)) return; const node = q(v, '[data-work-status]'); node.textContent = text; node.dataset.error = String(bad); }
  async function api(v, path, options = {}, raw = false) {
    if (!current(v)) throw Error('account_changed');
    const request = () => fetch(String(os()?.config?.backendUrl || '').replace(/\/$/, '') + path, { ...options,
      credentials: 'include', cache: 'no-store', signal: options.signal || v.controller.signal,
      headers: { ...(os()?.config?.accessToken ? { Authorization: 'Bearer ' + os().config.accessToken } : {}), ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    let response;
    try { response = await request(); } catch (failure) { if (failure.name === 'AbortError' || !current(v)) throw failure; throw Error('network_error'); }
    if (response.status === 401 && current(v) && window.PanthoriumAuth?.refreshSession) {
      const refreshed = await window.PanthoriumAuth.refreshSession().catch(() => false);
      if (!current(v)) throw Error('account_changed'); if (refreshed) response = await request();
    }
    if (!current(v)) throw Error('account_changed');
    if (raw && response.ok) return response;
    const data = await response.json().catch(() => ({}));
    if (!current(v)) throw Error('account_changed');
    if (!response.ok || data.ok === false) throw Object.assign(Error(response.status === 401 ? 'session_expired' : data.error || 'HTTP ' + response.status), { status: response.status });
    return data;
  }
  const post = (v, path, body, signal) => api(v, path, { method: 'POST', body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const base = v => '/api/work/' + encodeURIComponent(v.project.id);
  const patch = v => ({ title: q(v, '[data-work-title]').value, template: q(v, '[data-work-template]').value,
    text: q(v, '[data-work-text]').value, draft: q(v, '[data-work-draft]').value, sourceFileIds: [...v.selected] });
  function recovery(v) {
    if (!v.project || !q(v, '[data-work-local]').checked) return;
    try { localStorage.setItem(PREFIX + v.owner + ':' + v.project.id, JSON.stringify({ at: Date.now(), version: v.project.version, patch: patch(v) })); }
    catch { report(v, 'พื้นที่กู้คืนบนอุปกรณ์ไม่พร้อม กรุณาบันทึกบนระบบก่อนปิดหน้า', true); }
  }
  function clearRecovery(v, id = v.project?.id) { try { localStorage.removeItem(PREFIX + v.owner + ':' + id); } catch { /* Storage may be disabled. */ } }
  function changed(v) {
    if (!current(v) || !v.project) return; v.editSeq++; v.dirty = true; recovery(v); clearTimeout(v.saveTimer);
    report(v, 'มีการแก้ไข · กำลังรอบันทึก'); v.saveTimer = setTimeout(() => save(v).catch(failure => report(v, friendly(failure), true)), 900);
  }
  async function save(v) {
    if (!current(v) || !v.project) throw Error('account_changed');
    if (v.conflict) throw Error('work_version_conflict');
    if (v.saving) { await v.saving; if (v.dirty) return save(v); return; }
    if (!v.dirty) return;
    const id = v.project.id, seq = v.editSeq, snapshot = patch(v), expectedVersion = v.project.version;
    const operationId = v.saveOperation?.seq === seq ? v.saveOperation.id : crypto.randomUUID(); v.saveOperation = { id: operationId, seq };
    const pending = api(v, base(v), { method: 'PUT', body: JSON.stringify({ expectedVersion, patch: snapshot, operationId }) });
    v.saving = pending;
    try {
      const result = await pending;
      if (!current(v) || v.project.id !== id) return;
      v.project = result.project;
      if (seq === v.editSeq) { v.dirty = false; v.saveOperation = null; clearRecovery(v); report(v, 'บันทึกแล้ว · ฉบับ ' + v.project.version); }
      else recovery(v);
      renderHistory(v); updateList(v);
    } catch (failure) {
      if (failure.message === 'work_version_conflict' && current(v)) { v.conflict = true; q(v, '[data-work-conflict]').hidden = false; }
      throw failure;
    } finally { if (v.saving === pending) v.saving = null; }
    if (current(v) && v.dirty) return save(v);
  }
  function markup() { return `<div data-work>
    <style>
    [data-work]{height:100%;overflow:auto;padding:22px;background:var(--bg,#0d121b);color:var(--text,#f2f4f8);font:14px/1.65 system-ui,sans-serif;box-sizing:border-box}
    [data-work] *{box-sizing:border-box}[data-work] h1{font-size:26px;margin:0}[data-work] h2{font-size:18px;margin:0 0 12px}[data-work] h3{font-size:15px;margin:8px 0}[data-work] p{margin:7px 0}
    [data-work] header,.wa-actions,.wa-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}[data-work] header{justify-content:space-between;margin-bottom:18px}
    [data-work] button,[data-work] input,[data-work] select,[data-work] textarea{font:inherit;color:inherit;background:var(--panel,#17202e);border:1px solid #596477;border-radius:9px;padding:10px;min-height:44px}
    [data-work] button{cursor:pointer}[data-work] button:disabled{opacity:.5;cursor:wait}[data-work] :focus-visible{outline:3px solid #ffc084;outline-offset:2px}[data-work] .wa-primary{background:#ce7338;color:#fff;border-color:#fca56c}
    [data-work] input:not([type=checkbox]),[data-work] textarea,[data-work] select{width:100%}[data-work] input[type=checkbox]{width:20px;min-height:20px;accent-color:#f5a063}
    [data-work] textarea{resize:vertical;min-height:150px;line-height:1.75}[data-work] [data-work-draft]{min-height:310px}[data-work] label{display:block;margin:10px 0 5px}
    [data-work] small,.wa-muted{color:var(--text-dim,#b5c1d1)}[data-work] .wa-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:16px}
    [data-work] section,[data-work] .wa-card{padding:17px;border:1px solid #3d4758;border-radius:13px;min-width:0;margin-bottom:14px}[data-work] .wa-wide{grid-column:1/-1}
    [data-work] [data-work-files]{max-height:200px;overflow:auto}[data-work] .wa-file{display:flex;gap:9px;align-items:center;margin:6px 0;overflow-wrap:anywhere}
    [data-work] .wa-status{padding:10px 12px;background:#182b29;border-radius:8px;margin:12px 0;overflow-wrap:anywhere}[data-work] [data-error=true]{background:#492326}
    [data-work] details{padding:8px 0;overflow-wrap:anywhere}[data-work] summary{cursor:pointer}[data-work] pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
    [data-work] dialog{color:inherit;background:#121b29;border:1px solid #697c93;border-radius:14px;width:min(560px,94vw);max-height:88vh;overflow:auto}[data-work] dialog::backdrop{background:#0009}
    [data-work] [hidden]{display:none!important}@media(max-width:760px){[data-work]{padding:12px}[data-work] .wa-grid{grid-template-columns:1fr}[data-work] h1{font-size:22px}[data-work] section{padding:12px}}
    </style>
    <header><div><h1>ผู้ช่วยงาน</h1><p class="wa-muted">อ่านไฟล์ ร่างเอกสาร และติดตามกำหนดส่ง</p></div><div class="wa-actions"><button data-work-new type="button">งานใหม่</button><button data-work-voice type="button">สั่งด้วยเสียง</button><button data-work-refresh type="button">โหลดล่าสุด</button></div></header>
    <div class="wa-row"><label style="flex:1">ค้นหาแฟ้มงาน<input data-work-search placeholder="ชื่อโครงการ ลูกค้า หรือข้อความในงาน"></label><label style="flex:1">แฟ้มงาน<select data-work-projects aria-label="เลือกแฟ้มงาน"></select></label></div>
    <p data-work-status class="wa-status" role="status" aria-live="polite">กำลังโหลดแฟ้มงาน</p>
    <div data-work-conflict hidden class="wa-card"><p>ร่างบนหน้าจอยังอยู่ การบันทึกอัตโนมัติหยุดจนกว่าจะจัดการฉบับที่ต่างกัน</p><div class="wa-actions"><button data-work-copy type="button">เก็บร่างนี้เป็นงานใหม่</button><button data-work-reload type="button">โหลดฉบับบนระบบ</button></div></div>
    <div data-work-approvals></div><div class="wa-grid" data-work-editor hidden>
      <section><h2>1. ข้อมูลต้นทาง</h2><label>ชื่อแฟ้มงาน<input data-work-title maxlength="160" required></label><label>รูปแบบงาน<select data-work-template><option value="report">รายงานประจำสัปดาห์</option><option value="minutes">สรุปประชุม</option><option value="letter">หนังสือหรืออีเมลธุรกิจ</option><option value="proposal">ข้อเสนองาน</option></select></label>
      <label>เลือกไฟล์จากบัญชี (สูงสุด 6 ไฟล์)</label><div data-work-files></div><label>เพิ่มไฟล์ต้นทาง<input data-work-upload type="file" accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.tsv,.md,.json" multiple></label><small>ไฟล์ละไม่เกิน 6 MB · PDF ต้องมีข้อความที่เลือกได้</small>
      <label>ข้อความหรือบันทึกประชุม<textarea data-work-text maxlength="16000" placeholder="วางข้อมูลที่ต้องการให้ใช้เป็นต้นทาง"></textarea></label>
      <label>สิ่งที่ต้องการให้ช่วย<textarea data-work-instruction maxlength="4000" style="min-height:80px" placeholder="เช่น สรุปสิ่งที่ต้องส่งลูกค้า พร้อมกำหนดส่ง หรือแปลเป็นภาษาอังกฤษ"></textarea></label>
      <div class="wa-actions" data-work-modes></div><button data-work-stop type="button" hidden>หยุดประมวลผล</button><small>การใช้ AI ใช้โควตาตามแพ็กเกจ ตรวจชื่อ ตัวเลข และวันที่ก่อนส่งงาน</small></section>
      <section><h2>2. ร่างและไฟล์ส่งมอบ</h2><label>แก้ไขร่าง<textarea data-work-draft maxlength="20000" placeholder="ผลลัพธ์จะอยู่ที่นี่ แก้ไขก่อนส่งออกได้"></textarea></label>
      <div class="wa-actions"><button data-work-save type="button">บันทึกร่าง</button><button data-work-export="document" type="button">สร้าง Word</button><button data-work-export="spreadsheet" type="button">สร้าง Excel</button><button data-work-export="presentation" type="button">สร้าง PowerPoint</button></div>
      <label class="wa-file"><input type="checkbox" data-work-local checked>เก็บร่างที่ยังไม่ซิงก์บนอุปกรณ์นี้เพื่อกู้คืน</label><small>แยกตามบัญชี เก็บไม่เกิน 24 ชั่วโมง และลบเมื่อออกจากระบบ</small>
      <div data-work-evidence></div><details><summary>ฉบับแก้ไขก่อนหน้า</summary><div data-work-history></div></details><h3>ไฟล์ที่สร้าง</h3><div data-work-outputs></div></section>
      <section class="wa-wide"><div class="wa-actions"><h2>3. รายการงานและกำหนดส่ง</h2><button data-work-add-task type="button">เพิ่มรายการงาน</button></div><p class="wa-muted">ตรวจผู้รับผิดชอบและวันเวลาก่อนยืนยัน รายการจะแสดงในปฏิทิน การเตือนส่งถึงอีเมลบัญชีของคุณ</p><div data-work-proposals></div><div data-work-tasks></div></section>
    </div><dialog data-work-dialog></dialog></div>`; }
  function updateList(v) {
    if (!current(v)) return;
    if (v.project) { const index = v.projects.findIndex(p => p.id === v.project.id); if (index >= 0) v.projects[index] = v.project; else v.projects.unshift(v.project); }
    const select = q(v, '[data-work-projects]'), query = q(v, '[data-work-search]').value.toLocaleLowerCase('th');
    select.replaceChildren(el('option', 'เลือกแฟ้มงาน', { value: '' }));
    for (const p of v.projects.filter(p => p.id === v.project?.id || [p.title, p.text, p.draft].join('\n').toLocaleLowerCase('th').includes(query))) select.append(el('option', p.title, { value: p.id }));
    select.value = v.project?.id || '';
  }
  function renderFiles(v) {
    const root = q(v, '[data-work-files]'); root.replaceChildren();
    for (const file of v.files.filter(f => /\.(pdf|docx|xlsx|pptx|txt|csv|tsv|md|json)$/i.test(f.name))) {
      const line = el('label', null, { class: 'wa-file' }), input = el('input', null, { type: 'checkbox', value: file.id }); input.checked = v.selected.has(file.id);
      input.onchange = () => { if (input.checked && v.selected.size >= 6) { input.checked = false; return report(v, 'เลือกได้ไม่เกิน 6 ไฟล์', true); } input.checked ? v.selected.add(file.id) : v.selected.delete(file.id); changed(v); };
      line.append(input, el('span', file.name)); root.append(line);
    }
    if (!root.children.length) root.append(el('p', 'ยังไม่มีไฟล์ที่รองรับ เพิ่มไฟล์หรือวางข้อความได้'));
  }
  function renderHistory(v) {
    const node = q(v, '[data-work-history]'); node.replaceChildren();
    for (const item of v.project?.history || []) {
      const details = el('details'), summary = el('summary', new Date(item.at).toLocaleString('th-TH'));
      details.append(summary, el('pre', item.draft), button('นำฉบับนี้กลับมาแก้ไข', () => { q(v, '[data-work-draft]').value = item.draft; changed(v); })); node.append(details);
    }
    if (!node.children.length) node.append(el('p', 'ยังไม่มีฉบับก่อนหน้า'));
  }
  function paint(v, project) {
    v.project = project; v.dirty = false; v.conflict = false; v.selected = new Set(project.sourceFileIds); v.saveOperation = null;
    q(v, '[data-work-editor]').hidden = false; q(v, '[data-work-conflict]').hidden = true;
    for (const key of ['title', 'text', 'draft', 'template']) q(v, '[data-work-' + key + ']').value = project[key] || (key === 'template' ? 'report' : '');
    q(v, '[data-work-evidence]').replaceChildren(); q(v, '[data-work-proposals]').replaceChildren();
    renderFiles(v); renderHistory(v); renderTasks(v); updateList(v); renderOutputs(v).catch(failure => report(v, friendly(failure), true));
    let stored;
    try { stored = JSON.parse(localStorage.getItem(PREFIX + v.owner + ':' + project.id) || 'null'); } catch { /* Invalid local recovery is ignored. */ }
    if (stored?.patch && Date.now() - stored.at < 86400000 && stored.at <= Date.now() && JSON.stringify(stored.patch) !== JSON.stringify(patch(v))) {
      const card = el('div', null, { class: 'wa-card' }); card.append(el('p', 'พบร่างที่ยังไม่ซิงก์จากอุปกรณ์นี้'), button('กู้ร่างขึ้นมา', () => {
        for (const key of ['title', 'text', 'draft', 'template']) if (typeof stored.patch[key] === 'string') q(v, '[data-work-' + key + ']').value = stored.patch[key];
        v.selected = new Set(Array.isArray(stored.patch.sourceFileIds) ? stored.patch.sourceFileIds : []); renderFiles(v);
        if (stored.version !== v.project.version) { v.conflict = true; q(v, '[data-work-conflict]').hidden = false; }
        changed(v); card.remove();
      }), button('ใช้ฉบับบนระบบ', () => { clearRecovery(v); card.remove(); })); q(v, '[data-work-evidence]').append(card);
    } else if (stored) clearRecovery(v);
    report(v, 'เปิดแฟ้มงานแล้ว · ฉบับ ' + project.version);
  }
  async function load(v, id) {
    await save(v); if (v.busy) throw Error('work_busy');
    const seq = ++v.loadSeq, result = await api(v, '/api/work/' + encodeURIComponent(id));
    if (current(v) && seq === v.loadSeq) paint(v, result.project);
  }
  async function newProject(v, copied) {
    if (v.busy) throw Error('work_busy');
    if (!copied && v.project) await save(v);
    const id = crypto.randomUUID(); const result = await api(v, '/api/work/' + id, { method: 'PUT', body: JSON.stringify({ expectedVersion: 0, operationId: crypto.randomUUID(), patch: copied || { title: 'งานใหม่', template: 'report', text: '', draft: '', sourceFileIds: [] } }) });
    if (current(v)) paint(v, result.project);
  }
  function busy(v, value) {
    v.busy = value; q(v, '[data-work-stop]').hidden = !value || !v.analysis;
    for (const node of v.root.querySelectorAll('[data-work-mode],[data-work-export],[data-work-new],[data-work-projects],[data-work-voice],[data-work-upload],[data-work-refresh],[data-work-reload],[data-work-copy],[data-work-add-task]')) node.disabled = value;
  }
  async function analyze(v, mode) {
    if (v.busy) return;
    try {
      await save(v); const projectId = v.project.id, editSeq = v.editSeq;
      const controller = new AbortController(); v.analysis = controller; busy(v, true);
      const abort = () => controller.abort(); v.controller.signal.addEventListener('abort', abort, { once: true });
      report(v, 'กำลังอ่านต้นฉบับและประมวลผล · หยุดได้');
      let result;
      try { result = await post(v, base(v) + '/analyze', { expectedVersion: v.project.version, mode, instruction: q(v, '[data-work-instruction]').value }, controller.signal); }
      finally { v.controller.signal.removeEventListener('abort', abort); }
      if (!current(v) || v.project.id !== projectId) return;
      const evidence = q(v, '[data-work-evidence]'); evidence.replaceChildren();
      const apply = () => { q(v, '[data-work-draft]').value = result.draft; changed(v); };
      if (v.editSeq !== editSeq) { evidence.append(el('p', 'คุณแก้ร่างระหว่างประมวลผล ผลใหม่ยังไม่แทนที่ร่าง'), el('pre', result.draft), button('นำผลใหม่มาใช้', apply)); }
      else { apply(); await save(v); }
      for (const warning of result.warnings || []) evidence.append(el('p', warning));
      const cited = new Set((result.citations || []).map(c => c.key));
      for (const source of result.sources || []) {
        const details = el('details'); details.append(el('summary', source.name));
        for (const part of source.parts) { const row = el('details'); row.append(el('summary', '[' + part.key + '] ' + part.label + (cited.has(part.key) ? ' · อ้างในคำตอบ' : '')), el('pre', part.text)); details.append(row); }
        if (source.fileId) details.append(button('เปิดต้นฉบับ', () => window.PanthoriumFilePreview?.open({ id: source.fileId, name: source.name })));
        evidence.append(details);
      }
      renderProposals(v, result.proposedTasks || []); report(v, 'ประมวลผลแล้ว ตรวจร่างและต้นฉบับก่อนส่งออก');
    } catch (failure) { if (current(v)) report(v, failure.name === 'AbortError' ? 'หยุดแล้ว ร่างเดิมยังอยู่' : friendly(failure), failure.name !== 'AbortError'); }
    finally { if (current(v)) { v.analysis = null; busy(v, false); } }
  }
  async function renderOutputs(v) {
    const root = q(v, '[data-work-outputs]'), id = v.project.id, generation = v.outputGeneration = (v.outputGeneration || 0) + 1; root.replaceChildren();
    for (const item of v.project.exports || []) {
      const result = await api(v, '/api/studio/jobs/' + encodeURIComponent(item.jobId));
      if (!current(v) || v.project.id !== id || v.outputGeneration !== generation) return;
      const job = result.job, card = el('div', null, { class: 'wa-card' });
      if (job.status !== 'completed') card.append(el('p', ({ queued: 'รอสร้างไฟล์', running: 'กำลังสร้างไฟล์', failed: 'สร้างไฟล์ไม่สำเร็จ', needs_review: 'ยังยืนยันผลไม่ได้ กรุณาตรวจสถานะ' })[job.status] || job.status), button('ตรวจและทำงานต่อ', async () => { try { await post(v, '/api/studio/jobs/' + job.id + '/advance', {}); await renderOutputs(v); } catch (e) { report(v, friendly(e), true); } }));
      for (const file of job.files || []) {
        const row = el('div', null, { class: 'wa-actions' }); row.append(el('span', file.name));
        if (/\.(docx|xlsx|pptx)$/i.test(file.name)) row.append(button('เปิดแก้ไข', () => window.PanthoriumStudioEditor?.open(file.id)));
        row.append(button(/\.print\.html$/i.test(file.name) ? 'เปิดเพื่อพิมพ์ / PDF' : 'เปิดดู', () => window.PanthoriumFilePreview?.open(file)), button('ดาวน์โหลด', async () => {
          try { const response = await api(v, '/api/files/' + file.id, {}, true), blob = await response.blob(); if (!current(v)) return; const url = URL.createObjectURL(blob); v.urls.add(url); const link = el('a', null, { href: url, download: file.name }); document.body.append(link); link.click(); link.remove(); setTimeout(() => { URL.revokeObjectURL(url); v.urls.delete(url); }, 30000); }
          catch (failure) { report(v, friendly(failure), true); }
        })); card.append(row);
      }
      root.append(card);
    }
    if (!root.children.length) root.append(el('p', 'ยังไม่มีไฟล์ส่งออกจากแฟ้มนี้'));
  }
  async function exportDraft(v, pluginId) {
    if (v.busy) return;
    try { await save(v); busy(v, true); const key = pluginId + ':' + v.project.version;
      if (!v.exportOperation || v.exportOperation.key !== key) v.exportOperation = { key, id: crypto.randomUUID() };
      report(v, 'กำลังสร้างไฟล์จากร่างที่บันทึกแล้ว');
      const result = await post(v, base(v) + '/export', { expectedVersion: v.project.version, pluginId, operationId: v.exportOperation.id });
      if (!current(v)) return; v.project = result.project; v.exportOperation = null; updateList(v); await renderOutputs(v);
      report(v, result.job.status === 'completed' ? 'สร้างไฟล์แล้ว เปิดแก้ไขหรือดาวน์โหลดได้' : 'บันทึกคำขอแล้ว ตรวจสถานะในรายการไฟล์');
    } catch (failure) { report(v, friendly(failure), true); } finally { if (current(v)) busy(v, false); }
  }
  const dueLabel = task => new Date(task.dueAt).toLocaleString('th-TH', { timeZone: task.timeZone || 'Asia/Bangkok' });
  function renderTasks(v) {
    const root = q(v, '[data-work-tasks]'); root.replaceChildren();
    for (const task of v.project?.tasks || []) {
      const card = el('div', null, { class: 'wa-card' }); card.append(el('h3', task.title), el('p', dueLabel(task) + ' · ' + task.timeZone + (task.assignee ? ' · ' + task.assignee : '')),
        el('p', task.status === 'active' ? task.reminderId ? 'เตือนทางอีเมลก่อน ' + task.remindBeforeMinutes + ' นาที' : 'ไม่มีการเตือนทางอีเมล' : task.status === 'completed' ? 'เสร็จแล้ว' : 'ยกเลิกแล้ว'));
      if (task.status === 'active') { const actions = el('div', null, { class: 'wa-actions' }); actions.append(button('แก้ไข / เลื่อนกำหนด', () => taskDialog(v, task)), button('ทำเสร็จแล้ว', () => taskDecision(v, task, 'complete')), button('ยกเลิกงาน', () => taskDecision(v, task, 'cancel'))); card.append(actions); }
      root.append(card);
    }
    if (!root.children.length) root.append(el('p', 'ยังไม่มีรายการงาน ใช้ “แยกรายการงาน” จากข้อมูลต้นทาง หรือเพิ่มเองได้'));
  }
  function renderProposals(v, proposals) {
    const root = q(v, '[data-work-proposals]'); root.replaceChildren();
    for (const proposal of proposals) { const row = el('div', null, { class: 'wa-card' }); row.append(el('p', proposal.title + (proposal.assignee ? ' · ' + proposal.assignee : '')), el('small', 'ข้อเสนอจาก AI · ยังไม่ได้บันทึกนัดหรือตั้งเตือน'), button('ตรวจวันเวลาและบันทึก', () => taskDialog(v, proposal))); root.append(row); }
  }
  async function submitTask(v, payload, dialog, submit) {
    if (submit.disabled) return;
    submit.disabled = true;
    try { await save(v); const result = await post(v, base(v) + '/tasks', { ...payload, expectedVersion: v.project.version, confirmed: true });
      if (!current(v)) return; v.project = result.project; renderTasks(v); updateList(v); dialog.close(); report(v, 'บันทึกรายการงาน ปฏิทิน และการเตือนที่ผูกกันแล้ว');
    } catch (failure) { if (current(v)) { q(v, '[data-task-error]').textContent = friendly(failure); submit.disabled = false; } }
  }
  function taskDialog(v, original = {}) {
    if (v.busy) return report(v, friendly(Error('work_busy')), true);
    const dialog = q(v, '[data-work-dialog]'); dialog.replaceChildren();
    const title = el('input', null, { maxlength: '240', required: '' }), due = el('input', null, { type: 'datetime-local', required: '' }), assignee = el('input', null, { maxlength: '120' }), details = el('textarea', null, { maxlength: '1000' }), offset = el('select'), consent = el('input', null, { type: 'checkbox' });
    title.value = original.title || ''; assignee.value = original.assignee || ''; details.value = original.details || ''; consent.checked = original.emailConsent === true;
    if (original.dueAt && Number.isFinite(Date.parse(original.dueAt))) due.value = new Date(Date.parse(original.dueAt) + 7 * 3600000).toISOString().slice(0, 16);
    for (const [value, label] of [['', 'ไม่ส่งอีเมลเตือน'], ['0', 'เมื่อถึงกำหนด'], ['30', 'ก่อน 30 นาที'], ['60', 'ก่อน 1 ชั่วโมง'], ['1440', 'ก่อน 1 วัน']]) offset.append(el('option', label, { value }));
    if (original.remindBeforeMinutes != null && ![0,30,60,1440].includes(original.remindBeforeMinutes)) offset.append(el('option', 'ก่อน ' + original.remindBeforeMinutes + ' นาที', { value: original.remindBeforeMinutes }));
    offset.value = original.remindBeforeMinutes == null ? '' : String(original.remindBeforeMinutes);
    dialog.append(el('h2', original.id ? 'แก้ไขรายการงานและการเตือน' : 'ตรวจรายการก่อนบันทึก'));
    for (const [name, input] of [['ชื่องาน', title], ['กำหนดส่ง · เวลาไทย (Asia/Bangkok)', due], ['ผู้รับผิดชอบ (ชื่อสำหรับอ้างอิง ไม่มีการส่งคำเชิญ)', assignee], ['รายละเอียด', details], ['การเตือน', offset]]) { const label = el('label', name); input.setAttribute('aria-label', name); label.append(input); dialog.append(label); }
    const label = el('label', null, { class: 'wa-file' }); label.append(consent, el('span', 'ยืนยันให้ส่งการเตือนถึงอีเมลที่ยืนยันแล้วของบัญชีฉัน')); dialog.append(label, el('p', '', { 'data-task-error': '', role: 'alert' }));
    const taskId = original.id || crypto.randomUUID(), operationId = crypto.randomUUID();
    const submit = button('ยืนยันและบันทึก', () => {
      if (!title.reportValidity() || !due.reportValidity()) return;
      submitTask(v, { action: original.id ? 'update' : 'create', taskId, operationId,
        task: { title: title.value, dueAt: due.value + ':00+07:00', timeZone: 'Asia/Bangkok', assignee: assignee.value, details: details.value, remindBeforeMinutes: offset.value === '' ? null : Number(offset.value), emailConsent: consent.checked } }, dialog, submit);
    }, { class: 'wa-primary' });
    dialog.append(submit, button('ยกเลิก', () => dialog.close())); dialog.showModal();
  }
  function taskDecision(v, task, action) {
    const dialog = q(v, '[data-work-dialog]'); dialog.replaceChildren(el('h2', action === 'complete' ? 'ยืนยันว่าทำงานเสร็จแล้ว' : 'ยืนยันยกเลิกรายการงาน'), el('p', task.title), el('p', 'การเตือนที่ยังไม่เริ่มส่งจะถูกยกเลิกพร้อมรายการในปฏิทิน'), el('p', '', { 'data-task-error': '', role: 'alert' }));
    const payload = { taskId: task.id, operationId: crypto.randomUUID(), action }, submit = button('ยืนยัน', () => submitTask(v, payload, dialog, submit)); dialog.append(submit, button('กลับ', () => dialog.close())); dialog.showModal();
  }
  async function refresh(v) {
    if (v.busy) throw Error('work_busy');
    if (v.project) await save(v);
    const [data, files] = await Promise.all([api(v, '/api/work'), api(v, '/api/files')]); if (!current(v)) return;
    v.projects = data.projects; v.files = files.files || []; updateList(v); renderFiles(v);
    if (v.project) { const p = v.projects.find(p => p.id === v.project.id); if (p && !v.dirty) paint(v, p); }
    else if (v.projects.length) paint(v, v.projects[0]); else await newProject(v);
  }
  async function voice(v) {
    try { await save(v); const live = window.PanthoriumLiveVoice; if (!live) throw Error('voice_unavailable');
      if (!live.isActive()) await live.toggle('work-assistant');
      if (current(v)) live.sendText?.('บริบทที่ผู้ใช้เลือก: แฟ้มงาน projectId=' + v.project.id + ' version=' + v.project.version + ' ให้ใช้ work.read อ่านข้อมูลล่าสุด และรอฟังคำสั่งถัดไป การเขียนไฟล์ บันทึกงาน และตั้งเตือนต้องแสดงรายละเอียดให้ผู้ใช้ยืนยันตามปกติ');
    } catch (failure) { report(v, friendly(failure), true); }
  }
  function cleanup(v) {
    if (!v) return; if (v.dirty && allowed() && v.owner === owner()) recovery(v); clearTimeout(v.saveTimer); v.analysis?.abort(); v.controller.abort();
    for (const url of v.urls) URL.revokeObjectURL(url); v.urls.clear(); v.root.replaceChildren(); if (view === v) view = null;
  }
  function open() {
    if (!allowed()) { window.PanthoriumAccounts?.openLogin?.(); return false; }
    if (view && current(view)) { window.PanthoriumWindowManager?.restore?.(ID); if (typeof focusWindow === 'function') focusWindow(ID); return view.root; }
    if (view) cleanup(view); if (typeof createWindow !== 'function') return false;
    createWindow(ID, 'ผู้ช่วยงาน', markup(), { width: 1160, height: 820, onClose: () => cleanup(view) });
    const root = document.querySelector('.window[data-id="work-assistant"] [data-work]'); if (!root) return false;
    const v = view = { root, owner: owner(), controller: new AbortController(), urls: new Set(), files: [], projects: [], project: null, selected: new Set(), editSeq: 0, loadSeq: 0, dirty: false, busy: false, approvals: new Set() };
    const guard = fn => async () => { try { await fn(); } catch (failure) { report(v, friendly(failure), true); } };
    for (const key of ['title', 'template', 'text', 'draft']) q(v, '[data-work-' + key + ']').addEventListener('input', () => changed(v));
    q(v, '[data-work-local]').onchange = () => { if (q(v, '[data-work-local]').checked) recovery(v); else clearRecovery(v); };
    q(v, '[data-work-new]').onclick = guard(() => newProject(v)); q(v, '[data-work-save]').onclick = guard(() => save(v)); q(v, '[data-work-refresh]').onclick = guard(() => refresh(v));
    q(v, '[data-work-projects]').onchange = guard(() => q(v, '[data-work-projects]').value && load(v, q(v, '[data-work-projects]').value));
    q(v, '[data-work-search]').oninput = () => updateList(v); q(v, '[data-work-voice]').onclick = () => voice(v);
    q(v, '[data-work-copy]').onclick = guard(() => newProject(v, { ...patch(v), title: patch(v).title.slice(0, 145) + ' (ร่างกู้คืน)' }));
    q(v, '[data-work-reload]').onclick = guard(async () => { recovery(v); const result = await api(v, base(v)); paint(v, result.project); report(v, 'โหลดฉบับบนระบบแล้ว ร่างบนอุปกรณ์ยังเลือกกู้คืนได้'); });
    q(v, '[data-work-add-task]').onclick = () => taskDialog(v); q(v, '[data-work-stop]').onclick = () => v.analysis?.abort();
    const modes = [['summary', 'สรุปไฟล์'], ['question', 'ถามจากข้อมูล'], ['draft', 'ร่างเอกสาร'], ['rewrite', 'ปรับภาษา'], ['translate', 'แปลภาษา'], ['tasks', 'แยกรายการงาน']];
    for (const [mode, title] of modes) q(v, '[data-work-modes]').append(button(title, () => analyze(v, mode), { 'data-work-mode': mode }));
    for (const node of root.querySelectorAll('[data-work-export]')) node.onclick = () => exportDraft(v, node.dataset.workExport);
    q(v, '[data-work-upload]').onchange = guard(async () => {
      if (v.busy) return;
      const input = q(v, '[data-work-upload]'), pending = [...input.files], projectId = v.project.id;
      if (pending.some(file => file.size > 6 * 1024 * 1024)) throw Error('work_source_too_large');
      if (pending.length + v.selected.size > 6) return report(v, 'เลือกไฟล์ต้นทางรวมได้ไม่เกิน 6 ไฟล์', true);
      busy(v, true); report(v, 'กำลังเพิ่มไฟล์ลงแฟ้มงานนี้');
      try {
        for (const file of pending) {
          const body = await file.arrayBuffer(); if (!current(v) || v.project.id !== projectId) return;
          const result = await api(v, '/api/files', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-file-content-type': file.type || 'application/octet-stream' } });
          if (!current(v) || v.project.id !== projectId) return;
          v.files.unshift(result.file); v.selected.add(result.file.id); renderFiles(v); changed(v);
        }
        await save(v);
      } finally { input.value = ''; if (current(v)) busy(v, false); }
    });
    refresh(v).catch(failure => report(v, friendly(failure), true)); return root;
  }
  function installMenu() {
    const menu = document.getElementById('sm-apps'); if (!menu) return;
    let node = menu.querySelector('[data-app-id="work-assistant"]');
    if (!allowed()) { node?.remove(); return; }
    if (!node) { node = button('ผู้ช่วยงาน', () => { open(); if (typeof closeStartMenu === 'function') closeStartMenu(); }, { class: 'sm-app', 'data-app-id': ID, 'data-search-text': 'ผู้ช่วยงาน เอกสาร รายงาน แปล สรุป ไฟล์ work assistant' }); menu.prepend(node); }
    if (!menuObserver && window.MutationObserver) { menuObserver = new MutationObserver(installMenu); menuObserver.observe(menu, { childList: true }); }
  }
  function authChanged() {
    const next = owner();
    if (next !== lastOwner || !allowed()) {
      try { for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX + lastOwner + ':')) localStorage.removeItem(key); } catch { /* Storage is optional. */ }
      cleanup(view); document.querySelector('.window[data-id="work-assistant"]')?.remove(); lastOwner = next;
    }
    installMenu();
  }
  async function review(result) {
    if (!allowed() || !['work.save', 'work.draft', 'work.export', 'work.task'].includes(result?.toolId) || result.requiresConfirmation !== true || result.confirmation?.toolId !== result.toolId || !/^[a-f0-9]{64}$/i.test(result.confirmation?.approvalHash || '') || !/^[a-f0-9-]{36}$/i.test(result.confirmation?.actionId || '')) return false;
    open(); const v = view, confirmation = result.confirmation;
    if (!current(v) || v.approvals.has(confirmation.actionId)) return false; v.approvals.add(confirmation.actionId);
    const args = confirmation.args || {}, card = el('div', null, { class: 'wa-card' });
    card.append(el('h2', { 'work.save': 'ยืนยันบันทึกแฟ้มงาน', 'work.draft': 'ยืนยันประมวลผลและบันทึกร่าง', 'work.export': 'ยืนยันสร้างไฟล์จากร่าง', 'work.task': 'ยืนยันเปลี่ยนรายการงานและการเตือน' }[result.toolId]));
    if (result.toolId === 'work.draft') card.append(el('p', 'การประมวลผล AI ใช้โควตาตามแพ็กเกจ'));
    let selected = v.projects.find(p => p.id === args.projectId);
    if (args.projectId) {
      try { selected = (await api(v, '/api/work/' + encodeURIComponent(args.projectId))).project; }
      catch (failure) { if (current(v)) { card.append(el('p', friendly(failure))); q(v, '[data-work-approvals]').append(card); } return false; }
      if (!current(v)) return false;
      card.append(el('p', 'แฟ้มงาน: ' + selected.title + ' · ฉบับที่ขอใช้: ' + args.expectedVersion));
      if (selected.version !== args.expectedVersion) { card.append(el('p', 'แฟ้มงานมีฉบับใหม่แล้ว กรุณาสั่งใหม่เพื่อใช้ข้อมูลล่าสุด')); q(v, '[data-work-approvals]').append(card); return false; }
    }
    const fields = { title: 'ชื่อ', text: 'ข้อความต้นทาง', draft: 'ร่างที่จะบันทึก', instruction: 'คำสั่ง', dueAt: 'กำหนดส่ง', timeZone: 'เขตเวลา', assignee: 'ผู้รับผิดชอบ', details: 'รายละเอียด' };
    const values = { ...args, ...(args.patch || {}), ...(args.task || {}) };
    for (const [key, label] of Object.entries(fields)) if (typeof values[key] === 'string') card.append(el('h3', label), el('pre', values[key]));
    if (args.mode) card.append(el('p', 'งานที่ให้ช่วย: ' + ({ summary: 'สรุป', question: 'ตอบจากข้อมูล', draft: 'ร่างเอกสาร', rewrite: 'ปรับภาษา', translate: 'แปล', tasks: 'เสนอรายการงาน' })[args.mode]));
    if (args.pluginId) { card.append(el('p', 'ไฟล์: ' + ({ document: 'Word', spreadsheet: 'Excel', presentation: 'PowerPoint' })[args.pluginId])); const draft = el('details'); draft.append(el('summary', 'ร่างที่จะใช้สร้างไฟล์'), el('pre', selected?.draft || '')); card.append(draft); }
    if (args.patch?.sourceFileIds) card.append(el('p', 'ไฟล์ต้นทาง: ' + args.patch.sourceFileIds.map(id => v.files.find(f => f.id === id)?.name || id).join(', ')));
    if (args.taskId) { const task = selected?.tasks.find(task => task.id === args.taskId); card.append(el('p', 'รายการเดิม: ' + (task?.title || 'ไม่พบรายการ') + (task ? ' · ' + dueLabel(task) : ''))); }
    if (args.action) card.append(el('p', 'การเปลี่ยนแปลง: ' + ({ create: 'เพิ่มงาน', update: 'แก้ไขงาน', complete: 'ทำเสร็จและยกเลิกการเตือนที่ค้าง', cancel: 'ยกเลิกงานและการเตือนที่ค้าง' })[args.action]));
    if (args.task) card.append(el('p', args.task.remindBeforeMinutes == null ? 'ไม่ส่งอีเมลเตือน' : 'เตือนก่อน ' + args.task.remindBeforeMinutes + ' นาที · ส่งถึงอีเมลบัญชีนี้ · ' + (args.task.emailConsent === true ? 'ยืนยันการรับอีเมล' : 'ยังไม่ได้ยืนยันการรับอีเมล')));
    const status = el('p', '', { role: 'status' }), approve = button('ยืนยัน', () => run(false)), reject = button('ยกเลิก', () => run(true));
    const run = async cancel => { approve.disabled = reject.disabled = true;
      try { const data = await post(v, '/api/actions/' + confirmation.actionId + (cancel ? '/cancel' : '/confirm'), cancel ? {} : { approvalHash: confirmation.approvalHash });
        if (!current(v)) return; card.replaceChildren(el('p', cancel ? 'ยกเลิกคำสั่งแล้ว' : 'ดำเนินการตามคำสั่งแล้ว'));
        if (!cancel) await receiveOutput(v, data.output, args.projectId);
      } catch (failure) { if (current(v)) { status.textContent = friendly(failure); approve.disabled = reject.disabled = false; } }
    };
    if (Date.parse(confirmation.approvalExpiresAt) <= Date.now()) { approve.disabled = true; status.textContent = 'คำขอหมดอายุ กรุณาสั่งใหม่'; }
    card.append(status, approve, reject); q(v, '[data-work-approvals]').append(card); return true;
  }
  window.PanthoriumWorkAssistant = Object.freeze({ open, review, refresh: () => view && refresh(view) });
  async function receiveOutput(v, output, requestedProjectId) {
    const id = output?.projectId || output?.project?.id || requestedProjectId;
    if (!current(v)) return;
    if (!v.dirty && !v.busy) await refresh(v);
    if (!current(v) || id && v.project?.id !== id) return;
    if (output?.saved === false && typeof output.draft === 'string') {
      const card = el('div', null, { class: 'wa-card' });
      card.append(el('p', 'แฟ้มงานเปลี่ยนระหว่างประมวลผล ผลใหม่ยังไม่ได้บันทึก ตรวจเทียบกับร่างปัจจุบันก่อนใช้'), el('pre', output.draft), button('นำผลใหม่มาแก้ไข', () => { q(v, '[data-work-draft]').value = output.draft; changed(v); card.remove(); }));
      q(v, '[data-work-evidence]').append(card);
    }
    if (output?.proposedTasks) renderProposals(v, output.proposedTasks);
  }
  window.addEventListener('panthorium:ai-done', event => {
    for (const result of event.detail?.toolResults || []) if (String(result.toolId || '').startsWith('work.')) {
      if (result.requiresConfirmation) review(result);
      else if (result.ok && view && current(view)) receiveOutput(view, result.output).catch(failure => view && report(view, friendly(failure), true));
    }
  });
  window.addEventListener('beforeunload', event => { if (view?.dirty) { recovery(view); event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('online', () => { if (view?.dirty && current(view)) save(view).catch(e => report(view, friendly(e), true)); });
  for (const name of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:boot-complete']) window.addEventListener(name, authChanged);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMenu, { once: true }); else installMenu();
})();
