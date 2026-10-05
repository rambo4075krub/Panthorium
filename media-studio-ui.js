(function () {
  'use strict';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  let currentUrl = '';

  function os() { try { return typeof OS !== 'undefined' ? OS : null; } catch (_) { return null; } }
  function token() { return os()?.config?.accessToken || ''; }
  async function ensureToken() {
    if (token()) return token();
    if (window.PanthoriumAuth?.refreshSession) {
      await window.PanthoriumAuth.refreshSession().catch(() => false);
    }
    return token();
  }
  async function api(path, options = {}) {
    const accessToken = await ensureToken();
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    let response = await fetch(path, { ...options, headers, credentials: 'include' });
    if (response.status === 401 && window.PanthoriumAuth?.refreshSession) {
      await window.PanthoriumAuth.refreshSession().catch(() => false);
      const fresh = token();
      if (fresh) {
        headers.Authorization = 'Bearer ' + fresh;
        response = await fetch(path, { ...options, headers, credentials: 'include' });
      }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    return data;
  }
  function formatError(code) {
    return ({
      account_required: 'ต้องเข้าสู่ระบบบัญชีก่อน',
      staff_access_required: 'บัญชีนี้ไม่มีสิทธิ์ใช้ Media Studio',
      files_storage_unconfigured: 'ยังไม่ได้ตั้งค่า Cloud Files',
      file_not_found: 'ไม่พบไฟล์นี้ในบัญชีของคุณ',
      video_file_required: 'เลือกไฟล์วิดีโอที่รองรับ',
      video_file_too_large: 'วิดีโอมีขนาดเกิน 20 MB',
      transcription_provider_unavailable: 'บริการถอดเสียงยังไม่พร้อมใช้งาน',
      transcription_uncertain: 'เสียงไม่ชัดพอที่จะถอดความ',
      transcription_clip_too_long: 'ถอดเสียงได้ครั้งละไม่เกิน 3 นาที',
      invalid_clip_range: 'ช่วงเวลาคลิปไม่ถูกต้อง (สูงสุด 120 วินาที)',
      clip_range_exceeds_video: 'เวลาสิ้นสุดเกินความยาววิดีโอ',
      invalid_srt: 'รูปแบบคำบรรยาย SRT ไม่ถูกต้อง',
      caption_time_out_of_range: 'เวลาใน SRT ต้องอยู่ในช่วงคลิปที่ส่งออก',
      render_too_large: 'ไฟล์ที่เรนเดอร์เกิน 20 MB กรุณาลดความยาวคลิป',
      media_worker_busy: 'ตัวเรนเดอร์กำลังทำงานกับอีกคลิป กรุณาลองอีกครั้ง',
      media_encoder_unavailable: 'ระบบเรนเดอร์วิดีโอยังไม่พร้อม'
    })[code] || code || 'ดำเนินการไม่สำเร็จ';
  }
  function setStatus(root, message, error = false) {
    const status = root.querySelector('[data-media-status]');
    if (!status) return;
    status.textContent = message;
    status.style.color = error ? '#ff9aaa' : '#93a9be';
  }
  function fileOption(file) {
    const option = document.createElement('option');
    option.value = file.id;
    option.textContent = file.name + ' · ' + (Math.round(Number(file.size || 0) / 1024 / 1024 * 10) / 10) + ' MB';
    return option;
  }
  async function refreshFiles(root, keepId = '') {
    const select = root.querySelector('[data-media-file]');
    const data = await api('/api/media/files');
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = data.files?.length ? 'เลือกวิดีโอจาก Cloud Files' : 'ยังไม่มีวิดีโอใน Cloud Files';
    select.appendChild(placeholder);
    for (const file of data.files || []) select.appendChild(fileOption(file));
    const selected = (data.files || []).find(file => file.id === keepId);
    select.value = selected?.id || '';
    return selected || null;
  }
  async function loadPreview(root, fileId) {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = '';
    const preview = root.querySelector('[data-media-preview]');
    preview.removeAttribute('src');
    if (!fileId) return;
    const accessToken = await ensureToken();
    const response = await fetch('/api/files/' + encodeURIComponent(fileId), { headers: { Authorization: 'Bearer ' + accessToken }, credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'file_download_failed');
    }
    currentUrl = URL.createObjectURL(await response.blob());
    preview.src = currentUrl;
    preview.onloadedmetadata = () => {
      root.querySelector('[data-end]').value = String(Math.max(0.1, preview.duration || 0).toFixed(1));
      root.querySelector('[data-start]').max = String(preview.duration || 0);
      root.querySelector('[data-end]').max = String(preview.duration || 0);
      setStatus(root, 'วิดีโอพร้อม · ' + (Math.round((preview.duration || 0) * 10) / 10) + ' วินาที');
    };
  }
  async function uploadVideo(root, input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus(root, 'ขนาดไฟล์เกิน 20 MB', true);
      input.value = '';
      return;
    }
    if (!file.type.startsWith('video/')) {
      setStatus(root, 'เลือกไฟล์วิดีโอเท่านั้น', true);
      input.value = '';
      return;
    }
    setStatus(root, 'กำลังอัปโหลดวิดีโอ…');
    try {
      const accessToken = await ensureToken();
      const response = await fetch('/api/files', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-File-Content-Type': file.type || 'video/mp4'
        },
        body: file,
        credentials: 'include'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'upload_failed');
      await refreshFiles(root, data.file?.id || '');
      await loadPreview(root, data.file?.id || '');
      setStatus(root, 'อัปโหลดวิดีโอแล้ว');
    } catch (error) { setStatus(root, formatError(error.message), true); }
    finally { input.value = ''; }
  }
  async function saveTranscript(root) {
    const text = root.querySelector('[data-transcript]').value.trim();
    const fileId = root.querySelector('[data-media-file]').value;
    if (!text || !fileId) return setStatus(root, 'เลือกวิดีโอและถอดเสียงก่อนบันทึก transcript', true);
    const button = root.querySelector('[data-save-transcript]');
    button.disabled = true;
    setStatus(root, 'กำลังบันทึก transcript ใน Cloud Files…');
    try {
      const files = await api('/api/media/files');
      const source = (files.files || []).find(file => file.id === fileId);
      const base = String(source?.name || 'video').replace(/\.[^.]+$/, '').slice(0, 150) || 'video';
      const accessToken = await ensureToken();
      const response = await fetch('/api/files', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(base + '-transcript.txt'),
          'X-File-Content-Type': 'text/plain'
        },
        body: new Blob([text], { type: 'text/plain;charset=utf-8' }),
        credentials: 'include'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'transcript_save_failed');
      setStatus(root, 'บันทึก transcript ใน Cloud Files แล้ว · ' + (result.file?.name || base + '-transcript.txt'));
    } catch (error) { setStatus(root, formatError(error.message), true); }
    finally { button.disabled = false; }
  }
  function srtTime(seconds) {
    const value = Math.max(0, Math.floor(seconds * 1000));
    const hours = String(Math.floor(value / 3600000)).padStart(2, '0');
    const minutes = String(Math.floor(value / 60000) % 60).padStart(2, '0');
    const secs = String(Math.floor(value / 1000) % 60).padStart(2, '0');
    const millis = String(value % 1000).padStart(3, '0');
    return hours + ':' + minutes + ':' + secs + ',' + millis;
  }
  function roughSrt(text, duration) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source || !(duration > 0)) return '';
    let sentences = [];
    try {
      if (Intl.Segmenter) sentences = [...new Intl.Segmenter('th', { granularity: 'sentence' }).segment(source)].map(part => part.segment.trim()).filter(Boolean);
    } catch (_) {}
    if (!sentences.length) sentences = source.split(/(?<=[.!?。！？])\s*/).map(value => value.trim()).filter(Boolean);
    const chunks = [];
    for (const sentence of sentences) {
      const graphemes = Array.from(sentence);
      while (graphemes.length) chunks.push(graphemes.splice(0, 42).join('').trim());
    }
    const clean = chunks.filter(Boolean);
    if (!clean.length) return '';
    const weights = clean.map(value => Math.max(1, Array.from(value).length));
    const total = weights.reduce((a, b) => a + b, 0);
    let offset = 0;
    return clean.map((value, index) => {
      const start = duration * offset / total;
      offset += weights[index];
      const end = Math.max(start + 0.6, duration * offset / total);
      return (index + 1) + '\n' + srtTime(start) + ' --> ' + srtTime(Math.min(duration, end)) + '\n' + value;
    }).join('\n\n');
  }
  async function transcribe(root) {
    const fileId = root.querySelector('[data-media-file]').value;
    if (!fileId) return setStatus(root, 'เลือกวิดีโอก่อน', true);
    setStatus(root, 'กำลังถอดเสียง…');
    try {
      const result = await api('/api/media/transcribe', { method: 'POST', body: JSON.stringify({ fileId, language: root.querySelector('[data-language]').value }) });
      root.querySelector('[data-transcript]').value = result.text || '';
      root.querySelector('[data-captions]').value = roughSrt(result.text, Number(root.querySelector('[data-end]').value) - Number(root.querySelector('[data-start]').value));
      setStatus(root, 'ถอดเสียงแล้ว · เวลาคำบรรยายเป็นค่าประมาณ แก้ SRT ก่อนส่งออกได้');
    } catch (error) { setStatus(root, formatError(error.message), true); }
  }
  async function render(root) {
    const fileId = root.querySelector('[data-media-file]').value;
    if (!fileId) return setStatus(root, 'เลือกวิดีโอก่อน', true);
    const button = root.querySelector('[data-render]');
    button.disabled = true;
    setStatus(root, 'กำลังตัดต่อและเรนเดอร์…');
    try {
      const result = await api('/api/media/render', {
        method: 'POST',
        body: JSON.stringify({
          fileId,
          startSeconds: Number(root.querySelector('[data-start]').value),
          endSeconds: Number(root.querySelector('[data-end]').value),
          captionsSrt: root.querySelector('[data-captions]').value,
          aspect: root.querySelector('[data-aspect]').value,
          name: root.querySelector('[data-name]').value
        })
      });
      await refreshFiles(root, result.file.id);
      await loadPreview(root, result.file.id);
      setStatus(root, 'เรนเดอร์เสร็จ · บันทึก MP4 ใน Cloud Files แล้ว · ไม่มีการดาวน์โหลดลงเครื่อง');
    } catch (error) { setStatus(root, formatError(error.message), true); }
    finally { button.disabled = false; }
  }
  function close(root) {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = '';
    root.remove();
  }
  function accountUser() {
    const user = os()?.state?.user;
    return !!user && !String(user.id || '').startsWith('guest:')
      && !(user.roles || []).includes('guest') && (user.permissions || []).includes('chat');
  }
  function installLauncher() {
    const menu = document.getElementById('sm-apps');
    const entry = window.PanthoriumWindowCatalog?.apps.find(app => app.id === 'media-studio');
    const user = os()?.state?.user;
    const existing = document.getElementById('media-studio-launcher');
    if (!menu || !entry || !window.PanthoriumWindowCatalog.allowed(entry, user)) {
      existing?.remove();
      const root = document.getElementById('media-studio-dashboard');
      if (root) close(root);
      return false;
    }
    if (existing) return true;
    if (menu.querySelector('[data-app-id=\"media-studio\"]')) return true;
    const button = document.createElement('button');
    button.id = 'media-studio-launcher';
    button.type = 'button';
    button.className = 'sm-app';
    button.dataset.appId = 'media-studio';
    button.innerHTML = '<div class="ico">🎬</div><span>Media Studio</span>';
    button.onclick = () => { open(); document.getElementById('start-menu')?.classList.remove('open'); };
    menu.appendChild(button);
    window.dispatchEvent(new CustomEvent('panthorium:apps-changed', { detail: { app: 'media-studio' } }));
    return true;
  }
  function open() {
    if (!accountUser() || !window.PanthoriumWindowCatalog?.allowed(window.PanthoriumWindowCatalog.apps.find(app => app.id === 'media-studio'), os()?.state?.user)) {
      if (typeof toast === 'function') toast('Media Studio ใช้ได้สำหรับบัญชีผู้ใช้ที่เข้าสู่ระบบ');
      return;
    }
    const existing = document.getElementById('media-studio-dashboard');
    if (existing) return existing.focus();
    const root = document.createElement('section');
    root.id = 'media-studio-dashboard';
    root.tabIndex = -1;
    root.style.cssText = 'position:fixed;inset:3%;z-index:10030;background:rgba(7,11,18,.99);border:1px solid #2e5663;border-radius:16px;color:#e2e8f0;padding:16px;display:flex;flex-direction:column;gap:10px;box-shadow:0 24px 80px #000;font-family:system-ui;overflow:auto';
    root.innerHTML = '<header style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><h2 style="margin:0">🎬 Media Studio</h2><div data-media-status style="font-size:11px;color:#93a9be">เลือกวิดีโอจาก Cloud Files หรืออัปโหลดไฟล์ไม่เกิน 20 MB</div></div><button type="button" data-close aria-label="ปิด">✕</button></header><div style="display:flex;gap:8px;flex-wrap:wrap"><select data-media-file style="flex:1;min-width:220px;padding:9px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px"></select><button type="button" data-refresh>รีเฟรชไฟล์</button><label style="padding:8px;border:1px solid #334155;border-radius:8px;cursor:pointer">อัปโหลดวิดีโอ<input data-upload type="file" accept="video/*" style="display:none"></label></div><div style="display:grid;grid-template-columns:minmax(240px,1fr) minmax(280px,1fr);gap:12px;align-items:start"><div><video data-media-preview controls playsinline style="width:100%;max-height:48vh;background:#000;border-radius:10px"></video><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px"><label>เริ่ม (วินาที)<input data-start type="number" min="0" step="0.1" value="0" style="width:100%;padding:8px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px"></label><label>จบ (วินาที)<input data-end type="number" min="0.1" step="0.1" value="10" style="width:100%;padding:8px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px"></label><label>อัตราส่วนภาพ<select data-aspect style="width:100%;padding:8px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px"><option value="original">ต้นฉบับ</option><option value="vertical">แนวตั้ง 9:16</option><option value="square">จัตุรัส 1:1</option><option value="widescreen">กว้าง 16:9</option></select></label><label>ชื่อไฟล์ส่งออก<input data-name maxlength="180" placeholder="เว้นว่างเพื่อใช้ชื่อเดิม" style="width:100%;padding:8px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px"></label></div></div><div style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;gap:8px;align-items:center"><label>ภาษาเสียง<select data-language style="padding:8px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px"><option value="th">ไทย</option><option value="en">English</option></select></label><button type="button" data-transcribe>ถอดเสียง</button><button type="button" data-rough>สร้างเวลา SRT ใหม่</button><button type="button" data-save-transcript>บันทึก transcript ลง Cloud Files</button></div><label>ข้อความถอดเสียง<textarea data-transcript rows="4" style="width:100%;padding:9px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px;resize:vertical"></textarea></label><label>คำบรรยาย SRT · เวลาสัมพัทธ์กับคลิปที่ส่งออก<textarea data-captions rows="9" placeholder="1\n00:00:00,000 --> 00:00:02,000\nข้อความคำบรรยาย" style="width:100%;padding:9px;background:#101827;color:#e2e8f0;border:1px solid #334155;border-radius:8px;font:12px/1.4 monospace;resize:vertical"></textarea></label><div style="font-size:11px;color:#91a4ba">เวลาที่สร้างจาก transcript เป็นค่าประมาณ โปรดตรวจข้อความและเวลาใน SRT ก่อนเรนเดอร์ · ตัดคลิปได้สูงสุด 120 วินาที</div></div></div><footer style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-render style="padding:10px 16px">ตัดต่อและบันทึก MP4 ใน Cloud Files</button><span data-cloud-only style="font-size:11px;color:#91a4ba;align-self:center">ไฟล์ผลลัพธ์เก็บใน Cloud Files ของบัญชีนี้</span></footer>';
    document.body.appendChild(root);
    root.querySelector('[data-close]').onclick = () => close(root);
    root.querySelector('[data-refresh]').onclick = async () => { try { await refreshFiles(root, root.querySelector('[data-media-file]').value); setStatus(root, 'โหลดรายการวิดีโอแล้ว'); } catch (error) { setStatus(root, formatError(error.message), true); } };
    root.querySelector('[data-media-file]').onchange = async () => {
      try { await loadPreview(root, root.querySelector('[data-media-file]').value); }
      catch (error) { setStatus(root, formatError(error.message), true); }
    };
    root.querySelector('[data-upload]').onchange = event => uploadVideo(root, event.target);
    root.querySelector('[data-transcribe]').onclick = () => transcribe(root);
    root.querySelector('[data-save-transcript]').onclick = () => saveTranscript(root);
    root.querySelector('[data-rough]').onclick = () => {
      const duration = Number(root.querySelector('[data-end]').value) - Number(root.querySelector('[data-start]').value);
      root.querySelector('[data-captions]').value = roughSrt(root.querySelector('[data-transcript]').value, duration);
      setStatus(root, 'สร้างเวลาคำบรรยายแบบประมาณแล้ว · ตรวจและแก้ SRT ก่อนเรนเดอร์');
    };
    root.querySelector('[data-render]').onclick = () => render(root);
    root.querySelector('[data-start]').onchange = () => {
      const preview = root.querySelector('[data-media-preview]');
      if (Number.isFinite(preview.duration)) preview.currentTime = Math.min(preview.duration, Number(root.querySelector('[data-start]').value) || 0);
    };
    root.addEventListener('keydown', event => { if (event.key === 'Escape') close(root); });
    refreshFiles(root).then(file => file && loadPreview(root, file.id)).catch(error => setStatus(root, formatError(error.message), true));
  }
  window.PanthoriumMediaStudio = { open, close: () => { const root = document.getElementById('media-studio-dashboard'); if (root) close(root); }, roughSrt };
  const sync = () => requestAnimationFrame(installLauncher);
  for (const event of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:boot-complete']) window.addEventListener(event, sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true }); else sync();
})();
