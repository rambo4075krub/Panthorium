/* Shared, account-scoped client for the Panthorium creative plugin runtime. */
(function () {
  'use strict';
  const ID = 'creative-studio';
  const PLUGINS = [
    { id: 'image', title: 'รูปภาพ', icon: 'image', output: 'สร้างภาพจากคำอธิบาย', example: 'สร้างภาพสินค้าโทนส้มบนพื้นหลังสีเข้ม แสงสตูดิโอ อัตราส่วน 16:9' },
    { id: 'video', title: 'วิดีโอ', icon: 'video', output: 'สร้างวิดีโอจากคำอธิบาย', example: 'สร้างวิดีโอแนะนำสินค้า กล้องเคลื่อนเข้าช้า ๆ แสงอบอุ่น ความยาว 8 วินาที' },
    { id: 'document', title: 'เอกสาร', icon: 'document', output: 'เอกสารแก้ไขได้ พร้อมฉบับสำหรับพิมพ์', example: 'จัดทำรายงานภาษาไทยจากไฟล์ที่เลือก มีบทสรุป หัวข้อหลัก และข้อเสนอแนะ' },
    { id: 'spreadsheet', title: 'ตาราง', icon: 'chart', output: 'ตารางข้อมูลและไฟล์สำหรับพิมพ์', example: 'สร้างตารางวางแผนค่าใช้จ่ายรายเดือน แยกหมวด จำนวนเงิน และยอดรวม' },
    { id: 'presentation', title: 'งานนำเสนอ', icon: 'presentation', output: 'สไลด์แก้ไขได้ พร้อมฉบับสำหรับพิมพ์', example: 'สร้างงานนำเสนอภาษาไทย 6 สไลด์จากข้อมูลที่เลือก มีบทสรุปและขั้นตอนถัดไป' }
  ];
  const os = () => typeof OS === 'undefined' ? null : OS;
  const principal = () => String(os()?.state?.user?.sub || os()?.state?.user?.id || '');
  const allowed = () => !!principal() && !/^guest[:_-]/i.test(principal()) && !(os()?.state?.user?.roles || []).includes('guest') && (os()?.state?.user?.permissions || []).includes('chat');
  const identity = () => JSON.stringify([principal(), [...(os()?.state?.user?.roles || [])].sort(), [...(os()?.state?.user?.permissions || [])].sort()]);
  const el = (tag, text, attrs = {}) => { const node = document.createElement(tag); if (text != null) node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
  const button = (text, handler, attrs = {}) => { const node = el('button', text, { type: 'button', ...attrs }); node.onclick = handler; return node; };
  const plugin = id => PLUGINS.find(item => item.id === id);
  const sourceLimit = id => id === 'video' ? 1 : id === 'image' ? 3 : 6;
  const promptLimit = id => id === 'video' ? 1600 : id === 'image' ? 12000 : 8000;
  function sourceCompatible(file, id) {
    const type = String(file.contentType || '').toLowerCase(), name = String(file.name || '');
    if (id === 'image') return ['image/png', 'image/jpeg', 'image/webp'].includes(type);
    if (id === 'video') return ['image/png', 'image/jpeg'].includes(type);
    if (/^image\//.test(type)) return id !== 'spreadsheet' && ['image/png', 'image/jpeg'].includes(type);
    return /\.(docx|xlsx|pptx|txt|csv|tsv|md|json)$/i.test(name) || /^(text\/(plain|csv|tab-separated-values|markdown)|application\/json)$/.test(type);
  }
  const stateName = value => ({ queued: 'อยู่ในคิว', running: 'กำลังทำงาน', completed: 'เสร็จแล้ว', failed: 'ไม่สำเร็จ', needs_review: 'ยังยืนยันผลไม่ได้ · หยุดเพื่อกันงานซ้ำ', blocked: 'หยุดเพราะขั้นตอนก่อนหน้าไม่สำเร็จ' })[value] || 'กำลังตรวจสถานะ';
  const terminal = job => !['queued', 'running'].includes(job.status);
  let view = null, generation = 0, lastIdentity = identity(), menuObserver = null;
  const current = v => view === v && v.root.isConnected && v.owner === principal() && v.generation === generation && allowed();
  const messages = {
    office_tabular_data_required: 'ยังไม่ได้ข้อมูลเป็นตาราง จึงยังไม่มีไฟล์ กรุณาแนบ CSV/XLSX หรือระบุหัวคอลัมน์และข้อมูล ถ้าต้องการแบบฟอร์มเปล่า ให้สั่ง เช่น สร้างตารางวางแผนค่าใช้จ่ายรายเดือน',
    invalid_office_ai_output: 'AI ส่งเนื้อหากลับมาในรูปแบบที่สร้างไฟล์ไม่ได้ ยังไม่มีไฟล์จากขั้นตอนนี้ กรุณาปรับคำสั่งแล้วสร้างใหม่',
    invalid_office_content: 'โครงสร้างเอกสารที่ AI ส่งกลับมายังไม่ถูกต้อง จึงยังสร้างไฟล์ไม่ได้',
    office_drafting_failed: 'บริการร่างเอกสารไม่สำเร็จ ยังไม่มีไฟล์จากขั้นตอนนี้',
    office_table_columns_mismatch: 'จำนวนคอลัมน์ของแต่ละแถวไม่ตรงกัน กรุณาตรวจตารางต้นทาง',
    preview_too_large: 'ไฟล์ใหญ่เกินขนาดตัวอย่าง กรุณาดาวน์โหลดเพื่อเปิดดู',
    account_required: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', account_changed: 'บัญชีเปลี่ยนแล้ว กรุณาเปิดสตูดิโออีกครั้ง',
    session_expired: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', studio_plugin_disabled: 'ปลั๊กอินนี้ตั้งค่าเป็น Never เปลี่ยนเป็น Auto ก่อนใช้งาน',
    plugin_disabled: 'ปลั๊กอินนี้ตั้งค่าเป็น Never เปลี่ยนเป็น Auto ก่อนใช้งาน', plugin_unavailable: 'ปลั๊กอินนี้ยังไม่พร้อมใช้งาน',
    files_storage_unconfigured: 'พื้นที่เก็บไฟล์ยังไม่พร้อมใช้งาน', file_not_found: 'ไม่พบไฟล์ หรือคุณไม่มีสิทธิ์เข้าถึงไฟล์นี้',
    studio_database_unavailable: 'ระบบเก็บประวัติงานยังไม่พร้อมใช้งาน', studio_job_not_found: 'ไม่พบงานนี้ในบัญชีของคุณ',
    video_generation_unavailable: 'บริการสร้างวิดีโอยังไม่พร้อมใช้งาน', image_generation_unavailable: 'บริการสร้างรูปภาพยังไม่พร้อมใช้งาน',
    generation_confirmation_required: 'โปรดยืนยันการใช้บริการสร้างสื่อ', studio_confirmation_required: 'โปรดยืนยันการใช้บริการสร้างสื่อ',
    studio_idempotency_conflict: 'คำขอนี้เปลี่ยนไปแล้ว กรุณาตรวจข้อมูลแล้วส่งใหม่', studio_job_busy: 'งานนี้กำลังประมวลผล โปรดรอสักครู่',
    network_error: 'เชื่อมต่อไม่สำเร็จ ลองอีกครั้งได้โดยไม่สร้างคำขอซ้ำ', source_limit: 'เลือกไฟล์ต้นทางได้ไม่เกิน 6 ไฟล์',
    studio_source_unsupported: 'รูปแบบไฟล์ต้นทางนี้ยังไม่รองรับสำหรับเครื่องมือที่เลือก',
    studio_storage_unconfigured: 'ยังไม่ได้ตั้งค่าพื้นที่เก็บงานสร้างสรรค์บนคลาวด์', office_generation_unavailable: 'บริการสร้างเอกสารยังไม่พร้อมใช้งาน', unsupported_office_source: 'เอกสารต้นทางนี้ยังไม่รองรับ ใช้ DOCX, XLSX, PPTX, TXT, CSV, TSV, Markdown หรือ JSON', unsupported_office_image: 'เอกสารรองรับภาพประกอบ PNG และ JPEG', video_image_source_required: 'วิดีโอใช้ภาพต้นทาง PNG หรือ JPEG ได้ครั้งละ 1 ภาพ'
  };
  function friendly(error) { return messages[error?.message || error] || String(error?.message || error || 'ดำเนินการไม่สำเร็จ'); }
  function status(v, text, error = false) { if (!current(v)) return; const node = v.root.querySelector('[data-studio-status]'); node.textContent = text; node.dataset.error = String(error); }
  async function api(v, path, options = {}, raw = false) {
    if (!current(v)) throw Error('account_changed');
    const send = () => {
      if (!current(v)) throw Error('account_changed');
      return fetch(String(os()?.config?.backendUrl || '').replace(/\/$/, '') + path, {
        ...options, signal: v.controller.signal, credentials: 'include', cache: 'no-store',
        headers: { ...(os()?.config?.accessToken ? { Authorization: 'Bearer ' + os().config.accessToken } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
      });
    };
    let response;
    try { response = await send(); } catch (error) { if (!current(v) || error.name === 'AbortError') throw error; throw Error('network_error'); }
    if (response.status === 401 && current(v) && window.PanthoriumAuth?.refreshSession) {
      const refreshed = await window.PanthoriumAuth.refreshSession().catch(() => false);
      if (!current(v)) throw Error('account_changed');
      if (refreshed) response = await send();
    }
    if (!current(v)) throw Error('account_changed');
    if (raw && response.ok) return response;
    const data = await response.json().catch(() => ({}));
    if (!current(v)) throw Error('account_changed');
    if (!response.ok || data.ok === false) { const error = Error(response.status === 401 ? 'session_expired' : data.error || 'HTTP ' + response.status); error.status = response.status; throw error; }
    return data;
  }
  const post = (v, path, body) => api(v, path, { method: 'POST', body: JSON.stringify(body) });
  const markup = () => `<div data-studio data-studio-active="image">
    <style>
      [data-studio]{height:100%;box-sizing:border-box;overflow:auto;padding:24px;color:var(--text,#f4f1ee);background:radial-gradient(ellipse at 95% 0,rgba(245,126,54,.09),transparent 45%),var(--bg,#0c1017);font:14px/1.5 system-ui,sans-serif}
      [data-studio] *{box-sizing:border-box}[data-studio] h1{font-size:28px;letter-spacing:-.6px;margin:4px 0 6px}[data-studio] h2{font-size:18px;margin:0 0 12px}[data-studio] h3{font-size:15px;margin:0}[data-studio] p{margin:8px 0}[data-studio] small,.cs-muted{color:var(--text-dim,#aab0bd)}
      [data-studio] header{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:22px}[data-studio] .cs-eyebrow{font-size:10px;font-weight:700;letter-spacing:2px;color:#ffaf7b}[data-studio] .cs-head-actions,[data-studio] .cs-actions{display:flex;gap:8px;flex-wrap:wrap}
      [data-studio] button,[data-studio] input,[data-studio] textarea,[data-studio] select{font:inherit;border:1px solid rgba(174,183,197,.23);border-radius:10px;background:#151c26;color:#f4f1ee;padding:10px 12px}
      [data-studio] button{cursor:pointer;min-height:42px}[data-studio] button:hover:not(:disabled){border-color:#f8a16c;background:#20242c}[data-studio] button:disabled{opacity:.45;cursor:not-allowed}[data-studio] :focus-visible{outline:2px solid #ffad79;outline-offset:3px}
      [data-studio] option{background:#151c26;color:#f4f1ee}[data-studio] input[type=checkbox]{width:18px;height:18px;accent-color:#f6965b;flex:none}[data-studio] textarea{resize:vertical;width:100%;min-height:154px;line-height:1.7}[data-studio] input:not([type=checkbox]),[data-studio] select{width:100%}
      [data-studio] .cs-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:20px}[data-studio] .cs-tabs button{display:flex;gap:9px;align-items:center;justify-content:center;padding:12px 8px;background:rgba(255,255,255,.025)}
      [data-studio] .cs-tabs button[aria-selected=true]{background:rgba(245,142,74,.13);border-color:#f2a06d;color:#ffd4b8}[data-studio] svg{width:20px;height:20px;flex:none}[data-studio] .cs-layout{display:grid;grid-template-columns:minmax(300px,1.05fr) minmax(320px,1fr);gap:20px;align-items:start}
      [data-studio] .cs-panel{border:1px solid rgba(174,183,197,.18);border-radius:16px;background:rgba(255,255,255,.025);padding:20px;min-width:0}[data-studio] label{display:block;margin:14px 0 6px}[data-studio] label>input,[data-studio] label>select,[data-studio] label>textarea{margin-top:7px}
      [data-studio] .cs-field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}[data-studio] .cs-primary{background:#eb965e;color:#16120e;border-color:#eb965e;font-weight:700}[data-studio] .cs-primary:hover:not(:disabled){background:#ffae7a;color:#16120e}[data-studio] .cs-check{display:flex;gap:9px;align-items:start;cursor:pointer}[data-studio] .cs-check input{margin:3px 0 0}
      [data-studio] .cs-files{max-height:180px;overflow:auto;padding:2px 0 8px}[data-studio] .cs-files label{margin:8px 0;font-size:12px;overflow-wrap:anywhere}[data-studio] .cs-files small{display:block}[data-studio] .cs-capability{padding:10px 12px;background:rgba(245,142,74,.07);border-left:2px solid #f2a06d;border-radius:5px;font-size:12px;margin:14px 0}
      [data-studio] [data-studio-status]{min-height:24px;margin:14px 0;color:#ffd3ac;overflow-wrap:anywhere}[data-studio] [data-studio-status][data-error=true]{color:#ffa7a7}[data-studio] .cs-history-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}[data-studio] .cs-history-title h2{margin:0}
      [data-studio] .cs-job{border-top:1px solid rgba(174,183,197,.18);padding:16px 0}[data-studio] .cs-job:first-child{border-top:0;padding-top:2px}[data-studio] .cs-job-head{display:flex;justify-content:space-between;gap:8px;align-items:start}[data-studio] .cs-job p{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}[data-studio] .cs-badge{font-size:11px;border:1px solid #6a543f;border-radius:20px;padding:3px 9px;white-space:nowrap;color:#ffca9b}[data-studio] .cs-badge[data-state=completed]{border-color:#3e6b53;color:#a5e9bc}[data-studio] .cs-badge[data-state=failed]{border-color:#81494c;color:#ffb6b9}
      [data-studio] .cs-steps{padding-left:20px;font-size:12px;color:var(--text-dim,#aab0bd)}[data-studio] .cs-result{border:1px solid rgba(174,183,197,.16);border-radius:10px;padding:10px;margin:9px 0}[data-studio] .cs-result-name{display:block;font-size:12px;overflow-wrap:anywhere;margin-bottom:8px}[data-studio] .cs-result button{font-size:11px;min-height:34px;padding:6px 9px}[data-studio] .cs-next{border-top:1px solid rgba(174,183,197,.18);margin-top:18px;padding-top:4px}[data-studio] [hidden]{display:none!important}
      @media(max-width:900px){[data-studio]{padding:16px}[data-studio] .cs-layout{grid-template-columns:1fr}[data-studio] header{align-items:start}[data-studio] h1{font-size:24px}}
      @media(max-width:540px){[data-studio]{padding:12px}[data-studio] header{display:block}[data-studio] .cs-head-actions{margin-top:12px}[data-studio] .cs-tabs{gap:5px}[data-studio] .cs-tabs button{flex-direction:column;font-size:10px;gap:4px;padding:9px 3px}[data-studio] .cs-panel{padding:14px}[data-studio] .cs-field-row{grid-template-columns:1fr}}
      [data-studio] .cs-preview{margin-bottom:22px;border:1px solid rgba(246,150,91,.3);border-radius:12px;overflow:hidden;background:rgba(0,0,0,.15)}
      [data-studio] .cs-preview-heading{padding:14px;display:flex;justify-content:space-between;gap:8px;align-items:start}[data-studio] .cs-preview-heading h2{margin:0}
      [data-studio] .cs-preview-body{min-height:190px;max-height:600px;overflow:auto;padding:12px;overflow-wrap:anywhere}
      [data-studio] .cs-preview-body img,[data-studio] .cs-preview-body video{display:block;width:100%;max-height:520px;object-fit:contain;background:#080b10}
      [data-studio] .cs-preview-body iframe{display:block;width:100%;height:520px;border:0;background:white}
      [data-studio] .cs-preview-body pre{white-space:pre-wrap;overflow-wrap:anywhere}[data-studio] .cs-preview-note{padding:0 14px 12px;font-size:12px}
      [data-studio] .cs-job details{font-size:12px;overflow-wrap:anywhere;margin:8px 0}[data-studio] .cs-result-name{overflow-wrap:anywhere}
    </style>
    <header><div><span class="cs-eyebrow">PANTHORIUM / CREATIVE STUDIO</span><h1>สร้างสรรค์และเอกสาร</h1><p class="cs-muted">หนึ่งพื้นที่ทำงาน · สั่งผ่าน Sentinel AI หรือเริ่มจากเครื่องมือที่ต้องการ</p></div><div class="cs-head-actions"><button type="button" data-open-sentinel>เปิด Sentinel AI</button><button type="button" data-open-files>ไฟล์ของฉัน</button></div></header>
    <nav class="cs-tabs" role="tablist" aria-label="เครื่องมือสร้างสรรค์" data-studio-tabs></nav>
    <div class="cs-layout"><section class="cs-panel" role="tabpanel" id="studio-editor-panel" aria-labelledby="studio-tab-image">
      <h2 data-studio-title>รูปภาพ</h2><p class="cs-muted" data-studio-output></p><div class="cs-capability" data-studio-capability>กำลังตรวจความพร้อมของปลั๊กอิน…</div>
      <form data-studio-form><label>ชื่อผลงาน<input data-studio-name maxlength="120" placeholder="เช่น แผนงานเดือนนี้"></label><label>บอกสิ่งที่ต้องการ<textarea data-studio-prompt maxlength="12000" required></textarea></label>
      <div class="cs-field-row"><label>การเรียกใช้ปลั๊กอิน<select data-studio-mode aria-label="โหมดปลั๊กอิน"><option value="auto">Auto · อนุญาตให้เรียกใช้</option><option value="never">Never · ไม่อนุญาตให้เรียกใช้</option></select></label><label data-aspect-label>สัดส่วน<select data-studio-aspect><option value="16:9">16:9 · แนวนอน</option><option value="9:16">9:16 · แนวตั้ง</option><option value="1:1">1:1 · จัตุรัส</option></select></label><label data-duration-label hidden>ความยาววิดีโอ<select data-studio-duration><option value="8">8 วินาที</option><option value="6">6 วินาที</option><option value="4">4 วินาที</option></select></label></div>
      <label>ไฟล์ต้นทาง <small data-studio-source-limit>เลือกได้สูงสุด 6 ไฟล์</small></label><div class="cs-files" data-studio-files></div><button type="button" data-studio-refresh-files>โหลดรายการไฟล์ใหม่</button>
      <div class="cs-next"><label>ส่งผลลัพธ์ไปทำต่อ<select data-studio-next><option value="">จบที่เครื่องมือนี้</option></select></label><label data-next-prompt-label hidden>คำสั่งสำหรับขั้นตอนถัดไป<textarea data-studio-next-prompt maxlength="12000" rows="3" placeholder="เช่น นำภาพที่สร้างมาเป็นภาพประกอบงานนำเสนอ 5 สไลด์"></textarea></label></div>
      <label class="cs-check" data-confirm-label hidden><input type="checkbox" data-studio-confirm><span>ยืนยันเริ่มสร้างสื่อ โดยใช้โควตาหรือค่าใช้จ่ายของบริการที่เชื่อมต่อ</span></label>
      <p role="status" aria-live="polite" data-studio-status></p><button class="cs-primary" type="submit" data-studio-submit disabled>สร้างผลงาน</button><p><small data-studio-durability></small></p>
      </form></section>
      <section class="cs-panel"><section class="cs-preview" aria-label="ตัวอย่างผลงาน"><div class="cs-preview-heading"><div><h2>ตัวอย่างผลงาน</h2><small data-preview-name>ภาพ วิดีโอ และเอกสาร</small></div><button type="button" data-preview-close hidden>ปิดตัวอย่าง</button></div><div class="cs-preview-body" data-preview-body aria-live="polite"><p class="cs-muted">เมื่อมีผลงาน กด “เปิดดู” ที่ไฟล์ด้านล่าง ภาพ วิดีโอ และฉบับอ่านของเอกสารจะแสดงที่นี่</p></div><p class="cs-preview-note" data-preview-note></p></section><div data-studio-approvals></div><div class="cs-history-title"><h2>งานและผลงานของฉัน</h2><button type="button" data-studio-refresh>รีเฟรช</button></div><p class="cs-muted">กดเปิดดูเพื่อแสดงตัวอย่าง · ดาวน์โหลดไฟล์ Office เพื่อเปิดแก้ไข · ส่งต่อไปยังเครื่องมืออื่น</p><div data-studio-jobs></div></section></div>
    </div>`;
  function saveDraft(v) {
    if (!current(v)) return;
    const q = name => v.root.querySelector('[data-studio-' + name + ']');
    v.drafts[v.active] = { name: q('name').value, prompt: q('prompt').value, aspect: q('aspect').value, duration: q('duration').value, next: q('next').value, nextPrompt: q('next-prompt').value, confirmed: q('confirm').checked };
  }
  function controls(v) {
    if (!current(v)) return;
    const spec = v.catalog.find(item => item.id === v.active);
    const nextId = v.root.querySelector('[data-studio-next]').value;
    const next = v.catalog.find(item => item.id === nextId);
    const unavailable = !spec || spec.available !== true || spec.mode === 'never' || nextId && (!next || next.available !== true || next.mode === 'never');
    v.root.querySelector('[data-studio-submit]').disabled = v.busy || v.modeBusy || unavailable;
    v.root.querySelector('[data-studio-submit]').textContent = v.busy ? 'กำลังส่งคำขอ…' : nextId ? 'เริ่มงานต่อเนื่อง' : 'สร้างผลงาน';
    v.root.querySelector('[data-studio-mode]').disabled = v.busy || !spec || v.modeBusy;
    for (const node of v.root.querySelectorAll('[data-studio-form] input,[data-studio-form] textarea,[data-studio-next],[data-studio-aspect],[data-studio-duration]')) node.disabled = v.busy;
    for (const node of v.root.querySelectorAll('[data-studio-tabs] button')) node.disabled = v.busy || v.modeBusy;
  }
  function selectPlugin(v, id, sourceIds) {
    if (!current(v) || !plugin(id) || v.busy || v.modeBusy) return;
    saveDraft(v); v.active = id; v.root.dataset.studioActive = id;
    const shell = v.root.closest('.window'); if (shell) shell.dataset.studioActive = id;
    const selected = plugin(id), draft = v.drafts[id] || {}, q = name => v.root.querySelector('[data-studio-' + name + ']');
    v.root.querySelector('[role=tabpanel]').setAttribute('aria-labelledby', 'studio-tab-' + id);
    for (const tab of v.root.querySelectorAll('[data-studio-tabs] button')) { tab.setAttribute('aria-selected', String(tab.dataset.pluginId === id)); tab.tabIndex = tab.dataset.pluginId === id ? 0 : -1; }
    q('title').textContent = selected.title; q('output').textContent = selected.output + (['document', 'presentation'].includes(id) ? ' · ภาพแนบใช้เป็นภาพประกอบ โดยยังไม่วิเคราะห์เนื้อหาในภาพ' : '');
    q('name').value = draft.name || ''; q('prompt').value = draft.prompt || ''; q('prompt').placeholder = selected.example;
    q('prompt').maxLength = promptLimit(id); q('source-limit').textContent = 'เลือกได้สูงสุด ' + sourceLimit(id) + ' ไฟล์ · แสดงเฉพาะรูปแบบที่เลือกใช้ได้';
    q('aspect').value = draft.aspect || '16:9'; q('duration').value = draft.duration || '8'; q('confirm').checked = draft.confirmed === true;
    v.root.querySelector('[data-aspect-label]').hidden = !['image', 'video'].includes(id);
    q('aspect').querySelector('[value="1:1"]').disabled = id === 'video'; if (id === 'video' && q('aspect').value === '1:1') q('aspect').value = '16:9';
    v.root.querySelector('[data-duration-label]').hidden = id !== 'video'; v.root.querySelector('[data-confirm-label]').hidden = !['image', 'video'].includes(id);
    q('next').replaceChildren(el('option', 'จบที่เครื่องมือนี้', { value: '' }));
    const targets = id === 'image' ? ['video', 'document', 'presentation'] : id === 'spreadsheet' ? ['document', 'presentation'] : [];
    for (const target of targets) q('next').append(el('option', plugin(target).title, { value: target }));
    q('next').value = targets.includes(draft.next) ? draft.next : ''; q('next-prompt').value = draft.nextPrompt || '';
    q('next-prompt').maxLength = promptLimit(q('next').value);
    v.root.querySelector('[data-next-prompt-label]').hidden = !q('next').value;
    if (Array.isArray(sourceIds)) v.sources = new Set(sourceIds.slice(0, sourceLimit(id)));
    v.sources = new Set([...v.sources].filter(fileId => { const file = v.files.find(item => item.id === fileId); return !file || sourceCompatible(file, id); }).slice(0, sourceLimit(id)));
    renderFiles(v); renderCapability(v); controls(v);
  }
  function renderCapability(v) {
    if (!current(v)) return;
    const spec = v.catalog.find(item => item.id === v.active), node = v.root.querySelector('[data-studio-capability]');
    node.textContent = !spec ? 'ยังไม่ได้รับสถานะปลั๊กอิน กดรีเฟรชเพื่อตรวจอีกครั้ง' : spec.mode === 'never' ? 'Never · ปิดการเรียกใช้เครื่องมือนี้ ทั้งจากที่นี่และ Sentinel AI' : spec.available ? 'พร้อมใช้งาน · ใช้ไฟล์และประวัติงานร่วมกับ Sentinel AI' : 'ยังไม่พร้อม · ' + friendly(spec.reason || 'plugin_unavailable');
    v.root.querySelector('[data-studio-mode]').value = spec?.mode === 'never' ? 'never' : 'auto';
  }
  function renderFiles(v) {
    if (!current(v)) return;
    const list = v.root.querySelector('[data-studio-files]'); list.replaceChildren();
    if (!v.files.length) list.append(el('p', v.filesError || 'ยังไม่มีไฟล์ต้นทาง เปิด “ไฟล์ของฉัน” เพื่ออัปโหลด หรือสร้างผลงานจากคำสั่งได้เลย', { class: 'cs-muted' }));
    for (const file of v.files) {
      if (!sourceCompatible(file, v.active)) continue;
      const label = el('label', null, { class: 'cs-check' }), check = el('input', null, { type: 'checkbox', 'data-source-file-id': file.id });
      check.checked = v.sources.has(file.id); check.disabled = v.busy;
      check.onchange = () => { if (check.checked && v.sources.size >= sourceLimit(v.active)) { check.checked = false; status(v, 'เครื่องมือนี้เลือกไฟล์ต้นทางได้ไม่เกิน ' + sourceLimit(v.active) + ' ไฟล์', true); return; } if (check.checked) v.sources.add(file.id); else v.sources.delete(file.id); };
      const name = el('span', file.name || file.id); name.append(el('small', String(file.contentType || 'ไฟล์') + ' · ' + Math.ceil(Number(file.size || 0) / 1024) + ' KB')); label.append(check, name); const row = el('div'); row.append(label, button('เปิดดู', () => previewFile(v, file, v.jobs.find(job => job.files?.some(item => item.id === file.id))), { 'data-preview-source': file.id })); list.append(row);
    }
    if (v.files.length && !list.childElementCount) list.append(el('p', 'ยังไม่มีไฟล์ต้นทางที่เครื่องมือนี้รองรับ สร้างผลงานจากคำสั่งได้เลย', { class: 'cs-muted' }));
  }
  async function loadFiles(v) {
    try { const data = await api(v, '/api/files'); if (!current(v)) return; v.files = data.files || []; v.filesError = ''; renderFiles(v); }
    catch (error) { if (current(v)) { v.filesError = friendly(error); renderFiles(v); status(v, friendly(error), true); } }
  }
  function putJob(v, job) { if (!job?.id || !current(v)) return; const index = v.jobs.findIndex(item => item.id === job.id); if (index < 0) v.jobs.unshift(job); else v.jobs[index] = job; }
  async function download(v, file, source) {
    source.disabled = true;
    try {
      const response = await api(v, '/api/files/' + encodeURIComponent(file.id), {}, true), blob = await response.blob();
      if (!current(v)) return;
      const url = URL.createObjectURL(blob); v.urls.add(url);
      const link = el('a', null, { href: url, download: String(file.name || 'panthorium-file') }); link.hidden = true; document.body.append(link); link.click(); link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); v.urls.delete(url); v.urlTimers.delete(timer); }, 30000); v.urlTimers.add(timer);
    } catch (error) { status(v, friendly(error), true); }
    finally { if (current(v)) source.disabled = false; }
  }

  function clearPreview(v) {
    v.previewSequence = (v.previewSequence || 0) + 1;
    const body = v.root.querySelector('[data-preview-body]');
    body?.replaceChildren();
    if (v.previewUrl) { URL.revokeObjectURL(v.previewUrl); v.urls.delete(v.previewUrl); v.previewUrl = null; }
    return v.previewSequence;
  }
  function readableDocument(html) { return window.PanthoriumFilePreview.readableDocument(html); }
  async function previewFile(v, file, job = {}) {
    if (!current(v)) return;
    const sequence = clearPreview(v), body = v.root.querySelector('[data-preview-body]'), note = v.root.querySelector('[data-preview-note]');
    const live = () => current(v) && v.previewSequence === sequence;
    v.root.querySelector('[data-preview-name]').textContent = file.name || 'ผลงาน';
    v.root.querySelector('[data-preview-close]').hidden = false;
    note.textContent = ''; body.append(el('p', 'กำลังเปิดตัวอย่าง…'));
    let target = file, type = String(file.contentType || '').split(';')[0].toLowerCase();
    const office = /\.(docx|xlsx|pptx)$/i.test(file.name || '');
    if (office) {
      target = (job.files || []).find(item => item.contentType === 'text/html' && item.name === file.name.replace(/\.(docx|xlsx|pptx)$/i, '.print.html') && (file.stepIndex == null || item.stepIndex === file.stepIndex));
      if (!target) { body.replaceChildren(el('p', 'ไฟล์ Office นี้ไม่มีฉบับตัวอย่างคู่กัน กดดาวน์โหลดเพื่อเปิดด้วย Word, Excel, PowerPoint หรือโปรแกรมที่รองรับ')); return; }
      type = 'text/html';
    }
    const image = ['image/png','image/jpeg','image/webp','image/gif'].includes(type), video = ['video/mp4','video/webm'].includes(type);
    const html = type === 'text/html' && /\.print\.html$/i.test(target.name || '');
    const plain = /^(text\/(plain|csv|tab-separated-values|markdown)|application\/json)$/.test(type);
    if (!image && !video && !html && !plain) { body.replaceChildren(el('p', 'รูปแบบนี้ยังไม่มีตัวอย่างในสตูดิโอ กดดาวน์โหลดเพื่อเปิดด้วยโปรแกรมที่รองรับ')); return; }
    try {
      const limit = video ? 100 * 1024 * 1024 : 24 * 1024 * 1024;
      if (Number(target.size || 0) > limit) throw Error('preview_too_large');
      const response = await api(v, '/api/files/' + encodeURIComponent(target.id) + '/preview', {}, true);
      if (!live()) return;
      if (Number(response.headers?.get?.('content-length') || 0) > limit) throw Error('preview_too_large');
      if (html || plain) {
        const text = await response.text(); if (!live()) return;
        if (text.length > limit) throw Error('preview_too_large');
        if (html) {
          const frame = el('iframe', null, { title: 'ตัวอย่าง ' + (file.name || 'เอกสาร'), sandbox: '', referrerpolicy: 'no-referrer' });
          frame.srcdoc = readableDocument(text); body.replaceChildren(frame);
          note.textContent = 'ฉบับอ่านจากไฟล์สำหรับพิมพ์ รูปแบบอาจต่างจาก Office · ดาวน์โหลด DOCX/XLSX/PPTX เพื่อแก้ไข หรือ .print.html เพื่อพิมพ์';
        } else body.replaceChildren(el('pre', text));
      } else {
        const blob = await response.blob(); if (!live()) return;
        if (blob.size > limit) throw Error('preview_too_large');
        const url = URL.createObjectURL(new Blob([blob], { type })); v.previewUrl = url; v.urls.add(url);
        const media = el(image ? 'img' : 'video', null, image ? { src: url, alt: file.name || 'ผลงานรูปภาพ' } : { src: url, controls: '', playsinline: '', preload: 'metadata' });
        media.onerror = () => { if (live()) note.textContent = 'เบราว์เซอร์เปิดตัวอย่างนี้ไม่ได้ ลองดาวน์โหลดไฟล์เพื่อตรวจสอบ'; };
        body.replaceChildren(media);
      }
    } catch (error) { if (live()) body.replaceChildren(el('p', friendly(error), { role: 'alert' })); }
  }
  function renderJobs(v) {
    if (!current(v)) return;
    const list = v.root.querySelector('[data-studio-jobs]'); list.replaceChildren();
    if (!v.jobs.length) list.append(el('p', 'ยังไม่มีงาน เริ่มด้วยคำสั่งของคุณทางซ้าย', { class: 'cs-muted' }));
    for (const job of v.jobs) {
      const article = el('article', null, { class: 'cs-job', 'data-job-id': job.id }), head = el('div', null, { class: 'cs-job-head' });
      const names = (job.steps || []).map(step => plugin(step.pluginId)?.title || step.pluginId).join(' → ');
      head.append(el('h3', names || plugin(job.pluginId)?.title || 'งานสร้างสรรค์'), el('span', stateName(job.status), { class: 'cs-badge', 'data-state': job.status })); article.append(head);
      const time = new Date(job.createdAt); if (Number.isFinite(time.getTime())) article.append(el('small', time.toLocaleString('th-TH')));
      if (job.summary) article.append(el('p', job.summary));
      const steps = el('ol', null, { class: 'cs-steps' }); for (const step of job.steps || []) steps.append(el('li', (plugin(step.pluginId)?.title || step.pluginId) + ' · ' + stateName(step.status))); article.append(steps);
      if (job.error) article.append(el('p', friendly(typeof job.error === 'string' ? job.error : job.error.code || job.error.message), { role: 'note' }));
      if (job.status === 'needs_review') article.append(el('p', 'ระบบยังยืนยันผลจากบริการไม่ได้ จึงหยุดเพื่อป้องกันงานหรือค่าใช้จ่ายซ้ำ ข้อความนี้ไม่ใช่ปุ่มอนุมัติ โปรดตรวจ “ไฟล์ของฉัน” ก่อนสร้างใหม่ หากยังไม่พบไฟล์ ให้แจ้งรหัสงานด้านล่าง'));
      if (!(job.files || []).length) article.append(el('p', terminal(job) ? 'งานนี้ยังไม่มีไฟล์ผลงานให้เปิดดู' : 'ตัวอย่างจะเปิดดูได้เมื่อมีไฟล์ผลงาน', { class: 'cs-muted' }));
      if (job.error || job.status === 'needs_review') { const details = el('details'); details.append(el('summary', 'รายละเอียดสำหรับแจ้งปัญหา'), el('p', 'รหัสงาน: ' + job.id), el('p', 'รหัสข้อผิดพลาด: ' + String(job.error || 'ไม่ระบุ'))); article.append(details); }

      const seen = new Set();
      for (const file of job.files || []) {
        if (!file?.id || seen.has(file.id)) continue; seen.add(file.id);
        const result = el('div', null, { class: 'cs-result' }), actions = el('div', null, { class: 'cs-actions' }); result.append(el('strong', file.name || file.id, { class: 'cs-result-name' }));
        actions.append(button('แชร์ไป Social Media', () => window.PanthoriumSocial?.open(file.contentType?.startsWith('video/') ? 'watch' : 'community', { sourceFileIds: [file.id] })));
        actions.append(button('เปิดดู', () => previewFile(v, file, job), { 'data-preview-file': file.id }));
        actions.append(button('ดาวน์โหลด', event => download(v, file, event.currentTarget), { 'data-download-file': file.id }));
        const type = String(file.contentType || '');
        const targets = ['document', 'spreadsheet', 'presentation'].filter(id => sourceCompatible(file, id));
        if (['image/png', 'image/jpeg'].includes(type)) targets.unshift('video');
        for (const id of targets) actions.append(button('ส่งต่อไปยัง' + plugin(id).title, () => {
          if (v.busy) return;
          if (!v.files.some(item => item.id === file.id)) v.files.unshift(file);
          selectPlugin(v, id, [file.id]); status(v, 'เลือกไฟล์ “' + (file.name || file.id) + '” แล้ว เพิ่มคำสั่งเพื่อทำต่อ'); v.root.querySelector('[data-studio-prompt]').focus();
        }, { 'data-send-to': id }));
        result.append(actions);
        if (type === 'text/html' && /\.print\.html$/i.test(file.name || '')) result.append(el('small', 'เปิดไฟล์ที่ดาวน์โหลด แล้วสั่งพิมพ์หรือบันทึกเป็น PDF'));
        article.append(result);
      }
      if (!terminal(job)) article.append(button('ตรวจและทำขั้นตอนถัดไป', () => advance(v, job.id), { 'data-advance-job': job.id }));
      list.append(article);
    }
  }
  function schedule(v, delay = 8000) {
    clearTimeout(v.timer); v.timer = null;
    if (!current(v) || !v.jobs.some(job => !terminal(job))) return;
    v.timer = setTimeout(async () => {
      if (!current(v)) return;
      for (const job of [...v.jobs].filter(item => !terminal(item)).slice(0, 3)) { if (!current(v)) return; await advance(v, job.id, false); }
      schedule(v);
    }, delay);
  }
  async function advance(v, id, reschedule = true) {
    if (!current(v) || v.advancing.has(id)) return;
    v.advancing.add(id);
    try { const data = await post(v, '/api/studio/jobs/' + encodeURIComponent(id) + '/advance', {}); if (!current(v)) return; putJob(v, data.job); renderJobs(v); if (data.job?.status === 'completed') await loadFiles(v); }
    catch (error) { status(v, friendly(error), true); }
    finally { v.advancing.delete(id); if (reschedule) schedule(v); }
  }
  async function refresh(v) {
    if (!current(v) || v.refreshing) return;
    v.refreshing = true;
    try {
      const results = await Promise.allSettled([api(v, '/api/studio/catalog'), api(v, '/api/studio/jobs'), loadFiles(v)]);
      if (!current(v)) return;
      if (results[0].status === 'fulfilled') {
        const data = results[0].value; v.catalog = data.plugins || [];
        v.root.querySelector('[data-studio-durability]').textContent = data.durable ? 'งานถูกบันทึกบนคลาวด์ เปิดหน้าต่างนี้ภายหลังเพื่อติดตามต่อได้' : 'การทำงานเบื้องหลังยังไม่พร้อม ควรเปิดหน้าต่างนี้ไว้จนงานเสร็จ';
      } else status(v, friendly(results[0].reason), true);
      if (results[1].status === 'fulfilled') {
        // Preserve a job received from Sentinel or POST while this older GET was in flight.
        for (const job of results[1].value.jobs || []) { const existing = v.jobs.find(item => item.id === job.id); if (!existing || String(job.updatedAt || '') >= String(existing.updatedAt || '')) putJob(v, job); }
        v.jobs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))); renderJobs(v);
      }
      else status(v, friendly(results[1].reason), true);
      renderCapability(v); controls(v); schedule(v, 1000);
    } finally { v.refreshing = false; }
  }
  async function submit(v, event) {
    event.preventDefault(); if (!current(v) || v.busy || v.root.querySelector('[data-studio-submit]').disabled) return;
    const q = name => v.root.querySelector('[data-studio-' + name + ']'), prompt = q('prompt').value.trim();
    if (!prompt) { status(v, 'กรุณาบอกสิ่งที่ต้องการสร้าง', true); q('prompt').focus(); return; }
    if (prompt.length > promptLimit(v.active)) { status(v, 'คำสั่งสำหรับเครื่องมือนี้ต้องไม่เกิน ' + promptLimit(v.active) + ' ตัวอักษร', true); return; }
    const requiresConfirmation = ['image', 'video'].includes(v.active);
    if (requiresConfirmation && !q('confirm').checked) { status(v, messages.generation_confirmation_required, true); q('confirm').focus(); return; }
    const input = { prompt, name: q('name').value.trim() };
    if (['image', 'video'].includes(v.active)) input.aspectRatio = q('aspect').value;
    if (v.active === 'video') input.durationSeconds = Number(q('duration').value);
    const first = { pluginId: v.active, input, sourceFileIds: [...v.sources] }, next = q('next').value;
    if (next && (q('next-prompt').value.trim() || prompt).length > promptLimit(next)) { status(v, 'คำสั่งขั้นตอนถัดไปต้องไม่เกิน ' + promptLimit(next) + ' ตัวอักษร', true); q('next-prompt').focus(); return; }
    const payload = next ? { steps: [first, { pluginId: next, input: { prompt: q('next-prompt').value.trim() || prompt, name: input.name }, sourceFileIds: [], usePrevious: true }] } : first;
    payload.confirmed = requiresConfirmation ? q('confirm').checked : true;
    const fingerprint = JSON.stringify(payload);
    // An uncertain network result retries the same logical submission, never a second paid job.
    if (!v.pending || v.pending.fingerprint !== fingerprint) v.pending = { fingerprint, key: window.crypto?.randomUUID?.() || 'studio-' + Date.now() + '-' + Math.random().toString(36).slice(2) };
    payload.idempotencyKey = v.pending.key; saveDraft(v); v.busy = true; controls(v); status(v, 'กำลังส่งงานไปยังปลั๊กอิน…');
    try {
      const data = await post(v, '/api/studio/jobs', payload); if (!current(v)) return;
      putJob(v, data.job); v.pending = null; renderJobs(v); status(v, 'รับงานแล้ว · ติดตามผลในรายการงาน');
      if (data.job?.id && !terminal(data.job)) advance(v, data.job.id);
      else if (data.job?.status === 'completed') loadFiles(v);
    } catch (error) { status(v, friendly(error), true); }
    finally { if (current(v)) { v.busy = false; controls(v); } }
  }
  function cleanup(v) {
    if (!v) return; clearPreview(v); clearTimeout(v.timer); v.controller.abort();
    for (const timer of v.urlTimers) clearTimeout(timer); for (const url of v.urls) URL.revokeObjectURL(url);
    v.urls.clear(); v.urlTimers.clear(); v.jobs = []; v.files = []; v.sources.clear(); v.drafts = {}; v.pending = null; v.approvals.clear();
    v.root.replaceChildren(); if (view === v) view = null;
  }
  function close() {
    const v = view; cleanup(v);
    if (typeof closeWindow === 'function') closeWindow(ID); else if (window.PanthoriumWindowManager?.close) window.PanthoriumWindowManager.close(ID); else document.querySelector('.window[data-id="creative-studio"]')?.remove();
  }
  function open(id = 'image', options = {}) {
    if (!allowed()) { window.PanthoriumAccounts?.openLogin?.(); return false; }
    if (!plugin(id)) id = 'image';
    if (view && current(view)) { window.PanthoriumWindowManager?.restore?.(ID); if (typeof focusWindow === 'function') focusWindow(ID); selectPlugin(view, id, options.sourceFileIds); return view.root; }
    if (view) cleanup(view);
    if (typeof createWindow !== 'function') return false;
    createWindow(ID, 'สร้างสรรค์และเอกสาร', markup(), { width: 1180, height: 820, onClose: () => cleanup(view) });
    const root = document.querySelector('.window[data-id="creative-studio"] [data-studio]'); if (!root) return false;
    const v = view = { root, owner: principal(), generation, active: 'image', drafts: {}, catalog: [], files: [], jobs: [], sources: new Set(), urls: new Set(), urlTimers: new Set(), advancing: new Set(), approvals: new Map(), controller: new AbortController(), busy: false, modeBusy: false, timer: null };
    const tabs = root.querySelector('[data-studio-tabs]');
    for (const item of PLUGINS) {
      const tab = button('', () => selectPlugin(v, item.id), { id: 'studio-tab-' + item.id, role: 'tab', 'aria-selected': 'false', 'aria-controls': 'studio-editor-panel', 'data-plugin-id': item.id });
      const icon = window.PanthoriumStartMenuUI?.icon?.(item.icon); if (icon) tab.append(icon); tab.append(el('span', item.title)); tabs.append(tab);
      tab.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const i = PLUGINS.findIndex(p => p.id === v.active), target = event.key === 'Home' ? 0 : event.key === 'End' ? PLUGINS.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + PLUGINS.length) % PLUGINS.length; selectPlugin(v, PLUGINS[target].id); tabs.children[target].focus(); };
    }
    root.querySelector('[data-preview-close]').onclick = () => { clearPreview(v); root.querySelector('[data-preview-body]').append(el('p', 'เลือกเปิดดูจากไฟล์ผลงานด้านล่าง')); root.querySelector('[data-preview-name]').textContent = 'ภาพ วิดีโอ และเอกสาร'; root.querySelector('[data-preview-note]').textContent = ''; root.querySelector('[data-preview-close]').hidden = true; };
    root.querySelector('[data-studio-form]').onsubmit = event => submit(v, event);
    root.querySelector('[data-studio-refresh]').onclick = () => refresh(v);
    root.querySelector('[data-studio-refresh-files]').onclick = () => loadFiles(v);
    root.querySelector('[data-open-sentinel]').onclick = () => { if (typeof openSentinel === 'function') openSentinel(); };
    root.querySelector('[data-open-files]').onclick = () => { if (typeof openFiles === 'function') openFiles(); };
    root.querySelector('[data-studio-next]').onchange = () => { const next = root.querySelector('[data-studio-next]').value; root.querySelector('[data-next-prompt-label]').hidden = !next; root.querySelector('[data-studio-next-prompt]').maxLength = promptLimit(next); controls(v); };
    root.querySelector('[data-studio-mode]').onchange = async event => {
      if (!current(v) || v.modeBusy || v.busy) return; const id = v.active, mode = event.target.value; v.modeBusy = true; controls(v);
      try { await api(v, '/api/studio/plugins/' + id + '/mode', { method: 'PUT', body: JSON.stringify({ mode }) }); if (!current(v)) return; const spec = v.catalog.find(item => item.id === id); if (spec) spec.mode = mode; status(v, 'บันทึกโหมด ' + mode.toUpperCase() + ' สำหรับ' + plugin(id).title + 'แล้ว'); }
      catch (error) { status(v, friendly(error), true); }
      finally { if (current(v)) { v.modeBusy = false; renderCapability(v); controls(v); } }
    };
    selectPlugin(v, id, options.sourceFileIds); refresh(v); return root;
  }
  function installMenu() {
    const menu = document.getElementById('sm-apps'); if (!menu) return;
    if (!allowed()) { menu.querySelector('[data-start-group="creative"]')?.remove(); return; }
    const group = window.PanthoriumStartMenuUI?.group?.('creative', 'สร้างสรรค์และเอกสาร', menu); if (!group) return;
    const target = window.PanthoriumStartMenuUI.groupItems(group);
    for (const item of PLUGINS) {
      if (group.querySelector('[data-app-id="studio-' + item.id + '"]')) continue;
      const launch = button('', () => { open(item.id); if (typeof closeStartMenu === 'function') closeStartMenu(); else document.getElementById('start-menu')?.classList.remove('open'); }, { class: 'sm-app', 'data-app-id': 'studio-' + item.id, 'data-search-text': 'สร้างสรรค์ เอกสาร สตูดิโอ studio ' + item.id + ' ' + item.title });
      const graphic = el('span', null, { class: 'sm-pack-icon' }), icon = window.PanthoriumStartMenuUI.icon(item.icon); graphic.append(icon); launch.append(graphic, el('span', item.title)); target.append(launch);
    }
    window.PanthoriumStartMenuUI.keepPinnedLast(menu);
    if (!menuObserver && window.MutationObserver) { menuObserver = new MutationObserver(installMenu); menuObserver.observe(menu, { childList: true }); }
  }
  function authChanged() { const next = identity(); if (next !== lastIdentity) { lastIdentity = next; generation++; close(); } installMenu(); }
  function showJob(job) {
    if (!allowed() || !job?.id) return false;
    open(job.steps?.[0]?.pluginId || job.pluginId || 'image');
    if (!view || !current(view)) return false; putJob(view, job); renderJobs(view); schedule(view, 1000); return true;
  }
  function review(result) {
    const confirmation = result?.confirmation;
    if (!allowed() || result?.toolId !== 'studio.create' || result.requiresConfirmation !== true || confirmation?.toolId !== 'studio.create' || !/^[a-f0-9]{64}$/i.test(confirmation.approvalHash || '') || typeof confirmation.actionId !== 'string') return false;
    const args = confirmation.args || {}, steps = Array.isArray(args.steps) ? args.steps : [args];
    open(steps[0]?.pluginId || 'image'); const v = view; if (!v || !current(v) || v.approvals.has(confirmation.actionId)) return false;
    const card = el('section', null, { class: 'cs-job', 'data-studio-approval': confirmation.actionId }), controls = el('div', null, { class: 'cs-actions' });
    card.append(el('h2', 'ตรวจคำสั่งจาก Sentinel AI'), el('p', 'ยืนยันแผนนี้ก่อนเริ่มเรียกปลั๊กอิน งานสร้างสื่ออาจใช้โควตาหรือมีค่าใช้จ่าย'));
    for (const [index, step] of steps.entries()) {
      card.append(el('h3', (index + 1) + '. ' + (plugin(step.pluginId)?.title || String(step.pluginId || 'ไม่พบเครื่องมือ'))));
      // Show every approved argument, rather than a model-written summary that could omit side effects.
      const plan = el('pre', JSON.stringify({ input: step.input || {}, sourceFileIds: step.sourceFileIds || [], usePrevious: step.usePrevious === true }, null, 2)); plan.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;max-height:240px;overflow:auto'; card.append(plan);
    }
    const expires = new Date(confirmation.approvalExpiresAt), expired = Number.isFinite(expires.getTime()) && expires.getTime() <= Date.now();
    if (Number.isFinite(expires.getTime())) card.append(el('small', 'ยืนยันได้ถึง ' + expires.toLocaleString('th-TH')));
    const report = el('p', expired ? 'คำขอนี้หมดอายุแล้ว กรุณาสั่ง Sentinel ใหม่' : '', { role: 'status' });
    const run = async cancel => {
      if (!current(v) || record.busy) return;
      record.busy = true; approve.disabled = reject.disabled = true;
      try {
        const data = cancel ? await post(v, '/api/actions/' + encodeURIComponent(confirmation.actionId) + '/cancel', {}) : await post(v, '/api/actions/' + encodeURIComponent(confirmation.actionId) + '/confirm', { approvalHash: confirmation.approvalHash });
        if (!current(v)) return;
        if (!cancel && data.output?.job) { putJob(v, data.output.job); renderJobs(v); if (!terminal(data.output.job)) advance(v, data.output.job.id); }
        card.replaceChildren(el('p', cancel ? 'ยกเลิกคำขอจาก Sentinel แล้ว' : 'ยืนยันคำขอแล้ว · ติดตามผลในรายการงาน'));
        // Keep only the action ID as a dedup marker; discard approval credentials after use.
        v.approvals.set(confirmation.actionId, { done: true });
      } catch (error) { if (current(v)) { report.textContent = friendly(error); record.busy = false; approve.disabled = expired; reject.disabled = false; } }
    };
    const record = { busy: false }, approve = button('ยืนยันและเริ่มงาน', () => run(false), { class: 'cs-primary', 'data-studio-approve': '' }), reject = button('ยกเลิก', () => run(true), { 'data-studio-reject': '' });
    approve.disabled = expired; controls.append(approve, reject); card.append(report, controls); v.root.querySelector('[data-studio-approvals]').append(card); v.approvals.set(confirmation.actionId, record); return true;
  }
  window.PanthoriumCreativeStudio = Object.freeze({ open, close, review, showJob, refresh: () => view && refresh(view), openImage: () => open('image'), openVideo: () => open('video'), openDocument: () => open('document'), openSpreadsheet: () => open('spreadsheet'), openPresentation: () => open('presentation') });
  window.addEventListener('panthorium:ai-done', event => {
    for (const result of event.detail?.toolResults || []) {
      if (result.toolId !== 'studio.create') continue;
      if (result.requiresConfirmation) review(result);
      else if (result.ok && result.output?.job) showJob(result.output.job);
    }
  });
  for (const name of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:boot-complete']) window.addEventListener(name, authChanged);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMenu, { once: true }); else installMenu();
})();
