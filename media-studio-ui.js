(function () {
  'use strict';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  let currentUrl = '';
  let generationJobToken = '';
  let generationPolls = 0;

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
      media_encoder_unavailable: 'ระบบเรนเดอร์วิดีโอยังไม่พร้อม',
      media_ai_unavailable: 'Sentinel AI ยังไม่พร้อมใช้งาน',
      media_ai_plan_failed: 'Sentinel วางแผนตัดต่อไม่สำเร็จ กรุณาลองใหม่',
      invalid_ai_edit_plan: 'Sentinel ส่งแผนตัดต่อที่อยู่นอกช่วงวิดีโอ กรุณาลองสั่งใหม่',
      invalid_generation_prompt: 'พิมพ์ prompt สำหรับวิดีโอที่ต้องการสร้าง',
      ambiguous_media_file: 'พบชื่อไฟล์ซ้ำ กรุณาเลือกไฟล์ใน Media Studio โดยตรง',
      video_generation_unavailable: 'ยังไม่ได้เปิดใช้ Veo video generation ใน staging',
      video_generation_capacity: 'Veo ใช้งานเต็มชั่วคราว กรุณาลองอีกครั้งภายหลัง',
      video_generation_filtered: 'คำขอนี้ถูกระบบความปลอดภัยของ Veo ปฏิเสธ',
      video_generation_failed: 'สร้างวิดีโอไม่สำเร็จ',
      video_generation_empty: 'ไม่พบไฟล์วิดีโอที่สร้างได้',
      generated_video_too_large: 'วิดีโอที่สร้างมีขนาดเกิน 20 MB',
      generation_confirmation_required: 'ต้องยืนยันก่อนเริ่มสร้างวิดีโอ',
      generation_job_expired: 'งานสร้างนี้หมดอายุ · เริ่มสร้างคำขอใหม่'
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
    const bin = root.querySelector('[data-media-bin]');
    bin.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = data.files?.length ? 'Choose a video' : 'No Cloud Files video';
    select.appendChild(placeholder);
    for (const file of data.files || []) {
      select.appendChild(fileOption(file));
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ms-bin-item';
      item.dataset.fileId = file.id;
      item.innerHTML = '<span aria-hidden="true">🎞</span><span style="min-width:0;display:block"><span data-file-name style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px"></span><span data-file-size style="display:block;color:#839096;font-size:9px"></span></span>';
      item.querySelector('[data-file-name]').textContent = file.name;
      item.querySelector('[data-file-size]').textContent = (Math.round(Number(file.size || 0) / 1024 / 1024 * 10) / 10) + ' MB';
      item.classList.toggle('active', file.id === keepId);
      item.onclick = async () => {
        select.value = file.id;
        bin.querySelectorAll('.ms-bin-item').forEach(entry => entry.classList.toggle('active', entry.dataset.fileId === file.id));
        try { await loadPreview(root, file.id); }
        catch (error) { setStatus(root, formatError(error.message), true); }
      };
      bin.appendChild(item);
    }
    if (!(data.files || []).length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:10px;color:#839096;font-size:10px';
      empty.textContent = 'อัปโหลดวิดีโอเข้า Cloud Files เพื่อเริ่มตัดต่อ';
      bin.appendChild(empty);
    }
    const selected = (data.files || []).find(file => file.id === keepId);
    select.value = selected?.id || '';
    return selected || null;
  }
  function timelineSeconds(value) {
    const seconds = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(seconds / 60);
    return String(minutes).padStart(2, '0') + ':' + (seconds % 60).toFixed(1).padStart(4, '0');
  }
  function updateTimeline(root) {
    const preview = root.querySelector('[data-media-preview]');
    const duration = Number.isFinite(preview.duration) && preview.duration > 0 ? preview.duration : 0;
    const startInput = root.querySelector('[data-start]');
    const endInput = root.querySelector('[data-end]');
    let start = Math.max(0, Number(startInput.value) || 0);
    let end = Math.max(start, Number(endInput.value) || 0);
    if (duration) { start = Math.min(start, duration); end = Math.min(end, duration); }
    const left = duration ? start / duration * 100 : 0;
    const width = duration ? Math.max(0.5, (end - start) / duration * 100) : 100;
    const playhead = duration ? Math.min(100, Math.max(0, (preview.currentTime || 0) / duration * 100)) : 0;
    for (const selector of ['[data-track-clip]', '[data-audio-clip]']) {
      const clip = root.querySelector(selector);
      clip.style.left = left + '%';
      clip.style.width = width + '%';
    }
    for (const selector of ['[data-playhead-line]', '[data-audio-playhead]']) root.querySelector(selector).style.left = playhead + '%';
    root.querySelector('[data-timeline-readout]').textContent = 'IN ' + timelineSeconds(start) + '  →  OUT ' + timelineSeconds(end);
    root.querySelector('[data-monitor-time]').textContent = timelineSeconds(preview.currentTime || 0);
    const slider = root.querySelector('[data-playhead]');
    if (duration) { slider.max = String(duration); if (document.activeElement !== slider) slider.value = String(preview.currentTime || 0); }
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
      root.querySelector('[data-playhead]').max = String(preview.duration || 0);
      setStatus(root, 'วิดีโอพร้อม · ' + (Math.round((preview.duration || 0) * 10) / 10) + ' วินาที');
      updateTimeline(root);
    };
    preview.ontimeupdate = () => updateTimeline(root);
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
  async function planEdit(root) {
    const fileId = root.querySelector('[data-media-file]').value;
    const instruction = root.querySelector('[data-ai-instruction]').value.trim();
    if (!fileId) return setStatus(root, 'เลือกวิดีโอที่ต้องการให้ Sentinel ตัดต่อก่อน', true);
    if (!instruction) return setStatus(root, 'พิมพ์คำสั่งตัดต่อก่อน', true);
    const button = root.querySelector('[data-ai-plan]');
    button.disabled = true;
    setStatus(root, 'Sentinel กำลังวางแผนตัดต่อ…');
    try {
      const result = await api('/api/media/plan-edit', {
        method: 'POST',
        body: JSON.stringify({ fileId, instruction, transcript: root.querySelector('[data-transcript]').value })
      });
      const plan = result.plan;
      root.querySelector('[data-start]').value = String(plan.startSeconds);
      root.querySelector('[data-end]').value = String(plan.endSeconds);
      root.querySelector('[data-aspect]').value = plan.aspect;
      root.querySelector('[data-captions]').value = plan.captionsSrt || '';
      if (plan.name) root.querySelector('[data-name]').value = plan.name;
      root.querySelector('[data-media-preview]').currentTime = plan.startSeconds;
      updateTimeline(root);
      root.querySelector('[data-ai-summary]').textContent = result.summary || 'แผนพร้อมตรวจทานแล้ว';
      setStatus(root, 'Sentinel วางแผนแล้ว · ตรวจช่วงคลิปและคำบรรยาย จากนั้นกดเรนเดอร์เพื่อบันทึก');
    } catch (error) { setStatus(root, formatError(error.message), true); }
    finally { button.disabled = false; }
  }
  async function pollGeneration(root, jobToken = generationJobToken) {
    if (!jobToken || !root.isConnected) return;
    const button = root.querySelector('[data-check-generation]');
    if (button) button.disabled = true;
    try {
      const result = await api('/api/media/generation/' + encodeURIComponent(jobToken));
      if (result.status === 'completed' && result.file) {
        generationJobToken = '';
        if (button) button.style.display = 'none';
        await refreshFiles(root, result.file.id);
        await loadPreview(root, result.file.id);
        setStatus(root, 'สร้างวิดีโอเสร็จ · บันทึก MP4 ใน Cloud Files ของบัญชีนี้แล้ว');
        return;
      }
      if (result.status === 'failed') {
        generationJobToken = '';
        if (button) button.style.display = 'none';
        setStatus(root, formatError(result.error), true);
        return;
      }
      generationPolls += 1;
      if (generationPolls >= 48) {
        if (button) button.style.display = 'inline-block';
        setStatus(root, 'Veo ยังสร้างวิดีโออยู่ · กด “ตรวจสถานะ” เพื่อตรวจอีกครั้ง');
        return;
      }
      setStatus(root, 'Veo กำลังสร้างวิดีโอ · ตรวจสถานะอัตโนมัติอีกครั้งใน 10 วินาที');
      window.setTimeout(() => pollGeneration(root, jobToken), 10000);
    } catch (error) {
      setStatus(root, formatError(error.message), true);
    } finally { if (button) button.disabled = false; }
  }
  async function generateVideo(root) {
    const prompt = root.querySelector('[data-generation-command]').value.trim();
    if (!prompt) return setStatus(root, 'พิมพ์คำสั่งสร้างวิดีโอก่อน', true);
    if (!window.confirm('เริ่มสร้างวิดีโอด้วย Sentinel AI และ Veo? การสร้างอาจใช้โควตา/มีค่าใช้จ่าย และจะบันทึก MP4 ใน Cloud Files ของบัญชีนี้')) return;
    const button = root.querySelector('[data-generate]');
    button.disabled = true;
    setStatus(root, 'Sentinel กำลังเตรียม prompt และเริ่ม Veo…');
    try {
      const result = await api('/api/media/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          durationSeconds: Number(root.querySelector('[data-gen-duration]').value),
          aspectRatio: root.querySelector('[data-gen-aspect]').value,
          name: root.querySelector('[data-gen-name]').value.trim(),
          confirmed: true
        })
      });
      generationJobToken = result.jobToken;
      generationPolls = 0;
      root.querySelector('[data-check-generation]').style.display = 'inline-block';
      root.querySelector('[data-generation-prompt]').textContent = result.prompt || '';
      await pollGeneration(root, generationJobToken);
    } catch (error) { setStatus(root, formatError(error.message), true); }
    finally { button.disabled = false; }
  }
  async function loadCapabilities(root) {
    try {
      const result = await api('/api/media/capabilities');
      const generate = root.querySelector('[data-generate]');
      const note = root.querySelector('[data-generation-capability]');
      if (!result.videoGeneration) {
        generate.disabled = true;
        note.textContent = 'การสร้างวิดีโอด้วย Veo ยังไม่เปิดใช้ใน staging';
        note.style.color = '#f5c46c';
      } else {
        note.textContent = 'ใช้ Sentinel ช่วยเรียบเรียงคำสั่งก่อนสร้าง · บันทึกไฟล์ลง Cloud Files';
      }
      if (!result.aiEditPlanning) root.querySelector('[data-ai-plan]').disabled = true;
    } catch (error) { setStatus(root, formatError(error.message), true); }
  }
  function syncFullscreenButton(root) {
    const button = root.querySelector('[data-fullscreen]');
    if (!button) return;
    const active = root.classList.contains('panthorium-window-fullscreen');
    button.textContent = active ? '⤢' : '⛶';
    button.setAttribute('aria-label', active ? 'ออกจากเต็มจอ' : 'เต็มจอ');
    button.title = active ? 'ออกจากเต็มจอ' : 'เต็มจอ';
  }
  function toggleFullscreen(root) {
    if (window.PanthoriumWindowManager?.toggleFullscreen) window.PanthoriumWindowManager.toggleFullscreen('media-studio');
    else root.classList.toggle('panthorium-window-fullscreen');
    syncFullscreenButton(root);
  }
  function minimize(root) {
    if (window.PanthoriumWindowManager?.minimize) window.PanthoriumWindowManager.minimize('media-studio');
    else root.style.display = 'none';
  }
  function close(root) {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = '';
    if (root._mediaResize) window.removeEventListener('resize', root._mediaResize);
    if (window.PanthoriumWindowManager?.close) window.PanthoriumWindowManager.close('media-studio');
    else root.remove();
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
    if (existing) {
      if (window.PanthoriumWindowManager?.restore) window.PanthoriumWindowManager.restore('media-studio');
      else existing.style.display = 'flex';
      existing.focus();
      return existing;
    }
    const root = document.createElement('section');
    root.id = 'media-studio-dashboard';
    root.tabIndex = -1;
    root.style.cssText = 'position:fixed;inset:1%;z-index:10030;background:#11151a;border:1px solid #34414a;border-radius:10px;color:#e2e8f0;padding:0;display:flex;flex-direction:column;box-shadow:0 24px 80px #000;font-family:system-ui;overflow:hidden';
    root.innerHTML = `
      <style>
        #media-studio-dashboard *{box-sizing:border-box}#media-studio-dashboard button,#media-studio-dashboard select,#media-studio-dashboard input,#media-studio-dashboard textarea{font:inherit;color:inherit}#media-studio-dashboard button{background:#252b30;border:1px solid #454f55;border-radius:5px;padding:6px 9px;cursor:pointer}#media-studio-dashboard button:hover{border-color:#53cbb9;background:#30383d}#media-studio-dashboard button:disabled{opacity:.5;cursor:wait}#media-studio-dashboard select,#media-studio-dashboard input,#media-studio-dashboard textarea{background:#191f24;border:1px solid #39454b;border-radius:4px;padding:7px}#media-studio-dashboard label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:#aeb8bc}#media-studio-dashboard header{padding:8px 13px;background:#20262a;border-bottom:1px solid #3a4449}#media-studio-dashboard .ms-projectbar{display:flex;align-items:center;gap:13px;padding:5px 13px;background:#181d21;border-bottom:1px solid #343d42;font-size:11px;color:#c7d0d4}#media-studio-dashboard .ms-projectbar button{padding:4px 9px}#media-studio-dashboard .ms-editor{flex:1;min-height:0;display:grid;grid-template-rows:minmax(260px,1fr) 238px}#media-studio-dashboard .ms-panels{display:grid;grid-template-columns:208px minmax(300px,1fr) 292px;min-height:0;border-bottom:1px solid #3a4449}#media-studio-dashboard .ms-pane{min-width:0;min-height:0;background:#1a2024;border-right:1px solid #3a4449;overflow:auto}#media-studio-dashboard .ms-pane-title{height:31px;padding:8px 10px;background:#252c30;border-bottom:1px solid #394348;font-size:10px;font-weight:700;letter-spacing:.08em;color:#c7d1d5;text-transform:uppercase}#media-studio-dashboard .ms-bin-list{padding:7px;display:flex;flex-direction:column;gap:5px}#media-studio-dashboard .ms-bin-item{width:100%;text-align:left;display:flex;gap:8px;align-items:center;background:#20272b!important;border-color:transparent!important;padding:8px!important}#media-studio-dashboard .ms-bin-item.active{border-color:#47c6b5!important;background:#183339!important}#media-studio-dashboard .ms-monitor{display:flex;flex-direction:column;min-width:0;min-height:0;background:#111518}#media-studio-dashboard .ms-monitor-head{display:flex;align-items:center;justify-content:space-between;padding:6px 9px;background:#1b2125;border-bottom:1px solid #303a3f;font-size:10px;color:#aeb8bc}#media-studio-dashboard .ms-monitor-stage{flex:1;min-height:120px;display:flex;align-items:center;justify-content:center;padding:8px;background:radial-gradient(ellipse,#1b2226 0,#101416 72%)}#media-studio-dashboard video[data-media-preview]{width:100%;height:100%;max-height:calc(100vh - 470px);object-fit:contain;background:#050708}#media-studio-dashboard .ms-transport{display:flex;align-items:center;justify-content:center;gap:7px;padding:6px;border-top:1px solid #303a3f;background:#1b2125}#media-studio-dashboard .ms-inspector{border-right:0;padding-bottom:12px}#media-studio-dashboard .ms-inspector-body{padding:9px;display:flex;flex-direction:column;gap:8px}#media-studio-dashboard .ms-section{border:1px solid #394348;background:#20272b;padding:9px;border-radius:5px;display:flex;flex-direction:column;gap:7px}#media-studio-dashboard .ms-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}#media-studio-dashboard .ms-timeline{min-width:0;overflow:hidden;background:#191f23;display:flex;flex-direction:column}#media-studio-dashboard .ms-timeline-head{display:flex;align-items:center;justify-content:space-between;height:31px;padding:0 10px;background:#252c30;border-bottom:1px solid #3a4449;font-size:10px;color:#c6d0d4}#media-studio-dashboard .ms-ruler{height:26px;margin-left:42px;display:flex;justify-content:space-between;align-items:end;padding:0 8px 4px;color:#859198;font:9px monospace;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),#465055 calc(10% - 1px),#465055 10%)}#media-studio-dashboard .ms-track-row{height:57px;display:grid;grid-template-columns:42px 1fr;border-top:1px solid #303a3f}#media-studio-dashboard .ms-track-label{display:flex;align-items:center;justify-content:center;background:#252c30;color:#aab4b8;font-size:10px;font-weight:700;border-right:1px solid #3a4449}#media-studio-dashboard .ms-track-content{position:relative;min-width:0;background:repeating-linear-gradient(90deg,#1c2428 0,#1c2428 calc(10% - 1px),#30393e calc(10% - 1px),#30393e 10%);touch-action:none}#media-studio-dashboard .ms-clip-region{position:absolute;top:7px;bottom:7px;left:0;width:100%;min-width:12px;border:1px solid #45c9b7;background:linear-gradient(90deg,#17666a,#1b8b7d 45%,#17666a);border-radius:4px;overflow:visible}#media-studio-dashboard .ms-clip-region.audio{top:9px;bottom:9px;opacity:.64;background:repeating-linear-gradient(90deg,#275e67 0 3px,#327e79 3px 5px,#245560 5px 8px);border-color:#60b2a4}#media-studio-dashboard .ms-trim-handle{position:absolute;top:-1px;bottom:-1px;width:9px;padding:0!important;background:#d6fff5!important;border:1px solid #163f3b!important;border-radius:2px!important;z-index:2;cursor:ew-resize!important}#media-studio-dashboard [data-trim-start]{left:-4px}#media-studio-dashboard [data-trim-end]{right:-4px}#media-studio-dashboard .ms-playhead-line{position:absolute;top:0;bottom:0;left:0;width:2px;background:#ffcf66;z-index:4;pointer-events:none;box-shadow:0 0 4px #ffcf66}#media-studio-dashboard .ms-playhead-cap{position:absolute;top:0;left:-5px;width:12px;height:8px;background:#ffcf66;clip-path:polygon(0 0,100% 0,50% 100%)}#media-studio-dashboard .ms-timeline-note{padding:5px 10px;color:#7f8d93;font-size:9px}@media(max-width:1000px){#media-studio-dashboard .ms-panels{grid-template-columns:165px minmax(260px,1fr) 255px}}@media(max-width:760px){#media-studio-dashboard .ms-panels{grid-template-columns:minmax(0,1fr);grid-template-rows:110px minmax(210px,1fr) 170px}#media-studio-dashboard .ms-pane{border-right:0;border-bottom:1px solid #3a4449}#media-studio-dashboard .ms-inspector{display:none}#media-studio-dashboard .ms-editor{grid-template-rows:minmax(0,1fr) 205px}#media-studio-dashboard .ms-timeline{font-size:9px}}
        @media(max-width:760px) and (orientation:portrait){#media-studio-dashboard .ms-projectbar{gap:10px;overflow-x:auto;white-space:nowrap;flex:none;min-height:31px}#media-studio-dashboard .ms-projectbar>span:nth-child(-n+6){display:none}#media-studio-dashboard .ms-editor{display:block;overflow-y:auto;overscroll-behavior:contain}#media-studio-dashboard .ms-panels{display:flex;flex-direction:column;min-height:0}#media-studio-dashboard .ms-bin{height:104px;flex:none;overflow:hidden}#media-studio-dashboard .ms-bin-list{height:70px;flex-direction:row;overflow-x:auto;overflow-y:hidden}#media-studio-dashboard .ms-bin-item{width:138px;min-width:138px;height:52px}#media-studio-dashboard .ms-monitor{height:39dvh;min-height:205px;flex:none}#media-studio-dashboard .ms-monitor-stage{min-height:0;padding:4px}#media-studio-dashboard video[data-media-preview]{max-height:100%;width:100%}#media-studio-dashboard .ms-inspector{display:block;flex:none;overflow:visible;padding-bottom:5px}#media-studio-dashboard .ms-inspector-body{padding:7px}#media-studio-dashboard .ms-section{padding:8px}#media-studio-dashboard .ms-timeline{height:178px;min-height:178px;flex:none}#media-studio-dashboard .ms-timeline-head{height:28px;font-size:9px;gap:5px}#media-studio-dashboard .ms-timeline-head>span:last-child{gap:5px!important}#media-studio-dashboard .ms-ruler{height:20px;margin-left:32px;font-size:8px}#media-studio-dashboard .ms-track-row{height:39px;grid-template-columns:32px 1fr}#media-studio-dashboard .ms-track-label{font-size:9px}#media-studio-dashboard .ms-timeline-note{font-size:8px;padding:3px 6px}#media-studio-dashboard .ms-trim-handle{width:16px}#media-studio-dashboard [data-trim-start]{left:-8px}#media-studio-dashboard [data-trim-end]{right:-8px}}
        @media(max-width:760px) and (orientation:landscape) and (max-height:600px){#media-studio-dashboard header{padding:4px 9px;min-height:38px}#media-studio-dashboard .ms-projectbar{min-height:29px;padding:3px 8px;gap:8px;overflow:hidden}#media-studio-dashboard .ms-editor{grid-template-rows:minmax(0,1fr) 126px}#media-studio-dashboard .ms-panels{grid-template-columns:118px minmax(0,1fr) 205px;grid-template-rows:minmax(0,1fr)}#media-studio-dashboard .ms-bin{height:auto;overflow:auto}#media-studio-dashboard .ms-bin-list{flex-direction:column;overflow:auto}#media-studio-dashboard .ms-bin-item{width:100%;min-width:0}#media-studio-dashboard .ms-monitor{height:auto;min-height:0}#media-studio-dashboard .ms-monitor-stage{min-height:0;padding:2px}#media-studio-dashboard video[data-media-preview]{max-height:calc(100dvh - 220px)}#media-studio-dashboard .ms-inspector{display:block;overflow:auto;padding:0}#media-studio-dashboard .ms-inspector-body{padding:5px;gap:5px}#media-studio-dashboard .ms-section{padding:6px;gap:5px}#media-studio-dashboard .ms-timeline{height:auto;min-height:0}#media-studio-dashboard .ms-timeline-head{height:23px;padding:0 6px;font-size:8px}#media-studio-dashboard .ms-ruler{height:17px;margin-left:28px;font-size:7px}#media-studio-dashboard .ms-track-row{height:30px;grid-template-columns:28px 1fr}#media-studio-dashboard .ms-clip-region{top:4px;bottom:4px}#media-studio-dashboard .ms-clip-region.audio{top:5px;bottom:5px}#media-studio-dashboard .ms-timeline-note{display:none}}
        @media(min-width:761px) and (max-width:1100px) and (orientation:portrait){#media-studio-dashboard .ms-editor{grid-template-rows:minmax(260px,1fr) 205px}#media-studio-dashboard .ms-panels{grid-template-columns:minmax(0,.8fr) minmax(0,1.5fr);grid-template-rows:minmax(230px,1fr) minmax(190px,.8fr)}#media-studio-dashboard .ms-bin{grid-column:1;grid-row:1}#media-studio-dashboard .ms-monitor{grid-column:2;grid-row:1}#media-studio-dashboard .ms-inspector{display:block;grid-column:1/-1;grid-row:2;overflow:auto;border-top:1px solid #3a4449;padding:0}#media-studio-dashboard .ms-inspector-body{display:grid;grid-template-columns:1fr 1fr;align-items:start;padding:7px;gap:7px}#media-studio-dashboard .ms-section{min-width:0}#media-studio-dashboard .ms-timeline{grid-row:2}#media-studio-dashboard .ms-track-row{height:48px}}
        @media(min-width:761px) and (max-width:1100px) and (orientation:landscape){#media-studio-dashboard .ms-panels{grid-template-columns:170px minmax(0,1fr) 245px}#media-studio-dashboard .ms-editor{grid-template-rows:minmax(0,1fr) 205px}#media-studio-dashboard .ms-track-row{height:48px}}
        @media(min-width:761px) and (max-width:950px) and (orientation:landscape) and (max-height:520px){#media-studio-dashboard .ms-panels{grid-template-columns:124px minmax(0,1fr) 205px}#media-studio-dashboard .ms-editor{grid-template-rows:minmax(0,1fr) 128px}#media-studio-dashboard .ms-inspector-body{padding:5px;gap:5px}#media-studio-dashboard .ms-section{padding:5px;gap:4px}#media-studio-dashboard .ms-track-row{height:30px}#media-studio-dashboard .ms-trim-handle{width:16px}#media-studio-dashboard [data-trim-start]{left:-8px}#media-studio-dashboard [data-trim-end]{right:-8px}#media-studio-dashboard .ms-timeline-note{display:none}}
        @media(min-width:951px) and (max-width:1100px) and (orientation:landscape) and (max-height:600px){#media-studio-dashboard header{padding:4px 9px}#media-studio-dashboard .ms-projectbar{min-height:28px;padding:3px 8px}#media-studio-dashboard .ms-editor{grid-template-rows:minmax(0,1fr) 135px}#media-studio-dashboard .ms-panels{grid-template-columns:145px minmax(0,1fr) 220px}#media-studio-dashboard .ms-monitor-stage{min-height:0}#media-studio-dashboard .ms-timeline-head{height:23px}#media-studio-dashboard .ms-ruler{height:17px}#media-studio-dashboard .ms-track-row{height:32px}#media-studio-dashboard .ms-timeline-note{display:none}}
        @media(pointer:coarse){#media-studio-dashboard .ms-trim-handle{width:16px}#media-studio-dashboard [data-trim-start]{left:-8px}#media-studio-dashboard [data-trim-end]{right:-8px}}

        #media-studio-dashboard:fullscreen{inset:0!important;width:100vw;height:100vh;height:100dvh;border:0;border-radius:0;padding:max(env(safe-area-inset-top,0px),16px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)!important}
        #media-studio-dashboard [data-window-action]{min-width:38px;min-height:38px;display:inline-flex;align-items:center;justify-content:center;padding:4px!important}
        @media(max-width:760px){#media-studio-dashboard header{gap:6px!important;align-items:center}#media-studio-dashboard header>div:first-child{min-width:0;flex:1}#media-studio-dashboard .ms-window-tools{gap:4px!important;flex:none}#media-studio-dashboard .ms-window-tools .ms-cloud-label{display:none}#media-studio-dashboard .ms-window-tools [data-window-action]{min-width:36px;min-height:36px}}
        @media(max-width:760px) and (orientation:portrait){#media-studio-dashboard.panthorium-window-fullscreen{padding:max(env(safe-area-inset-top,0px),32px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)!important}}
        @media(max-width:760px) and (orientation:landscape){#media-studio-dashboard.panthorium-window-fullscreen{padding:max(env(safe-area-inset-top,0px),16px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)!important}}
        @media(min-width:761px) and (max-width:1100px) and (orientation:portrait){#media-studio-dashboard.panthorium-window-fullscreen{padding-top:max(env(safe-area-inset-top,0px),24px)}}
        @media(min-width:761px) and (max-width:1100px) and (orientation:landscape) and (max-height:600px){#media-studio-dashboard.panthorium-window-fullscreen{padding-top:max(env(safe-area-inset-top,0px),12px)}}
      </style>
      <header style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div style="display:flex;align-items:center;gap:10px"><span style="font-size:21px">🎬</span><div><div style="font-size:13px;font-weight:700">Panthorium Media Studio</div><div data-media-status style="font-size:10px;color:#9ca9ae">Project · Untitled Sequence</div></div></div>
        <div class="ms-window-tools" style="display:flex;align-items:center;gap:6px"><span class="ms-cloud-label" style="font-size:9px;color:#7f8d93">CLOUD PROJECT</span><button type="button" data-window-action data-minimize aria-label="ย่อ Media Studio" title="ย่อ">−</button><button type="button" data-window-action data-fullscreen aria-label="เต็มจอ" title="เต็มจอ">⛶</button><button type="button" data-window-action data-close aria-label="ปิด">✕</button></div>
      </header>
      <div class="ms-projectbar"><span style="color:#71d8c8;font-weight:700">EDIT WORKSPACE</span><span>SEQUENCE 01</span><span>V1 · A1</span><span style="flex:1"></span><button type="button" data-refresh>Refresh media</button><label style="padding:4px 8px;border:1px solid #454f55;border-radius:4px;cursor:pointer">Import<input data-upload type="file" accept="video/*" style="display:none"></label><select data-media-file style="display:none"></select></div>
      <div class="ms-editor">
        <div class="ms-panels">
          <aside class="ms-pane ms-bin"><div class="ms-pane-title">Project · Media Bin</div><div data-media-bin class="ms-bin-list"></div><div style="padding:8px;color:#7f8d93;font-size:9px">ไฟล์ต้นฉบับจาก Cloud Files ของบัญชีนี้</div></aside>
          <section class="ms-monitor"><div class="ms-monitor-head"><span>Program Monitor · Sequence 01</span><span data-monitor-time style="font-family:monospace">00:00.0</span></div><div class="ms-monitor-stage"><video data-media-preview playsinline></video></div><div class="ms-transport"><button type="button" data-mark-in title="ตั้งจุดเริ่ม">◁ In</button><button type="button" data-play title="เล่น/หยุด">▶</button><button type="button" data-mark-out title="ตั้งจุดจบ">Out ▷</button><input data-playhead type="range" min="0" max="10" value="0" step="0.05" style="flex:1;max-width:260px;padding:0;accent-color:#ffcf66"><span style="font:10px monospace;color:#9ca9ae">Source</span></div></section>
          <aside class="ms-pane ms-inspector"><div class="ms-pane-title">Inspector · Sentinel AI</div><div class="ms-inspector-body">
            <div class="ms-section"><label style="font-size:11px;font-weight:700;color:#61d7c8">Prompt / คำสั่งถึง Sentinel<textarea data-ai-instruction rows="3" maxlength="2400" placeholder="เช่น เลือกช่วงที่พูดถึงสินค้า ทำคลิปแนวตั้ง 30 วินาที ใส่คำบรรยายไทย"></textarea></label><button type="button" data-ai-plan style="border-color:#37a99d;color:#9be6dc">วางแผนด้วย Sentinel</button><div data-ai-summary style="font-size:9px;line-height:1.4;color:#aab6ba">AI เสนอแผนให้ตรวจ แล้วคุณกด Render เอง</div></div>
            <div class="ms-section"><div style="font-size:10px;font-weight:700">CLIP PROPERTIES</div><div class="ms-grid"><label>In · sec<input data-start type="number" min="0" step="0.1" value="0"></label><label>Out · sec<input data-end type="number" min="0.1" step="0.1" value="10"></label><label>Frame<select data-aspect><option value="original">Source</option><option value="vertical">9:16</option><option value="square">1:1</option><option value="widescreen">16:9</option></select></label><label>Output name<input data-name maxlength="180" placeholder="sequence-01"></label></div><button type="button" data-render style="background:#146f68;border-color:#4acbbb;font-weight:700">Render to Cloud Files</button></div>
            <details class="ms-section"><summary style="cursor:pointer;font-size:10px;font-weight:700">TRANSCRIPT · CAPTIONS</summary><div style="display:flex;gap:5px;flex-wrap:wrap"><label>Language<select data-language><option value="th">ไทย</option><option value="en">English</option></select></label><button type="button" data-transcribe>Transcribe</button><button type="button" data-rough>Estimate SRT</button><button type="button" data-save-transcript>Save transcript</button></div><label>Transcript<textarea data-transcript rows="3"></textarea></label><label>SRT · relative to export<textarea data-captions rows="4" placeholder="1\n00:00:00,000 --> 00:00:02,000\nข้อความคำบรรยาย" style="font:10px/1.4 monospace"></textarea></label></details>
            <div class="ms-section"><div style="font-size:10px;font-weight:700;color:#bbaeff">SENTINEL GENERATIVE VIDEO</div><label>Prompt / คำสั่งสร้างวิดีโอ<textarea data-generation-command rows="3" maxlength="1600" placeholder="เช่น สร้างภาพกาแฟดริปในเชียงใหม่ยามเช้า โทนอุ่น กล้องเคลื่อนช้า"></textarea></label><div class="ms-grid"><label>Duration<select data-gen-duration><option value="4">4 sec</option><option value="6">6 sec</option><option value="8" selected>8 sec</option></select></label><label>Frame<select data-gen-aspect><option value="16:9">16:9</option><option value="9:16">9:16</option></select></label></div><label>Output name<input data-gen-name maxlength="150" placeholder="sentinel-generated"></label><div data-generation-capability style="font-size:9px;color:#9ca9ae">Sentinel prepares the Veo prompt</div><button type="button" data-generate style="background:#5744a3;border-color:#8b78d4">Sentinel · Generate video</button><button type="button" data-check-generation style="display:none">Check generation status</button><div data-generation-prompt style="font-size:9px;color:#9ca9ae;max-height:42px;overflow:auto"></div><div style="font-size:9px;color:#78868b">เริ่มหลังยืนยัน · อาจใช้โควตา/มีค่าใช้จ่าย · ผลลัพธ์เก็บใน Cloud Files</div></div>
          </div></aside>
        </div>
        <section class="ms-timeline"><div class="ms-timeline-head"><span>Timeline · Sequence 01</span><span style="display:flex;gap:12px"><span>V1 Video</span><span>A1 Audio</span><span data-timeline-readout style="font-family:monospace">IN 00:00.0 → OUT 00:10.0</span></span></div><div class="ms-ruler" data-timeline-ruler><span>00:00</span><span>25%</span><span>50%</span><span>75%</span><span>END</span></div><div class="ms-track-row"><div class="ms-track-label">V1</div><div class="ms-track-content" data-range-track><div data-track-clip class="ms-clip-region"><button type="button" class="ms-trim-handle" data-trim-start aria-label="ลากจุดเริ่ม"></button><button type="button" class="ms-trim-handle" data-trim-end aria-label="ลากจุดจบ"></button></div><div data-playhead-line class="ms-playhead-line"><span class="ms-playhead-cap"></span></div></div></div><div class="ms-track-row"><div class="ms-track-label">A1</div><div class="ms-track-content" data-audio-track><div data-audio-clip class="ms-clip-region audio"></div><div data-audio-playhead class="ms-playhead-line"><span class="ms-playhead-cap"></span></div></div></div><div class="ms-timeline-note">ลากขอบคลิปเพื่อปรับ In / Out · คลิกแทร็กเพื่อย้าย playhead · สูงสุด 120 วินาทีต่อ render</div></section>
      </div>`;
    document.body.appendChild(root);
    window.PanthoriumWindowManager?.registerExternal?.('media-studio', 'Media Studio', root, { menuAppId: 'media-studio', controls: false });
    root.querySelector('[data-close]').onclick = () => close(root);
    root.querySelector('[data-minimize]').onclick = () => minimize(root);
    root.querySelector('[data-fullscreen]').onclick = () => toggleFullscreen(root);
    syncFullscreenButton(root);
    root.querySelector('[data-refresh]').onclick = async () => { try { await refreshFiles(root, root.querySelector('[data-media-file]').value); setStatus(root, 'โหลดรายการวิดีโอแล้ว'); } catch (error) { setStatus(root, formatError(error.message), true); } };
    root.querySelector('[data-media-file]').onchange = async () => {
      root.querySelectorAll('.ms-bin-item').forEach(entry => entry.classList.toggle('active', entry.dataset.fileId === root.querySelector('[data-media-file]').value));
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
    root.querySelector('[data-ai-plan]').onclick = () => planEdit(root);
    root.querySelector('[data-generate]').onclick = () => generateVideo(root);
    root.querySelector('[data-check-generation]').onclick = () => pollGeneration(root);
    root.querySelector('[data-playhead]').oninput = event => {
      const preview = root.querySelector('[data-media-preview]');
      if (Number.isFinite(preview.duration)) preview.currentTime = Number(event.target.value) || 0;
    };
    for (const selector of ['[data-start]', '[data-end]']) root.querySelector(selector).oninput = () => updateTimeline(root);
    root.querySelector('[data-start]').onchange = () => {
      const preview = root.querySelector('[data-media-preview]');
      if (Number.isFinite(preview.duration)) preview.currentTime = Math.min(preview.duration, Number(root.querySelector('[data-start]').value) || 0);
      updateTimeline(root);
    };
    root.querySelector('[data-end]').onchange = () => updateTimeline(root);
    root.querySelector('[data-play]').onclick = () => {
      const preview = root.querySelector('[data-media-preview]');
      if (preview.paused) preview.play().catch(() => setStatus(root, 'วิดีโอนี้เล่นไม่ได้ใน preview', true));
      else preview.pause();
    };
    root.querySelector('[data-media-preview]').onplay = () => { root.querySelector('[data-play]').textContent = '❚❚'; };
    root.querySelector('[data-media-preview]').onpause = () => { root.querySelector('[data-play]').textContent = '▶'; };
    root.querySelector('[data-mark-in]').onclick = () => {
      root.querySelector('[data-start]').value = String(Number(root.querySelector('[data-media-preview]').currentTime.toFixed(1)));
      if (Number(root.querySelector('[data-end]').value) <= Number(root.querySelector('[data-start]').value)) root.querySelector('[data-end]').value = String(Math.min(root.querySelector('[data-media-preview]').duration || 0, Number(root.querySelector('[data-start]').value) + 0.1));
      updateTimeline(root);
    };
    root.querySelector('[data-mark-out]').onclick = () => {
      const preview = root.querySelector('[data-media-preview]');
      root.querySelector('[data-end]').value = String(Number(preview.currentTime.toFixed(1)));
      if (Number(root.querySelector('[data-end]').value) <= Number(root.querySelector('[data-start]').value)) root.querySelector('[data-start]').value = String(Math.max(0, Number(root.querySelector('[data-end]').value) - 0.1));
      updateTimeline(root);
    };
    const track = root.querySelector('[data-range-track]');
    let dragEdge = '';
    const timeAtPointer = event => {
      const rect = track.getBoundingClientRect();
      const duration = Number(root.querySelector('[data-media-preview]').duration) || 0;
      return duration ? Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration)) : 0;
    };
    track.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-trim-start], [data-trim-end]');
      if (handle) {
        dragEdge = handle.matches('[data-trim-start]') ? 'start' : 'end';
        track.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      } else {
        const preview = root.querySelector('[data-media-preview]');
        if (Number.isFinite(preview.duration)) preview.currentTime = timeAtPointer(event);
      }
    });
    track.addEventListener('pointermove', event => {
      if (!dragEdge) return;
      const time = timeAtPointer(event);
      const start = root.querySelector('[data-start]');
      const end = root.querySelector('[data-end]');
      const currentStart = Math.max(0, Number(start.value) || 0);
      const currentEnd = Math.max(currentStart + 0.1, Number(end.value) || 0.1);
      if (dragEdge === 'start') start.value = String(Math.max(0, Math.min(time, currentEnd - 0.1)));
      else end.value = String(Math.max(currentStart + 0.1, Math.min(time, currentStart + 120)));
      updateTimeline(root);
      event.preventDefault();
    });
    const stopTrim = () => { dragEdge = ''; };
    track.addEventListener('pointerup', stopTrim);
    track.addEventListener('pointercancel', stopTrim);
    root._mediaResize = () => updateTimeline(root);
    window.addEventListener('resize', root._mediaResize);
    root.addEventListener('keydown', event => { if (event.key === 'Escape') close(root); });
    if (generationJobToken) root.querySelector('[data-check-generation]').style.display = 'inline-block';
    loadCapabilities(root);
    refreshFiles(root).then(file => file && loadPreview(root, file.id)).catch(error => setStatus(root, formatError(error.message), true));
    return root;
  }
  function trackGeneration(jobToken) {
    const value = String(jobToken || '');
    if (!value || value.length > 6000) return false;
    generationJobToken = value;
    let root = document.getElementById('media-studio-dashboard');
    if (!root) { open(); root = document.getElementById('media-studio-dashboard'); }
    if (!root) return false;
    const button = root.querySelector('[data-check-generation]');
    button.style.display = 'inline-block';
    generationPolls = 0;
    pollGeneration(root, generationJobToken);
    return true;
  }
  window.PanthoriumMediaStudio = { open, trackGeneration, close: () => { const root = document.getElementById('media-studio-dashboard'); if (root) close(root); }, roughSrt };
  const sync = () => requestAnimationFrame(installLauncher);
  for (const event of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:boot-complete']) window.addEventListener(event, sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true }); else sync();
})();
