(function () {
  'use strict';
  let active = null;
  const owner = () => String((typeof OS !== 'undefined' && (OS.state?.user?.sub || OS.state?.user?.id)) || '');
  const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const messages = {
    file_preview_unsupported: 'ไฟล์ชนิดนี้ยังเปิดดูภายในระบบไม่ได้ ใช้ปุ่มดาวน์โหลดเพื่อเปิดด้วยโปรแกรมที่รองรับ',
    file_preview_too_large: 'ไฟล์ใหญ่เกินขนาดตัวอย่างที่รองรับ (20 MB)',
    file_preview_invalid_office: 'อ่านเนื้อหา Office ไม่สำเร็จ ไฟล์อาจเสียหาย เข้ารหัส หรือมีโครงสร้างที่ยังไม่รองรับ',
    file_not_found: 'ไม่พบไฟล์นี้ในบัญชีปัจจุบัน กรุณารีเฟรชรายการไฟล์',
    files_storage_permission_denied: 'บริการไฟล์ยังไม่มีสิทธิ์เข้าถึงพื้นที่จัดเก็บ กรุณาติดต่อผู้ดูแล',
    files_storage_unavailable: 'บริการจัดเก็บไฟล์ไม่พร้อมชั่วคราว กรุณาลองอีกครั้ง',
    account_required: 'กรุณาเข้าสู่ระบบบัญชีเจ้าของไฟล์'
  };
  function cleanup(v) {
    if (!v || v.closed) return;
    v.closed = true; v.controller.abort(); v.observer?.disconnect();
    v.body?.replaceChildren();
    if (v.url) URL.revokeObjectURL(v.url);
    if (active === v) active = null;
  }
  function close() {
    const v = active; if (!v) return;
    cleanup(v);
    if (typeof closeWindow === 'function') closeWindow('file-preview');
    else window.PanthoriumWindowManager?.close?.('file-preview');
    v.root?.closest('.window')?.remove();
  }
  function readableDocument(html) {
    // Parse only in inert template content. Rebuild an allowlist; never render
    // uploaded HTML directly, execute scripts or request remote resources.
    const template = document.createElement('template'); template.innerHTML = html;
    const output = el('div');
    const tags = new Set('h1 h2 h3 h4 h5 h6 p div span section article main header footer figure figcaption table thead tbody tfoot tr th td ul ol li strong b em i u br hr img'.split(' '));
    const skip = new Set('script style iframe object embed svg math form input button textarea select link meta base audio video source'.split(' '));
    let count = 0;
    function copy(source, target, depth) {
      if (++count > 25000 || depth > 60) return;
      if (source.nodeType === 3) { target.append(document.createTextNode(source.textContent)); return; }
      if (source.nodeType !== 1 || skip.has(source.localName)) return;
      if (!tags.has(source.localName)) { for (const child of source.childNodes) copy(child, target, depth + 1); return; }
      const node = el(source.localName);
      if (source.localName === 'img') {
        const src = source.getAttribute('src') || '';
        if (src.length > 12 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src)) return;
        node.setAttribute('src', src); node.setAttribute('alt', source.getAttribute('alt') || 'ภาพประกอบ');
      }
      if (source.classList.contains('slide')) node.className = 'slide';
      for (const name of ['colspan', 'rowspan']) if (/^\d{1,2}$/.test(source.getAttribute(name) || '')) node.setAttribute(name, String(Math.min(40, Number(source.getAttribute(name)))));
      for (const child of source.childNodes) copy(child, node, depth + 1);
      target.append(node);
    }
    for (const child of template.content.childNodes) copy(child, output, 0);
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>body{font:15px/1.7 Tahoma,sans-serif;color:#20252c;background:#fff;padding:20px;margin:0;overflow-wrap:anywhere}h1{font-size:24px}h2{font-size:19px}p{white-space:pre-wrap}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#eee}img{max-width:100%;height:auto}.slide{border-bottom:2px solid #ddd;padding:20px 0;margin-bottom:20px}</style></head><body>' + output.innerHTML + '</body></html>';
  }
  async function open(file) {
    close();
    const userId = owner();
    if (!userId || userId.startsWith('guest:')) return false;
    createWindow('file-preview', 'เปิดดูไฟล์', '<section data-file-preview style="height:100%;display:flex;flex-direction:column;gap:12px;padding:16px;box-sizing:border-box;overflow:auto"><h3 data-file-preview-name style="margin:0;overflow-wrap:anywhere"></h3><div data-file-preview-note role="status"></div><div data-file-preview-body style="min-height:0;flex:1;overflow:auto"></div></section>', { width: 900, height: 660, onClose: () => cleanup(v) });
    const root = document.querySelector('[data-file-preview]');
    if (!root) return false;
    const body = root.querySelector('[data-file-preview-body]'), note = root.querySelector('[data-file-preview-note]');
    const v = { root, body, owner: userId, controller: new AbortController(), closed: false, url: null };
    active = v;
    const live = () => active === v && !v.closed && root.isConnected && owner() === userId;
    v.observer = new MutationObserver(() => { if (!root.isConnected) cleanup(v); });
    v.observer.observe(document.body, { childList: true, subtree: true });
    root.querySelector('[data-file-preview-name]').textContent = file.name || 'ไฟล์';
    note.textContent = 'กำลังเปิดไฟล์…';
    const timer = setTimeout(() => v.controller.abort(), 120000);
    try {
      const base = String(OS.config?.backendUrl || '').replace(/\/$/, '');
      const response = await authorizedFetch(base + '/api/files/' + encodeURIComponent(file.id) + '/preview', { signal: v.controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || (response.status === 401 ? 'account_required' : 'files_storage_unavailable')); }
      if (!live()) return false;
      const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      const format = response.headers.get('x-panthorium-preview');
      note.textContent = format === 'office-text' ? 'ตัวอย่างข้อความและข้อมูลจากไฟล์ Office (อาจแสดงเพียงบางส่วน) ไม่รวมรูปแบบ รูปภาพ และการคำนวณสูตร · เปิดไฟล์ .print.html เพื่อดูฉบับจัดหน้าที่สร้างไว้' : 'เปิดดูภายในระบบ · ไม่หักโควต้าดาวน์โหลด';
      if (type === 'text/html' || type === 'text/plain') {
        const text = await response.text(); if (!live()) return false;
        if (type === 'text/html') {
          const frame = el('iframe'); frame.title = 'ตัวอย่างเอกสาร'; frame.setAttribute('sandbox', ''); frame.referrerPolicy = 'no-referrer';
          frame.srcdoc = readableDocument(text); frame.style.cssText = 'width:100%;height:100%;min-height:400px;background:white;border:0'; body.append(frame);
        } else { const pre = el('pre', text); pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;tab-size:8;padding:12px'; body.append(pre); }
      } else {
        const blob = await response.blob(); if (!live()) return false;
        if (blob.size > 20 * 1024 * 1024) throw Error('file_preview_too_large');
        const tag = type.startsWith('image/') ? 'img' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : null;
        if (!tag) throw Error('file_preview_unsupported');
        v.url = URL.createObjectURL(new Blob([blob], { type }));
        const media = el(tag); media.src = v.url;
        media.style.cssText = 'max-width:100%;max-height:100%;display:block;margin:auto';
        if (tag === 'img') media.alt = file.name || 'ภาพ';
        else { media.controls = true; media.preload = 'metadata'; media.setAttribute('playsinline', ''); }
        media.onerror = () => { if (live()) note.textContent = 'เบราว์เซอร์นี้ถอดรหัสไฟล์ไม่ได้ หรือไฟล์เสียหาย ลองเปิดด้วยโปรแกรมที่รองรับ'; };
        body.append(media);
      }
      return true;
    } catch (error) { if (live()) note.textContent = messages[error.message] || 'เปิดไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง'; return false; }
    finally { clearTimeout(timer); }
  }
  window.PanthoriumFilePreview = Object.freeze({ open, close, readableDocument });
  window.addEventListener('panthorium:auth-changed', () => { if (active && owner() !== active.owner) close(); });
})();
