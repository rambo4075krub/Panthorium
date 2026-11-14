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
  function editable(file) { return /\.(docx|xlsx|pptx|png|jpe?g|webp|mp4|webm|mov|mkv)$/i.test(file.name || ''); }
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
  const current = v => view === v && !v.closing && v.root.isConnected && v.owner === principal() && v.generation === generation && allowed();
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
      [data-studio]{height:100%;box-sizing:border-box;overflow:auto;padding:12px;container:creative / inline-size;color:var(--text,#f4f1ee);background:radial-gradient(ellipse at 95% 0,rgba(245,126,54,.09),transparent 45%),var(--bg,#0c1017);font:14px/1.5 system-ui,sans-serif}
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

      /* One compact navigation row, matching Social Media. */
      [data-studio] .cs-commandbar{display:flex;gap:12px;align-items:center;position:sticky;top:-12px;z-index:2;padding:8px 0;margin-bottom:12px;background:var(--bg,#0c1017);border-bottom:1px solid #87dfff25}
      [data-studio] .cs-tabs{display:flex;gap:5px;margin:0;min-width:0;flex:1;overflow-x:auto;scrollbar-width:thin;padding:2px}
      [data-studio] .cs-tabs button{flex:none;white-space:nowrap;flex-direction:row;font-size:13px;gap:6px;min-height:40px;padding:7px 11px}
      [data-studio] .cs-tabs svg{width:16px;height:16px}
      [data-studio] .cs-head-actions{flex:none;flex-wrap:nowrap;margin:0;gap:5px}
      [data-studio] .cs-head-actions button{white-space:nowrap;font-size:12px;padding:7px 10px;min-height:40px}
      [data-studio] .cs-layout{gap:12px;grid-template-columns:minmax(280px,.9fr) minmax(300px,1.1fr)}
      [data-studio] .cs-panel{padding:16px;border-radius:12px}
      [data-studio] .cs-capability{margin:8px 0;font-size:12px;padding:7px 10px}
      [data-studio] .cs-open-file{display:flex;flex-wrap:wrap;gap:8px;padding:12px 0 16px;border-bottom:1px solid #87dfff25;margin-bottom:14px}
      [data-studio] .cs-open-file label{flex-basis:100%;margin:0}
      [data-studio] .cs-open-file button{font-size:12px;min-height:38px}
      [data-studio] .cs-create-heading{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:10px}
      [data-studio] .cs-starters{display:flex;gap:6px;flex-wrap:wrap}
      [data-studio] .cs-starters button{font-size:12px;padding:5px 9px;min-height:32px;border-radius:20px}
      [data-studio] textarea{min-height:120px}
      [data-studio] .cs-options{border-block:1px solid #87dfff25;margin:16px 0;padding:10px 0}
      [data-studio] summary{cursor:pointer;color:#b4d9e9;font-size:12px;padding:4px 0}
      [data-studio] .cs-preview{margin-bottom:16px}
      [data-studio] .cs-preview-body{min-height:220px}
      [data-studio] [data-studio-status]:empty{display:none}
      @container creative (max-width:760px){[data-studio] .cs-layout{grid-template-columns:1fr}[data-studio] .cs-commandbar{flex-wrap:wrap;gap:4px}[data-studio] .cs-tabs{flex-basis:100%}[data-studio] .cs-head-actions{margin-left:auto}[data-studio] .cs-panel{padding:12px}}

      [data-studio]{display:flex;flex-direction:column;overflow:hidden;padding:0;position:relative;min-height:0}
      [data-studio] .cs-commandbar{position:relative;top:auto;padding:3px 10px;margin:0;flex:none;gap:8px;min-height:46px}
      [data-studio] .cs-commandbar button{min-height:34px}
      [data-studio] .cs-head-actions [data-open-sentinel],[data-studio] .cs-head-actions [data-open-files]{display:none}
      [data-studio] .cs-open-file{padding:5px 12px;margin:0;flex:none;align-items:center;gap:6px;flex-wrap:wrap;background:#101d2b;min-height:43px}
      [data-studio] .cs-open-file label{font-size:0;flex:1 1 220px;min-width:0;max-width:360px}
      [data-studio] .cs-open-file select{margin:0;padding:5px 8px;font-size:12px;height:32px}
      [data-studio] .cs-open-file button{flex:0 0 auto;font-size:12px;min-height:32px;padding:5px 9px;white-space:nowrap}
      [data-studio] [data-studio-voice][aria-pressed=true]{border-color:#72ddd6;color:#b9ffff;background:#153f49}
      [data-studio] .cs-file-label{font-size:12px;color:#9fb2c4}
      [data-studio] [data-inline-workspace]{flex:1;min-height:0;position:relative;overflow:hidden}
      [data-studio] .cs-workspace{height:100%;min-height:0;overflow:hidden}
      [data-studio] .cs-layout{position:absolute;z-index:8;top:50px;right:0;bottom:0;display:block;width:min(480px,100%);overflow:auto;background:#0c1420;border-left:1px solid #365168;box-shadow:-12px 0 40px #0008}
      [data-studio] .cs-layout .cs-panel{border:0;border-radius:0}
      [data-studio] .cs-welcome{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:radial-gradient(ellipse at 50% 45%,#1c3343,transparent 65%);padding:25px;text-align:center}
      [data-studio] .cs-welcome h2{font-size:28px;margin:0}[data-studio] .cs-welcome p{color:#adc0cf;margin:0 0 12px}[data-studio] .cs-welcome small{letter-spacing:2px}
      [data-studio] [data-studio-status]{margin:0;padding:0 12px;flex:none;font-size:12px}
      [data-studio] [data-studio-editor] input:not([type=checkbox]),[data-studio] [data-studio-editor] select{width:auto}
      [data-studio] [data-studio-editor] .se-file input{width:100%}
      [data-studio] [data-studio-editor] label{margin:0}
      @container creative (max-width:680px){[data-studio] .cs-commandbar{flex-wrap:nowrap;gap:4px;padding:4px}[data-studio] .cs-head-actions button{font-size:11px;padding:4px 7px;min-height:36px}[data-studio] .cs-tabs button{padding:6px 9px;min-height:36px}[data-studio] .cs-open-file{padding:6px}[data-studio] .cs-open-file label{max-width:none;flex:1 0 100%}[data-studio] .cs-file-label{display:none}[data-studio] .cs-open-file button{flex:1 0 auto;min-height:40px}[data-studio] .cs-layout{top:45px}}
    </style>
    <div class="cs-commandbar" aria-label="สร้างสรรค์และเอกสาร">
      <nav class="cs-tabs" role="tablist" aria-label="เครื่องมือสร้างสรรค์" data-studio-tabs></nav>
      <div class="cs-head-actions"><button type="button" data-toggle-create aria-expanded="false">สร้างด้วย AI</button><button type="button" data-toggle-history aria-expanded="false">ผลงาน</button><button type="button" data-open-sentinel>Sentinel AI</button><button type="button" data-open-files>ไฟล์ของฉัน</button></div>
    </div>
    <div data-inline-workspace role="tabpanel" id="studio-editor-panel" aria-labelledby="studio-tab-image"></div><div class="cs-layout" hidden><section class="cs-panel" data-create-panel>
      <h2 data-studio-title>รูปภาพ</h2><p class="cs-muted" data-studio-output></p><div class="cs-capability" data-studio-capability>กำลังตรวจความพร้อมของปลั๊กอิน…</div>
      <div class="cs-open-file"><label>เปิดงานที่มีอยู่<select data-editor-files aria-label="ไฟล์ที่จะแก้ไข"></select></label><button type="button" data-editor-open>เปิดในพื้นที่ทำงาน</button><button type="button" data-editor-blank>เริ่มเอกสารเปล่า</button></div>
      <form data-studio-form><div class="cs-create-heading"><h3>สร้างผลงานใหม่</h3><small>เริ่มจากคำอธิบาย หรือเลือกแนวทางด้านล่าง</small></div><div class="cs-starters" data-studio-starters aria-label="แนวทางเริ่มงาน"></div><label>บอกสิ่งที่ต้องการ<textarea data-studio-prompt maxlength="12000" required></textarea></label><label>ชื่อผลงาน<input data-studio-name maxlength="120" placeholder="เช่น แผนงานเดือนนี้"></label>
      <details class="cs-options"><summary>ตัวเลือก · ไฟล์ต้นทาง · ทำงานต่อเนื่อง</summary>
      <div class="cs-field-row"><label>การเรียกใช้ปลั๊กอิน<select data-studio-mode aria-label="โหมดปลั๊กอิน"><option value="auto">Auto · อนุญาตให้เรียกใช้</option><option value="never">Never · ไม่อนุญาตให้เรียกใช้</option></select></label><label data-aspect-label>สัดส่วน<select data-studio-aspect><option value="16:9">16:9 · แนวนอน</option><option value="9:16">9:16 · แนวตั้ง</option><option value="1:1">1:1 · จัตุรัส</option></select></label><label data-duration-label hidden>ความยาววิดีโอ<select data-studio-duration><option value="8">8 วินาที</option><option value="6">6 วินาที</option><option value="4">4 วินาที</option></select></label></div>
      <label>ไฟล์ต้นทาง <small data-studio-source-limit>เลือกได้สูงสุด 6 ไฟล์</small></label><div class="cs-files" data-studio-files></div><button type="button" data-studio-refresh-files>โหลดรายการไฟล์ใหม่</button>
      <div class="cs-next"><label>ส่งผลลัพธ์ไปทำต่อ<select data-studio-next><option value="">จบที่เครื่องมือนี้</option></select></label><label data-next-prompt-label hidden>คำสั่งสำหรับขั้นตอนถัดไป<textarea data-studio-next-prompt maxlength="12000" rows="3" placeholder="เช่น นำภาพที่สร้างมาเป็นภาพประกอบงานนำเสนอ 5 สไลด์"></textarea></label></div>
      </details><label class="cs-check" data-confirm-label hidden><input type="checkbox" data-studio-confirm><span>ยืนยันเริ่มสร้างสื่อ โดยใช้โควตาหรือค่าใช้จ่ายของบริการที่เชื่อมต่อ</span></label>
      <p role="status" aria-live="polite" data-studio-status></p><button class="cs-primary" type="submit" data-studio-submit disabled>สร้างผลงาน</button><p><small data-studio-durability></small></p>
      </form></section>
      <section class="cs-panel" data-history-panel><section class="cs-preview" aria-label="ตัวอย่างผลงาน"><div class="cs-preview-heading"><div><h2>ตัวอย่างผลงาน</h2><small data-preview-name>ภาพ วิดีโอ และเอกสาร</small></div><button type="button" data-preview-close hidden>ปิดตัวอย่าง</button></div><div class="cs-preview-body" data-preview-body aria-live="polite"><p class="cs-muted">เมื่อมีผลงาน กด “เปิดดู” ที่ไฟล์ด้านล่าง ภาพ วิดีโอ และฉบับอ่านของเอกสารจะแสดงที่นี่</p></div><p class="cs-preview-note" data-preview-note></p></section><div data-studio-approvals></div><div class="cs-history-title"><h2>งานและผลงานของฉัน</h2><button type="button" data-studio-refresh>รีเฟรช</button></div><p class="cs-muted">กดเปิดดูเพื่อแสดงตัวอย่าง · กดแก้ไขเพื่อทำงานในแท็บนี้ · ส่งต่อไปยังเครื่องมืออื่น</p><div data-studio-jobs></div></section></div>
    </div>`;
  function showWorkspace(v,id){
    if(!current(v))return;const area=v.root.querySelector('[data-inline-workspace]');
    for(const [key,item]of v.workspaces){item.host.hidden=key!==id;if(key!==id)item.editor?.pause?.();}
    if(v.workspaces.has(id))return;
    const host=el('div',null,{'data-workspace-kind':id,class:'cs-workspace'});area.append(host);const item={host};v.workspaces.set(id,item);
    if(['image','video'].includes(id)&&window.PanthoriumCreativeEditors){item.editor=window.PanthoriumCreativeEditors.mount(id,host,{valid:()=>current(v),request:(...args)=>api(v,...args),files:()=>v.files,onSaved:file=>{if(!current(v))return;v.files.unshift(file);renderFiles(v);}});return;}
    const welcome=el('div',null,{class:'cs-welcome'});welcome.append(el('small','PANTHORIUM / '+id.toUpperCase()),el('h2',{document:'เริ่มเขียนเรื่องถัดไป',spreadsheet:'จากข้อมูล สู่คำตอบ',presentation:'เล่าเรื่องให้ชัดเจน'}[id]||'เริ่มสร้างผลงาน'),el('p',{document:'กระดาษ · ย่อหน้า · ตาราง · ตรวจทาน',spreadsheet:'เซลล์ · สูตรคำนวณ · กราฟ · Pivot Table',presentation:'สไลด์ · กล่องข้อความ · จัดวาง · นำเสนอ'}[id]||''));
    welcome.append(button('＋ สร้าง'+plugin(id).title+'ใหม่',()=>v.root.querySelector('[data-editor-blank]').click(),{class:'cs-primary'}),button('เปิดไฟล์ของฉัน',()=>v.root.querySelector('[data-editor-files]').focus()));host.append(welcome);
  }
  async function openFile(v,fileId,kind){
    if(!fileId||!current(v))return false;if(v.busy||v.modeBusy){status(v,'รอคำขอปัจจุบันเสร็จก่อนเปิดไฟล์',true);return false;}const file=v.files.find(f=>f.id===fileId)||v.jobs.flatMap(j=>j.files||[]).find(f=>f.id===fileId);
    kind=kind||(/\.docx$/i.test(file?.name)?'document':/\.xlsx$/i.test(file?.name)?'spreadsheet':/\.pptx$/i.test(file?.name)?'presentation':/\.(mp4|webm|mov|mkv)$/i.test(file?.name)?'video':/\.(png|jpe?g|webp)$/i.test(file?.name)?'image':v.active);
    v.selectedFiles[kind]=fileId;if(file&&!v.files.some(f=>f.id===fileId))v.files.unshift(file);selectPlugin(v,kind);showWorkspace(v,kind);const item=v.workspaces.get(kind);if(!item)return false;
    v.root.querySelector('.cs-layout').hidden=true;for(const n of v.root.querySelectorAll('[data-toggle-create],[data-toggle-history]'))n.setAttribute('aria-expanded','false');
    if(item.editor)return item.editor.openFile(fileId);
    return window.PanthoriumStudioEditor?.open(fileId,{container:item.host,onAdopt:file=>{if(current(v)){v.selectedFiles[kind]=file.id;renderFiles(v);}},onClose:()=>{v.workspaces.delete(kind);item.host.remove();showWorkspace(v,v.active);},onSaved:job=>{if(current(v)){putJob(v,job);renderJobs(v);for(const f of job.files||[])if(!v.files.some(x=>x.id===f.id))v.files.unshift(f);renderFiles(v);}}});
  }
  async function editFile(fileId){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId||'')||!open(view?.active||'document'))return false;
    const v=view;if(!v.files.some(file=>file.id===fileId))await loadFiles(v);if(!current(v))return false;
    const file=v.files.find(file=>file.id===fileId)||v.jobs.flatMap(job=>job.files||[]).find(file=>file.id===fileId);
    if(!file||!editable(file)){status(v,file?'ไฟล์ชนิดนี้ยังเปิดแก้ไขไม่ได้':'ไม่พบไฟล์ในบัญชีนี้ กรุณาโหลดรายการไฟล์ใหม่',true);return false;}
    return openFile(v,fileId);
  }
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
    const starters = {
      image: [['ภาพสินค้า','สร้างภาพสินค้า พื้นหลังสะอาด แสงสตูดิโอนุ่ม อัตราส่วน 1:1 โดยใช้รายละเอียดสินค้า: '],['โพสต์โซเชียล',selected.example]],
      video: [['แนะนำสินค้า',selected.example],['ภาพเป็นวิดีโอ','ใช้ภาพต้นทางที่เลือก สร้างวิดีโอเคลื่อนกล้องช้า ๆ รักษารูปร่างสินค้า ความยาว 8 วินาที']],
      document: [['รายงาน',selected.example],['ข้อเสนอโครงการ','ร่างข้อเสนอโครงการภาษาไทย มีวัตถุประสงค์ ขอบเขตงาน กำหนดการ และงบประมาณ จากข้อมูล: ']],
      spreadsheet: [['ค่าใช้จ่าย',selected.example],['ติดตามงาน','สร้างแบบฟอร์มตารางติดตามงาน มีคอลัมน์ งาน ผู้รับผิดชอบ กำหนดส่ง สถานะ และหมายเหตุ']],
      presentation: [['นำเสนอโครงการ',selected.example],['สรุปรายงาน','สร้างสไลด์สรุปข้อมูลจากไฟล์ที่เลือก มีสาระสำคัญ ตัวเลขหลัก ข้อเสนอแนะ และขั้นตอนถัดไป']]
    };
    const examples = q('starters'); examples.replaceChildren();
    for (const [title, prompt] of starters[id]) examples.append(button(title, () => {
      if (v.busy) return;
      if (q('prompt').value.trim() && !window.confirm('แทนที่คำอธิบายปัจจุบันด้วยแนวทางนี้หรือไม่?')) return;
      q('prompt').value = prompt; q('prompt').focus(); saveDraft(v);
    }));
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
    if (Array.isArray(sourceIds) && sourceIds.length) v.root.querySelector('.cs-options').open = true;
    if (Array.isArray(sourceIds)) v.sources = new Set(sourceIds.slice(0, sourceLimit(id)));
    v.sources = new Set([...v.sources].filter(fileId => { const file = v.files.find(item => item.id === fileId); return !file || sourceCompatible(file, id); }).slice(0, sourceLimit(id)));
    renderFiles(v); renderCapability(v); controls(v); showWorkspace(v,id);
  }
  function renderCapability(v) {
    if (!current(v)) return;
    const spec = v.catalog.find(item => item.id === v.active), node = v.root.querySelector('[data-studio-capability]');
    node.textContent = !spec ? 'ยังไม่ได้รับสถานะปลั๊กอิน กดรีเฟรชเพื่อตรวจอีกครั้ง' : spec.mode === 'never' ? 'Never · ปิดการเรียกใช้เครื่องมือนี้ ทั้งจากที่นี่และ Sentinel AI' : spec.available ? 'พร้อมใช้งาน · ใช้ไฟล์และประวัติงานร่วมกับ Sentinel AI' : 'ยังไม่พร้อม · ' + friendly(spec.reason || 'plugin_unavailable');
    v.root.querySelector('[data-studio-mode]').value = spec?.mode === 'never' ? 'never' : 'auto';
  }
  function renderFiles(v) {
    if (!current(v)) return;
    const select = v.root.querySelector('[data-editor-files]'), selected = v.selectedFiles[v.active] || select.value; select.replaceChildren(el('option','เลือกไฟล์…',{value:''}));
    const pattern = {image:/\.(png|jpe?g|webp)$/i,video:/\.(mp4|webm|mov|mkv)$/i,document:/\.docx$/i,spreadsheet:/\.xlsx$/i,presentation:/\.pptx$/i}[v.active];
    for(const file of v.files) if(pattern.test(file.name || '')) select.append(el('option',file.name,{value:file.id})); select.value=selected;
    v.root.querySelector('[data-editor-open]').disabled = !select.value;
    select.onchange = () => {v.selectedFiles[v.active]=select.value; v.root.querySelector('[data-editor-open]').disabled = !select.value; };
    v.root.querySelector('[data-editor-blank]').hidden = !['document','spreadsheet','presentation'].includes(v.active);v.root.querySelector('[data-editor-blank]').textContent={document:'＋ เอกสารใหม่',spreadsheet:'＋ สมุดงานใหม่',presentation:'＋ งานนำเสนอใหม่'}[v.active]||'เริ่มงานใหม่';
    const list = v.root.querySelector('[data-studio-files]'); list.replaceChildren();
    if (!v.files.length) list.append(el('p', v.filesError || 'ยังไม่มีไฟล์ต้นทาง เปิด “ไฟล์ของฉัน” เพื่ออัปโหลด หรือสร้างผลงานจากคำสั่งได้เลย', { class: 'cs-muted' }));
    for (const file of v.files) {
      if (!sourceCompatible(file, v.active)) continue;
      const label = el('label', null, { class: 'cs-check' }), check = el('input', null, { type: 'checkbox', 'data-source-file-id': file.id });
      check.checked = v.sources.has(file.id); check.disabled = v.busy;
      check.onchange = () => { if (check.checked && v.sources.size >= sourceLimit(v.active)) { check.checked = false; status(v, 'เครื่องมือนี้เลือกไฟล์ต้นทางได้ไม่เกิน ' + sourceLimit(v.active) + ' ไฟล์', true); return; } if (check.checked) v.sources.add(file.id); else v.sources.delete(file.id); };
      const name = el('span', file.name || file.id); name.append(el('small', String(file.contentType || 'ไฟล์') + ' · ' + Math.ceil(Number(file.size || 0) / 1024) + ' KB')); label.append(check, name); const row = el('div'); row.append(label, button('เปิดดู', () => previewFile(v, file, v.jobs.find(job => job.files?.some(item => item.id === file.id))), { 'data-preview-source': file.id })); if(editable(file)) row.append(button('แก้ไข',()=>openFile(v,file.id),{'data-edit-source':file.id})); list.append(row);
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
      if (!target) { target=file; type='text/plain'; note.textContent='ตัวอย่างข้อความจากไฟล์ Office · กดแก้ไขเพื่อเปิดตัวแก้ไขเต็ม'; }
      else type = 'text/html';
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
        actions.append(button('แชร์ไป Social Media', () => window.PanthoriumSocial?.open(file.contentType?.startsWith('video/') ? 'short' : file.contentType?.startsWith('image/') ? 'feed' : 'community', { sourceFileIds: [file.id] })));
        actions.append(button('เปิดดู', () => previewFile(v, file, job), { 'data-preview-file': file.id }));
        if(editable(file)) actions.append(button('แก้ไขในหน้านี้',()=>openFile(v,file.id),{'data-edit-file':file.id}));
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
    if (!v) return; v.closing=true;for(const [id,item]of v.workspaces||[]){item.editor?.destroy();window.PanthoriumStudioEditor?.dispose(item.host);}v.workspaces?.clear();clearPreview(v); clearTimeout(v.timer); v.controller.abort();
    for (const timer of v.urlTimers) clearTimeout(timer); for (const url of v.urls) URL.revokeObjectURL(url);
    v.urls.clear(); v.urlTimers.clear(); v.jobs = []; v.files = []; v.sources.clear(); v.drafts = {}; v.pending = null; v.approvals.clear();
    v.root.replaceChildren(); if (view === v) view = null;
  }
  function hasUnsaved(v){return current(v)&&[...v.workspaces.values()].some(item=>item.editor?.isDirty?.()||window.PanthoriumStudioEditor?.isDirty(item.host));}
  function voiceSnapshot(v){const item=v.workspaces.get(v.active);return JSON.stringify({owner:identity(),kind:v.active,state:item?.editor?.voiceSnapshot?.()??window.PanthoriumStudioEditor?.voiceSnapshot?.(item?.host)??'empty'});}
  function clearVoicePending(v){v.voicePending=null;v.root.querySelector('[data-voice-confirmation]')?.remove();}
  function voiceBackground(v,run,text){
    v.voiceBusy=true;status(v,text);
    Promise.resolve().then(run).then(result=>{if(current(v)&&result)status(v,result.text,!result.ok);}).catch(error=>{if(current(v))status(v,friendly(error),true);}).finally(()=>{v.voiceBusy=false;});
    return {ok:true,pending:true,text};
  }
  async function command(input){
    const ui=window.PanthoriumCreativeVoice,c=window.PanthoriumCreativeVoiceCatalog?.parse(input);
    if(!ui||!c)return {ok:false,error:'invalid_creative_command',text:'ยังไม่รู้จักคำสั่งนี้ พูด “คำสั่งเสียงสร้างสรรค์” เพื่อดูตัวอย่าง'};
    if(!allowed())return ui.fail('เข้าสู่ระบบด้วยบัญชีผู้ใช้ก่อนสั่งงานสร้างสรรค์');
    if(c.error)return {ok:false,...c};
    if(['open','new','help','open_file'].includes(c.action)&&!view)open(c.kind||'image');
    const v=view;if(!v||!current(v))return ui.fail('เปิดหมวดสร้างสรรค์และเอกสารก่อนสั่งแก้ไข');
    const shell=v.root.closest('.window');
    if(c.action==='open') {if(v.voicePending)return ui.fail('มีคำสั่งรอยืนยัน พูด ยืนยัน หรือ ยกเลิก ก่อน');open(c.kind);return v.active===c.kind?ui.ok('เปิด'+plugin(c.kind).title+'แล้ว'):ui.fail('รอคำขอปัจจุบันให้เสร็จก่อนเปลี่ยนหมวด');}
    if(shell&&(shell.hidden||getComputedStyle(shell).display==='none'))return ui.fail('เปิดหน้าต่างสร้างสรรค์ที่ย่อไว้ก่อนสั่งแก้ไข');
    if(c.action==='help'){v.root.querySelector('[data-creative-voice-help]').hidden=false;return ui.ok('แสดงตัวอย่างคำสั่งเสียงแล้ว เลือกเปิดไฟล์และชิ้นงานก่อนสั่งแก้ไข');}
    if(c.action==='help_close'){v.root.querySelector('[data-creative-voice-help]').hidden=true;return ui.ok('ปิดตัวอย่างคำสั่งเสียงแล้ว');}
    if(c.action==='cancel'){if(!v.voicePending)return ui.fail('ไม่มีคำสั่งสร้างสรรค์รอยืนยัน');clearVoicePending(v);return ui.ok('ยกเลิกคำสั่งแล้ว');}
    if(v.voiceBusy||v.busy||v.modeBusy)return ui.fail('กำลังดำเนินงานก่อนหน้า รอให้เสร็จก่อนสั่งอีกครั้ง');
    if(c.action==='confirm'){
      const activeHost=v.workspaces.get(v.active)?.host;if(activeHost?.contains(document.activeElement))document.activeElement.blur();
      const pending=v.voicePending;if(!pending)return ui.fail('ไม่มีคำสั่งสร้างสรรค์รอยืนยัน');clearVoicePending(v);
      if(pending.expires<Date.now()||pending.host!==v.workspaces.get(v.active)?.host||pending.snapshot!==voiceSnapshot(v))return ui.fail('งานหรือบัญชีเปลี่ยนหลังเสนอคำสั่ง หรือคำขอหมดอายุ กรุณาสั่งใหม่');
      return voiceBackground(v,pending.run,'กำลัง'+pending.label+' · ติดตามผลในพื้นที่งาน');
    }
    if(v.voicePending)return {ok:true,confirmationRequired:true,text:'มีคำสั่งรอยืนยัน พูด ยืนยัน หรือ ยกเลิก ก่อนสั่งงานถัดไป'};
    if(c.action==='new') {open(c.kind);if(v.active!==c.kind)return ui.fail('ยังเปลี่ยนหมวดไม่ได้');}
    const item=v.workspaces.get(v.active);if(!item)return ui.fail('พื้นที่งานยังไม่พร้อม');
    if(item.host.contains(document.activeElement))document.activeElement.blur();
    if(c.action==='open_selected'){
      const selected=v.root.querySelector('[data-editor-files]').value;
      if(!selected)return ui.fail('เลือกไฟล์ก่อน หรือพูด เปิดไฟล์ ตามด้วยชื่อและนามสกุล');
      return voiceBackground(v,async()=>{const opened=await openFile(v,selected),message=v.workspaces.get(v.active)?.host.querySelector('.ce-message');return opened===false||message?.dataset.error==='true'?ui.fail(message?.textContent||'ยังเปิดไฟล์ไม่ได้'):ui.ok('เปิดไฟล์ที่เลือกแล้ว');},'กำลังเปิดไฟล์ที่เลือก');
    }
    if(c.action==='open_file')return voiceBackground(v,async()=>{
      await loadFiles(v);if(!current(v))return;
      const name=c.text.normalize('NFC').toLocaleLowerCase(),matches=v.files.filter(f=>String(f.name).normalize('NFC').toLocaleLowerCase()===name);
      if(matches.length!==1)return ui.fail(matches.length?'มีไฟล์ชื่อนี้มากกว่าหนึ่งไฟล์ กรุณาเลือกไฟล์ในรายการ':'ไม่พบชื่อไฟล์นี้ในบัญชี ระบุชื่อและนามสกุลให้ตรงรายการ');
      const opened=await openFile(v,matches[0].id),message=v.workspaces.get(v.active)?.host.querySelector('.ce-message');
      return opened===false||message?.dataset.error==='true'?ui.fail(message?.textContent||'ยังเปิดไฟล์ไม่ได้'):ui.ok('เปิดไฟล์ '+matches[0].name+' แล้ว');
    },'กำลังค้นหาและเปิดไฟล์ในบัญชีนี้');
    if(c.action==='export'&&v.active!=='video')return ui.fail('เปิดหมวดวิดีโอก่อนส่งออก MP4 · เอกสารใช้คำสั่ง บันทึก');
    if(c.action==='download_png'&&v.active!=='image')return ui.fail('เปิดหมวดรูปภาพก่อนดาวน์โหลด PNG');
    if(c.action==='project'&&!item.editor)return ui.fail('เก็บโปรเจกต์ใช้กับรูปภาพและวิดีโอ · เอกสารใช้คำสั่ง บันทึก');
    if(c.action==='new'&&(item.editor?.isDirty?.()||window.PanthoriumStudioEditor?.isDirty(item.host)))return ui.fail('เก็บโปรเจกต์หรือบันทึกการแก้ไขในหมวดนี้ก่อนเริ่มงานใหม่');
    const run=async()=>{
      if(!current(v))return ui.fail('บัญชีเปลี่ยนแล้ว');
      if(c.action==='new'){
        const b=item.editor?ui.button(item.host,v.active==='image'?'＋ ใหม่':'โปรเจกต์ใหม่'):v.root.querySelector('[data-editor-blank]');
        await ui.click(b);return v.root.querySelector('[data-studio-status]').dataset.error==='true'?ui.fail(v.root.querySelector('[data-studio-status]').textContent):ui.ok('สร้างพื้นที่งานใหม่แล้ว');
      }
      return item.editor?item.editor.command(c):window.PanthoriumStudioEditor.command(item.host,c);
    };
    if(window.PanthoriumCreativeVoiceCatalog.needsConfirmation(c)){
      if(!item.editor&&!window.PanthoriumStudioEditor.voiceSnapshot(item.host)&&c.action!=='new')return ui.fail('เปิดไฟล์ที่ต้องการแก้ไขก่อน');
      const label=({save:'บันทึกฉบับใหม่',export:'ส่งออก MP4',download_png:'ดาวน์โหลด PNG',project:'เก็บโปรเจกต์',new:'เริ่ม'+plugin(v.active).title+'ใหม่'})[c.action];
      const card=el('div',null,{'data-voice-confirmation':'',role:'status',class:'cs-actions'});
      card.append(el('span',label+'ในหมวด'+plugin(v.active).title+' — พูด ยืนยัน หรือ ยกเลิก'),button('ยืนยัน',()=>command('ยืนยัน')),button('ยกเลิก',()=>command('ยกเลิก')));
      v.root.querySelector('[data-inline-workspace]').before(card);
      v.voicePending={run,label,host:item.host,snapshot:voiceSnapshot(v),expires:Date.now()+120000};
      return {ok:true,confirmationRequired:true,text:label+'ในหมวด'+plugin(v.active).title+'หรือไม่? พูด ยืนยัน หรือ ยกเลิก'};
    }
    const result=await run();if(current(v)&&result)status(v,result.text,!result.ok);return result;
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
    createWindow(ID, 'สร้างสรรค์และเอกสาร', markup(), { width: 1440, height: 820, onClose: () => cleanup(view) });
    const root = document.querySelector('.window[data-id="creative-studio"] [data-studio]'); if (!root) return false;
    const v = view = { root, owner: principal(), generation, active: 'image', drafts: {}, catalog: [], files: [], jobs: [], sources: new Set(), urls: new Set(), urlTimers: new Set(), advancing: new Set(), approvals: new Map(), workspaces:new Map(), selectedFiles:{}, controller: new AbortController(), busy: false, modeBusy: false, timer: null };
    root.closest('.window')?.addEventListener('panthorium:before-window-close',event=>{if(hasUnsaved(v)&&!window.confirm('มีงานที่ยังไม่ได้บันทึกหรือเก็บโปรเจกต์ ต้องการปิดหรือไม่?'))event.preventDefault();});
    const workspace=root.querySelector('[data-inline-workspace]'),filebar=root.querySelector('.cs-open-file');workspace.before(filebar);workspace.after(root.querySelector('[data-studio-status]'));
    filebar.prepend(el('span','ไฟล์',{class:'cs-file-label'}));
    const voiceHelp=el('section',null,{'data-creative-voice-help':'',hidden:'','aria-label':'คำสั่งเสียงสร้างสรรค์'});
    voiceHelp.style.cssText='position:absolute;right:12px;top:90px;z-index:15;width:min(430px,90%);max-height:65%;overflow:auto;padding:14px;background:#102332;border:1px solid #548598;border-radius:10px;box-shadow:0 12px 35px #0009';
    voiceHelp.append(el('strong','สั่งงานในพื้นที่ที่เปิดอยู่'),el('p','รูปภาพ: เพิ่มข้อความ สวัสดี · เพิ่มสี่เหลี่ยม · เปลี่ยนสีเป็น แดง · หมุนภาพ 90 องศา'),el('p','ปรับภาพ: เปิดเลเยอร์ · เลือกเลเยอร์ที่ 1 · ย้ายเลเยอร์ไปทางขวา 50 พิกเซล · ซูมพอดี · บันทึกภาพ'),el('p','วิดีโอ: เลื่อนไป 1 วินาที · แบ่งคลิป · เพิ่มคำบรรยาย สวัสดี'),el('p','เอกสาร: เพิ่มย่อหน้า รายละเอียดงาน · เลือกย่อหน้าที่ 2 · ตัวหนา'),el('p','ตาราง: เปลี่ยน B2 เป็น 500 · ใส่สูตร B3 เป็น =SUM(B1:B2)'),el('p','นำเสนอ: เพิ่มสไลด์ สรุปงาน · สไลด์ถัดไป · เริ่มนำเสนอ'),el('p','ทุกหมวด: ย้อนกลับ · ทำซ้ำ · บันทึก · ยืนยัน / ยกเลิก · ปิดไมค์'),button('เริ่มสั่งด้วยเสียง',async()=>{const r=await window.PanthoriumCreativeVoice.start(v.active);if(current(v)){status(v,r.text,!r.ok);if(r.ok)voiceHelp.hidden=true;}}),button('ปิดตัวอย่าง',()=>{voiceHelp.hidden=true;}));
    root.append(voiceHelp);
    const voiceButton=button('🎙 เริ่มสั่งด้วยเสียง',async()=>{
      if(v.voiceStarting)return;v.voiceStarting=true;voiceButton.disabled=true;
      try{
        if(window.PanthoriumLiveVoice?.isActive()){window.PanthoriumLiveVoice.stop();status(v,'หยุดรับคำสั่งเสียงแล้ว');}
        else{const r=await window.PanthoriumCreativeVoice.start(v.active);if(current(v)){status(v,r.text,!r.ok);if(r.ok)voiceHelp.hidden=true;}}
      }catch(error){if(current(v))status(v,error.message||'เปิดไมโครโฟนไม่สำเร็จ',true);}
      finally{v.voiceStarting=false;if(current(v)){voiceButton.disabled=false;syncVoiceButton();}}
    },{'data-studio-voice':'','aria-pressed':'false','aria-label':'เริ่มสั่งด้วยเสียง'});
    const syncVoiceButton=()=>{if(!current(v))return;const active=!!window.PanthoriumLiveVoice?.isActive(),label=active?'หยุดฟัง':'เริ่มสั่งด้วยเสียง';voiceButton.textContent=(active?'■ ':'🎙 ')+label;voiceButton.setAttribute('aria-label',label);voiceButton.setAttribute('aria-pressed',String(active));};
    window.addEventListener('panthorium:live-state',syncVoiceButton,{signal:v.controller.signal});
    filebar.append(voiceButton,button('คำสั่งเสียง',()=>{voiceHelp.hidden=!voiceHelp.hidden;},{'aria-label':'ดูตัวอย่างคำสั่งเสียง'}));syncVoiceButton();
    const importInput=el('input',null,{type:'file',accept:'.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov,.mkv',hidden:''});
    filebar.append(button('นำเข้าไฟล์',()=>importInput.click()),importInput);
    importInput.onchange=async()=>{const file=importInput.files?.[0];if(!file)return;if(file.size>20*1024*1024)return status(v,'รองรับไฟล์ไม่เกิน 20 MB',true);try{const data=await api(v,'/api/files',{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','x-file-name':encodeURIComponent(file.name),'x-file-content-type':file.type||'application/octet-stream'}});if(!current(v))return;v.files.unshift(data.file);renderFiles(v);await openFile(v,data.file.id);}catch(e){status(v,friendly(e),true);}finally{importInput.value='';}};
    const drawer=which=>{const layout=root.querySelector('.cs-layout'),panel=root.querySelector('[data-'+which+'-panel]'),same=!layout.hidden&&!panel.hidden;layout.hidden=same;for(const key of ['create','history']){root.querySelector('[data-'+key+'-panel]').hidden=key!==which;root.querySelector('[data-toggle-'+key+']').setAttribute('aria-expanded',String(!same&&key===which));}};
    root.querySelector('[data-toggle-create]').onclick=()=>drawer('create');root.querySelector('[data-toggle-history]').onclick=()=>drawer('history');
    const tabs = root.querySelector('[data-studio-tabs]');
    for (const item of PLUGINS) {
      const tab = button('', () => selectPlugin(v, item.id), { id: 'studio-tab-' + item.id, role: 'tab', 'aria-selected': 'false', 'aria-controls': 'studio-editor-panel', 'data-plugin-id': item.id });
      const icon = window.PanthoriumStartMenuUI?.icon?.(item.icon); if (icon) tab.append(icon); tab.append(el('span', item.title)); tabs.append(tab);
      tab.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const i = PLUGINS.findIndex(p => p.id === v.active), target = event.key === 'Home' ? 0 : event.key === 'End' ? PLUGINS.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + PLUGINS.length) % PLUGINS.length; selectPlugin(v, PLUGINS[target].id); tabs.children[target].focus(); tabs.children[target].scrollIntoView?.({block:'nearest',inline:'nearest'}); };
    }
    root.querySelector('[data-preview-close]').onclick = () => { clearPreview(v); root.querySelector('[data-preview-body]').append(el('p', 'เลือกเปิดดูจากไฟล์ผลงานด้านล่าง')); root.querySelector('[data-preview-name]').textContent = 'ภาพ วิดีโอ และเอกสาร'; root.querySelector('[data-preview-note]').textContent = ''; root.querySelector('[data-preview-close]').hidden = true; };
    root.querySelector('[data-studio-form]').onsubmit = event => submit(v, event);
    root.querySelector('[data-studio-refresh]').onclick = () => refresh(v);
    root.querySelector('[data-studio-refresh-files]').onclick = () => loadFiles(v);
    root.querySelector('[data-editor-open]').onclick=()=>{const id=root.querySelector('[data-editor-files]').value;if(id)openFile(v,id);else status(v,'เลือกไฟล์ที่ต้องการแก้ไขก่อน',true);};
    root.querySelector('[data-editor-blank]').onclick=async event=>{
      const contents={document:{title:'เอกสารใหม่',sections:[{paragraphs:['เริ่มเขียนที่นี่']}]},spreadsheet:{title:'ตารางใหม่',sheets:[{name:'ข้อมูล',rows:[['หัวข้อ','ค่า'],['', '']]}]},presentation:{title:'งานนำเสนอใหม่',slides:[{title:'หัวข้อสไลด์',bullets:['เริ่มเขียนที่นี่']}]}};
      if(!contents[v.active])return;const active=v.workspaces.get(v.active);if(window.PanthoriumStudioEditor?.isDirty(active?.host)){status(v,'บันทึกการแก้ไขในไฟล์ปัจจุบันก่อนสร้างไฟล์ใหม่',true);return;}const pluginId=v.active;event.currentTarget.disabled=true;
      try {const data=await post(v,'/api/studio/jobs',{pluginId,input:{prompt:'สร้างไฟล์เปล่าเพื่อแก้ไขด้วยมือ',content:contents[pluginId]},idempotencyKey:'blank:'+crypto.randomUUID(),confirmed:true});if(!current(v))return;putJob(v,data.job);renderJobs(v);if(data.job.status==='completed')await openFile(v,data.job.files.find(f=>/\.(docx|xlsx|pptx)$/i.test(f.name))?.id,pluginId);else schedule(v,1000);}
      catch(error){status(v,friendly(error),true);}finally{if(current(v))root.querySelector('[data-editor-blank]').disabled=false;}
    };
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
    if (!allowed() || !['studio.create','studio.edit'].includes(result?.toolId) || result.requiresConfirmation !== true || confirmation?.toolId !== result?.toolId || !/^[a-f0-9]{64}$/i.test(confirmation.approvalHash || '') || typeof confirmation.actionId !== 'string') return false;
    const args = confirmation.args || {}, steps = result.toolId === 'studio.edit' ? [{pluginId:args.pluginId,input:{name:args.name,revision:args.revision,operations:args.operations},sourceFileIds:[args.fileId]}] : Array.isArray(args.steps) ? args.steps : [args];
    open(steps[0]?.pluginId || 'image'); const v = view; if (!v || !current(v) || v.approvals.has(confirmation.actionId)) return false;
    const card = el('section', null, { class: 'cs-job', 'data-studio-approval': confirmation.actionId }), controls = el('div', null, { class: 'cs-actions' });
    card.append(el('h2', result.toolId === 'studio.edit' ? 'ยืนยันการแก้ไขผลงานหรือไม่' : 'ยืนยันการสร้างผลงานหรือไม่'), el('p', 'งานสร้างเอกสารและสื่ออาจใช้โควตาหรือมีค่าใช้จ่ายตามบริการที่เลือก'));
    for (const [index, step] of steps.entries()) {
      card.append(el('h3', (index + 1) + '. ' + (plugin(step.pluginId)?.title || 'เอกสารและสื่อ')));
      const presentation = window.PanthoriumActionPresentation?.describe({toolId:result.toolId,args:step.input || {}});
      for (const text of presentation?.details || []) { const line = el('p', text); line.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'; card.append(line); }
      const sources = step.sourceFileIds || [];
      if (sources.length) card.append(el('p', 'ไฟล์ต้นทาง: ' + sources.map((id, i) => v.files.find(file => file.id === id)?.name || 'ไฟล์ที่เลือก ' + (i + 1)).join(', ')));
      if (step.usePrevious === true) card.append(el('p', 'ใช้ผลงานจากขั้นตอนก่อนหน้า'));
      if (step.input?.operations?.length) card.append(el('p', 'แก้ไขเนื้อหา ' + step.input.operations.length + ' รายการ และบันทึกเป็นฉบับใหม่'));
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
  window.addEventListener('beforeunload',event=>{if(view&&hasUnsaved(view)){event.preventDefault();event.returnValue='';}});
  window.PanthoriumCreativeStudio = Object.freeze({ open, close, editFile, review, showJob, command, hasVoicePending:()=>!!view&&current(view)&&!!view.voicePending, refresh: () => view && refresh(view), openImage: () => open('image'), openVideo: () => open('video'), openDocument: () => open('document'), openSpreadsheet: () => open('spreadsheet'), openPresentation: () => open('presentation') });
  window.addEventListener('panthorium:ai-done', event => {
    for (const result of event.detail?.toolResults || []) {
      if(event.detail?.source!=='gemini-live'&&event.detail?.accountId===principal()&&result.toolId==='studio.command'&&result.ok&&result.output?.uiAction?.startsWith('studio_command:')){window.PanthoriumVoiceCommands?.windowAction(result.output.uiAction);continue;}
      if (result.toolId === 'studio.editor' && result.ok && result.output?.openEditor) { window.PanthoriumStudioEditor?.open(result.output.file?.id); continue; }
      if (!['studio.create','studio.edit'].includes(result.toolId)) continue;
      if (result.requiresConfirmation) review(result);
      else if (result.ok && result.output?.job) showJob(result.output.job);
    }
  });
  for (const name of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:boot-complete']) window.addEventListener(name, authChanged);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMenu, { once: true }); else installMenu();
})();
