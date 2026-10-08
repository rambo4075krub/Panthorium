(function () {
  'use strict';
  let profileCache = null;
  let profileCacheAt = 0;

  function getOS() { try { return typeof OS !== 'undefined' ? OS : null; } catch (_) { return null; } }
  function isAdminEnrollmentContext() { const auth = window.PanthoriumAuth; return auth?.isAdministrator?.() === true && auth?.isAdminEntry?.() === true; }
  function canManageVoiceProfiles() { const auth = window.PanthoriumAuth; return !!auth && (auth.isGuest?.() === true || auth.hasPermission?.('chat') === true || auth.hasPermission?.('settings') === true); }
  function notify(message) { try { if (typeof toast === 'function') toast(message); else console.info('[VoiceIdentity]', message); } catch (_) {} }
  function errorText(error) { const messages = { password_mismatch: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน', email_verification_required: 'การยืนยันอีเมลหมดอายุหรือไม่ตรงกับ guest session กรุณาส่ง OTP ใหม่และยืนยันอีกครั้ง', voice_registration_unavailable: 'ระบบตรวจเสียงหรือสร้างบัญชีขัดข้องชั่วคราว กรุณาแจ้งทีมดูแลพร้อมรหัสคำขอ', voice_profile_exists: 'บัญชีนี้มีโปรไฟล์เสียงผู้ใช้อยู่แล้ว • เลือกเพิ่มตัวอย่างที่โปรไฟล์เดิม', voice_profile_not_found: 'ไม่พบโปรไฟล์เสียงนี้ในบัญชี • รีเฟรชรายการแล้วลองอีกครั้ง', voice_profile_samples_conflict: 'โปรไฟล์ถูกเปลี่ยนพร้อมกัน • รีเฟรชรายการแล้วลองอีกครั้ง', voice_samples_do_not_match: 'ตัวอย่างใหม่ยังไม่สอดคล้องกับโปรไฟล์เดิมหรือเสียงไม่ชัด • บันทึกใหม่ในที่เงียบด้วยเสียงธรรมชาติ', invalid_voice_samples: 'ต้องบันทึกตัวอย่างเสียงใหม่ 3–5 ช่วงให้ครบก่อนบันทึก' }; const message = messages[error?.message] || error?.message || 'เกิดข้อผิดพลาด'; return error?.requestId ? `${message} (${error.requestId})` : message; }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
  async function token() {
    if (getOS()?.config?.accessToken) return getOS().config.accessToken;
    if (window.PanthoriumAuth?.refreshSession && await window.PanthoriumAuth.refreshSession().catch(() => false)) return getOS()?.config?.accessToken || '';
    return '';
  }
  async function api(path, options = {}, retry = true) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const accessToken = await token();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response = await fetch(path, { ...options, headers, credentials: 'include', cache: 'no-store' });
    if (response.status === 401 && retry && window.PanthoriumAuth?.refreshSession && await window.PanthoriumAuth.refreshSession().catch(() => false)) return api(path, options, false);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; error.requestId = data.requestId; throw error; }
    return data;
  }
  async function profiles(force = false) {
    if (!force && profileCache && Date.now() - profileCacheAt < 30000) return profileCache;
    const data = await api('/api/biometrics/voice/profiles');
    profileCache = Array.isArray(data.profiles) ? data.profiles : [];
    profileCacheAt = Date.now();
    return profileCache;
  }
  async function authorizeAudio(audio) {
    if (document.body?.dataset.voiceIdentityRequired !== 'true') return { required: false, matched: true };
    let enrolled;
    try { enrolled = await profiles(); }
    catch (error) {
      // Guest voice profiles are scoped to a random per-tab guest identity.
      if (error?.status === 403) return { required: true, matched: false, error: 'voice_enrollment_required' };
      return { required: true, matched: false, error: 'voice_verification_unavailable' };
    }
    if (!enrolled.length) return { required: true, matched: false, error: 'voice_enrollment_required' };
    try {
      const result = await api('/api/biometrics/voice/verify', { method: 'POST', body: JSON.stringify({ audio }) });
      return { required: true, matched: result.matched === true, profile: result.profile || null, score: result.score, error: result.matched ? null : 'voice_not_authorized' };
    } catch (error) { return { required: true, matched: false, error: error.message || 'voice_verification_unavailable' }; }
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
  }
  // Three to five independent recordings total 36–60 seconds. Prompts are
  // shuffled for variety; they are guidance for reading, not replay liveness.
  const enrollmentPrompts = [
    'วันนี้ฉันกำลังลงทะเบียนเสียงของตัวเองกับ Panthorium OS ฉันจะพูดด้วยจังหวะปกติ และอ่านประโยคนี้ให้ชัดเจนตั้งแต่ต้นจนจบ',
    'เมื่อฉันอยู่ในที่สาธารณะ อาจมีคนพูดอยู่รอบตัว ระบบควรรับคำสั่งจากเสียงที่ฉันอนุญาตไว้เท่านั้น และปล่อยเสียงอื่นผ่านไป',
    'Sentinel ช่วยเปิดหน้าต่างและตอบคำถามของฉันได้ ฉันกำลังพูดภาษาไทยสลับกับ English เพื่อให้ระบบรู้จักเสียงธรรมชาติของฉัน',
    'ช่วงเช้าอากาศอาจเงียบ ช่วงเย็นอาจมีเสียงรถและคนคุยกัน ฉันจะอ่านต่อด้วยระดับเสียงธรรมดาโดยไม่กระซิบหรือฝืนเสียง',
    'ฉันต้องการให้ข้อมูลส่วนตัวและสิทธิ์ในระบบปลอดภัย การจดจำเสียงนี้ใช้คัดเสียงรบกวนก่อนถอดคำพูด ไม่ได้ใช้แทนรหัสผ่าน',
    'This is my natural speaking voice. I am reading a short English passage, then returning to ภาษาไทย เพื่อให้ตัวอย่างเสียงมีความหลากหลาย'
  ];
  function shuffledPrompts() {
    const items = [...enrollmentPrompts];
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    return items;
  }
  async function capture(button) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('browser_recorder_unsupported');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(value => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(value)) || '';
    const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    button.disabled = true; button.textContent = 'กำลังบันทึก 12 วินาที…';
    recorder.start(200);
    await new Promise(resolve => setTimeout(resolve, 12000));
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.stop(); await stopped;
    stream.getTracks().forEach(track => track.stop());
    button.disabled = false; button.textContent = 'บันทึกตัวอย่างเสียง';
    if (!chunks.length) throw new Error('empty_voice_sample');
    return blobToDataUrl(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }));
  }
  function label(type) { return ({ user: 'ผู้ใช้', family: 'คนในครอบครัว', administrator: 'แอดมิน' })[type] || type; }
  async function refresh(root = document.getElementById('panthorium-voice-identity')) {
    if (!root) return;
    const state = root.querySelector('[data-state]');
    try {
      const [status, list] = await Promise.all([api('/api/biometrics/status'), profiles(true)]);
      const stateText = !status.configured ? 'ยังต้องตั้งค่าบริการ Speaker Verification และกุญแจเข้ารหัสบนเซิร์ฟเวอร์' : status.gateEnabled ? 'ด่านคัดเสียงเปิดใช้งานแล้ว' : 'โหมดลงทะเบียน/ทดสอบ: ด่านยังปิดอยู่ จึงยังไม่กรองเสียงก่อนส่งไปถอดคำพูด';
      const shortSpeechNote = status.shortUtteranceCalibrationEnabled === false ? ' · คำสั่งสั้นอาจมีข้อมูลเสียงไม่พอ กรุณาพูดต่อเนื่องเพิ่ม' : '';
      const livenessNote = status.livenessSupported === false ? ' · ยังไม่ป้องกันเสียงบันทึกซ้ำ เสียงอย่างเดียวไม่พอยืนยันรายการสำคัญ' : '';
      state.textContent = stateText + shortSpeechNote + livenessNote;
      state.style.color = status.configured && status.gateEnabled ? '#6ee7b7' : '#fbbf24';
      const upgrade = root.querySelector('[data-upgrade]'); if (upgrade) upgrade.style.display = list.length ? '' : 'none'; const testPanel = root.querySelector('[data-voice-test-panel]'); if (testPanel) testPanel.style.display = list.length ? '' : 'none'; root.dataset.voiceMatchThreshold = Number.isFinite(Number(status.matchThreshold)) ? String(status.matchThreshold) : '';
      root.querySelector('[data-list]').innerHTML = list.length ? list.map(item => `<div style="padding:10px;border-bottom:1px solid #243448"><b>${esc(item.displayName)}</b> · ${esc(label(item.subjectType))}<div style="font-size:11px;color:#8ea3b8">ตัวอย่าง ${esc(item.sampleCount)} ครั้ง${item.relationship ? ` · ${esc(item.relationship)}` : ''}</div><button type="button" data-add-samples="${esc(item.profileId)}" style="margin-top:6px">เพิ่มตัวอย่างเสียงในโปรไฟล์นี้</button> <button type="button" data-remove="${esc(item.profileId)}" style="margin-top:6px">ลบเสียงนี้</button></div>`).join('') : '<div style="color:#94a3b8">ยังไม่มีเสียงที่ลงทะเบียน ระบบจะยังไม่เปิดด่านคัดกรอง</div>';
      root.querySelectorAll('[data-remove]').forEach(button => { button.onclick = async () => { if (!confirm('ลบเสียงที่ลงทะเบียนนี้?')) return; await api(`/api/biometrics/voice/profiles/${encodeURIComponent(button.dataset.remove)}`, { method: 'DELETE' }); profileCache = null; await refresh(root); }; });
    } catch (error) { state.textContent = `โหลดข้อมูลไม่สำเร็จ: ${error.message}`; state.style.color = '#fda4af'; }
  }
  async function open() {
    if (!canManageVoiceProfiles()) { notify('กรุณาเข้าสู่ระบบบัญชีที่มีสิทธิ์จัดการเสียงก่อน'); return false; }
    if (document.getElementById('panthorium-voice-identity')) return;
    const root = document.createElement('div');
    root.id = 'panthorium-voice-identity';
    root.style.cssText = 'box-sizing:border-box;position:fixed;inset:0;max-width:100vw;max-height:100dvh;z-index:10050;background:rgba(7,15,26,.99);border:1px solid #2b5268;border-radius:16px;color:#e6f5ff;padding:16px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 24px 80px #000;font-family:system-ui';
    const adminOption = isAdminEnrollmentContext() ? '<option value="administrator">แอดมิน</option>' : '';
    const guestRegistration = window.PanthoriumAuth?.isGuest?.() === true;
    const emailField = guestRegistration ? '<label style="display:block;margin-top:10px;font-size:12px">อีเมลสำหรับบัญชีถาวร<input data-email type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"></label><button data-request-otp type="button" style="margin-top:8px">ส่งรหัสยืนยันอีเมล</button><input data-email-otp inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="รหัส OTP 6 หลัก" style="width:130px;padding:9px;margin:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><button data-verify-otp type="button">ยืนยันอีเมล</button><div data-email-otp-state style="font-size:12px"></div><label style="display:block;margin-top:8px;font-size:12px">ตั้งรหัสผ่าน (อย่างน้อย 10 ตัวอักษร)<input data-password type="password" autocomplete="new-password" required minlength="10" maxlength="256" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"></label><label style="display:block;margin-top:8px;font-size:12px">ยืนยันรหัสผ่าน<input data-password-confirm type="password" autocomplete="new-password" required minlength="10" maxlength="256" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"></label><div data-password-state style="font-size:12px"></div><label style="display:block;margin-top:8px;font-size:12px"><input data-remember type="checkbox"> ให้เบราว์เซอร์จดจำรหัสผ่านและการเข้าสู่ระบบบนอุปกรณ์นี้</label><p style="font-size:12px;color:#9fb4c7">ยืนยันอีเมลด้วยรหัส OTP ก่อนลงทะเบียนเสียง เมื่อสำเร็จระบบจะสร้างบัญชีถาวร ใช้เข้าสู่ระบบจากอุปกรณ์อื่นได้ หากไม่ลงทะเบียนเสียง guest จะหมดอายุภายใน 24 ชั่วโมง</p>' : '';
    const loginPanel = guestRegistration ? '<div style="margin-top:22px;border-top:1px solid #294154;padding-top:14px"><h3>เข้าสู่บัญชีถาวร</h3><input data-login-email type="email" autocomplete="username" placeholder="อีเมล" style="width:100%;box-sizing:border-box;padding:9px;margin-bottom:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><input data-login-password type="password" autocomplete="current-password" placeholder="รหัสผ่าน" style="width:100%;box-sizing:border-box;padding:9px;margin-bottom:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><label style="display:block;font-size:12px"><input data-login-remember type="checkbox"> จดจำรหัสผ่านและการเข้าสู่ระบบบนอุปกรณ์นี้</label><button data-login style="margin-top:8px">เข้าสู่ระบบ</button> <button data-forgot type="button">ลืมรหัสผ่าน</button><div data-reset style="display:none;margin-top:12px"><label style="display:block;font-size:12px">อีเมลสำหรับรีเซ็ตรหัสผ่าน<input data-reset-email type="email" autocomplete="email" placeholder="you@example.com" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"></label><button data-reset-request type="button">ส่ง OTP ไปยังอีเมลนี้</button><input data-reset-code inputmode="numeric" maxlength="6" placeholder="OTP 6 หลัก" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><input data-reset-password type="password" autocomplete="new-password" minlength="10" placeholder="รหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><input data-reset-password-confirm type="password" autocomplete="new-password" minlength="10" placeholder="ยืนยันรหัสผ่านใหม่" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><button data-reset-confirm type="button" style="margin-top:8px">ตั้งรหัสผ่านใหม่</button><div data-reset-state style="font-size:12px;margin-top:6px"></div></div><div data-login-state style="font-size:12px;margin-top:6px"></div></div>' : '';
    const securityPanel = guestRegistration ? '' : `<div data-account-security style="margin-top:22px;border-top:1px solid #294154;padding-top:14px"><h3>บัญชีและความปลอดภัย</h3><p style="font-size:12px;color:#9fb4c7">ยืนยันอีเมลด้วย OTP ก่อนเปลี่ยนรหัสผ่าน</p><label style="display:block;font-size:12px">อีเมลรับ OTP<input data-security-email type="email" autocomplete="email" maxlength="254" required value="${esc(getOS()?.state?.user?.email || '')}" placeholder="you@example.com" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"></label><button data-security-request-otp type="button" style="margin-top:8px">ส่ง OTP ยืนยันตัวตน</button><input data-security-otp inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="OTP 6 หลัก" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><input data-security-password type="password" autocomplete="new-password" minlength="10" maxlength="256" placeholder="รหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><input data-security-password-confirm type="password" autocomplete="new-password" minlength="10" maxlength="256" placeholder="ยืนยันรหัสผ่านใหม่" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><button data-security-password-submit type="button" style="margin-top:8px">เปลี่ยนรหัสผ่าน</button><div data-security-state style="font-size:12px;margin-top:6px" aria-live="polite"></div></div>`;
    const deviceKey = guestRegistration ? (window.PanthoriumAuth?.rememberedDeviceKey?.() || Array.from(window.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')) : null;
    root.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px"><div><h2 style="margin:0">🎙️ Voice Identity</h2><div data-state style="font-size:12px;color:#8ea3b8">กำลังตรวจสอบ…</div></div><div><button data-refresh>รีเฟรช</button> <button data-close>✕</button></div></div><div class="voice-identity-grid" style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:14px;margin-top:14px"><section style="border:1px solid #294154;border-radius:12px;padding:14px;background:#0a1725"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><h3 data-enroll-title style="margin-top:0">ลงทะเบียนเสียงที่อนุญาต</h3><button type="button" data-mode-cancel style="display:none">ยกเลิก</button></div><input data-name maxlength="80" placeholder="ชื่อบุคคล" style="width:100%;box-sizing:border-box;padding:9px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px">${emailField}<select data-type style="width:100%;margin-top:8px;padding:9px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><option value="user">ผู้ใช้</option><option value="family">คนในครอบครัว</option>${adminOption}</select><input data-relationship maxlength="80" placeholder="ความสัมพันธ์ (ถ้ามี)" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><p style="font-size:12px;color:#9fb4c7">อ่านข้อความที่แสดงแล้วบันทึก 3–5 ช่วง ช่วงละ 12 วินาที รวมประมาณ 36–60 วินาที พูดด้วยเสียงธรรมชาติ</p><div data-prompt style="margin:10px 0;padding:12px;border-radius:8px;background:#11263a;line-height:1.6" aria-live="polite"></div><button data-record>บันทึกตัวอย่างเสียง</button><div data-count style="margin:9px 0;color:#67e8f9">0 / 5 ช่วง</div><label style="font-size:12px"><input data-consent type="checkbox"> บุคคลนี้ยินยอมให้สร้างและเก็บแม่แบบเสียงแบบเข้ารหัส</label><br><button data-enroll disabled style="margin-top:12px">บันทึก Voice Identity</button><div data-form-state style="margin-top:8px;font-size:12px"></div></section><section style="border:1px solid #294154;border-radius:12px;padding:14px;background:#0a1725"><h3 style="margin-top:0">เสียงที่ระบบยอมรับ</h3><div data-list></div><div data-voice-test-panel style="display:none;margin-top:12px;padding:10px;border:1px solid #146e68;border-radius:10px;background:rgba(0,217,185,.06)"><button type="button" data-voice-test style="border:1px solid #16b8a6;background:#0b3334;color:#d9fffa;border-radius:8px;padding:9px 12px">ทดสอบเสียงบัญชีนี้</button><div data-voice-test-result role="status" aria-live="polite" style="margin-top:8px;font-size:12px;color:#a9c3d2"></div><div style="margin-top:6px;font-size:11px;color:#8ea3b8">บันทึกเสียง 12 วินาทีเพื่อเทียบกับโปรไฟล์ในบัญชีนี้เท่านั้น ส่งไปตรวจการจับคู่เสียง ไม่ถอดคำพูด ไม่บันทึกเสียง และไม่แก้โปรไฟล์</div></div><p style="font-size:11px;color:#8ea3b8">เมื่อมีอย่างน้อยหนึ่งรายการ ระบบจะตรวจลายนิ้วมือเสียงก่อนถอดคำพูด เสียงอื่นจะไม่ถูกส่งไป STT หรือ Sentinel</p${loginPanel}${securityPanel}</section></div>`;
    const responsiveStyle = document.createElement('style');
    responsiveStyle.textContent = '#panthorium-voice-identity{box-sizing:border-box!important;max-width:100vw;max-height:100dvh;overflow-x:hidden!important;overflow-y:auto!important}#panthorium-voice-identity *{box-sizing:border-box;min-width:0}#panthorium-voice-identity input,#panthorium-voice-identity select,#panthorium-voice-identity textarea,#panthorium-voice-identity button{max-width:100%;min-width:0}#panthorium-voice-identity .voice-identity-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}#panthorium-voice-identity.panthorium-managed-window.panthorium-window-fullscreen{padding:calc(var(--panthorium-safe-area-top,0px) + clamp(10px,3vw,16px)) max(12px,env(safe-area-inset-right,0px)) calc(var(--panthorium-shell-dock-clearance,56px) + clamp(10px,3vw,16px)) max(12px,env(safe-area-inset-left,0px))!important;overflow-y:auto!important}@media(max-width:760px){#panthorium-voice-identity .voice-identity-grid{grid-template-columns:minmax(0,1fr)!important}}';
    root.appendChild(responsiveStyle);
    document.body.appendChild(root);
    const voiceTestButton = root.querySelector('[data-voice-test]');
    const voiceTestResult = root.querySelector('[data-voice-test-result]');
    voiceTestButton.onclick = async () => {
      voiceTestButton.disabled = true;
      voiceTestResult.textContent = 'กำลังบันทึกเสียงทดสอบ 12 วินาที…';
      voiceTestResult.style.color = '#a9c3d2';
      try {
        const audio = await capture(voiceTestButton);
        voiceTestButton.disabled = true;
        voiceTestButton.textContent = 'กำลังตรวจคะแนนเสียง…';
        const result = await api('/api/biometrics/voice/verify', { method: 'POST', body: JSON.stringify({ audio }) });
        const threshold = Number(root.dataset.voiceMatchThreshold);
        const score = Number(result.score);
        if (!Number.isFinite(score)) {
          voiceTestResult.textContent = 'ระบบไม่พบโปรไฟล์เสียงของบัญชีนี้สำหรับการจับคู่';
          voiceTestResult.style.color = '#fbbf24';
        } else {
          const verdict = result.matched === true ? 'ผ่าน' : 'ไม่ผ่าน';
          const thresholdText = Number.isFinite(threshold) ? threshold.toFixed(3) : 'ไม่ทราบ';
          const matchedProfile = result.profile?.displayName ? ` · โปรไฟล์ ${result.profile.displayName}` : '';
          voiceTestResult.textContent = `${verdict}${matchedProfile} · คะแนนจับคู่ ${score.toFixed(3)} / เกณฑ์ ${thresholdText}`;
          voiceTestResult.style.color = result.matched === true ? '#6ee7b7' : '#fbbf24';
        }
      } catch (error) {
        voiceTestResult.textContent = `ทดสอบไม่สำเร็จ: ${errorText(error)}`;
        voiceTestResult.style.color = '#fda4af';
      } finally {
        voiceTestButton.disabled = false;
        voiceTestButton.textContent = 'ทดสอบเสียงบัญชีนี้';
      }
    };
    let registrationToken = null;
    const samples = [];
    let prompts = shuffledPrompts();
    let selectedProfileId = null;
    const prompt = root.querySelector('[data-prompt]');
    const showPrompt = () => { prompt.textContent = samples.length < 5 ? `อ่านข้อความช่วงที่ ${samples.length + 1}: ${prompts[samples.length]}` : selectedProfileId ? 'ตัวอย่างเสียงใหม่ครบ พร้อมเพิ่มเข้าโปรไฟล์เดิม' : 'บันทึกครบ 60 วินาที พร้อมลงทะเบียน'; };
    showPrompt();
    const record = root.querySelector('[data-record]'); const enroll = root.querySelector('[data-enroll]'); const count = root.querySelector('[data-count]'); const formState = root.querySelector('[data-form-state]');
    const nameField = root.querySelector('[data-name]'); const typeField = root.querySelector('[data-type]'); const relationshipField = root.querySelector('[data-relationship]');
    const enrollTitle = root.querySelector('[data-enroll-title]'); const modeCancel = root.querySelector('[data-mode-cancel]');
    const updateSampleCount = () => { count.textContent = `${samples.length} / 5 ช่วง${selectedProfileId ? 'ใหม่' : ''} · ${samples.length * 12} วินาที${samples.length >= 3 ? selectedProfileId ? ' · พร้อมเพิ่มในโปรไฟล์เดิม' : ' · พร้อมลงทะเบียน' : ''}`; };
    const updateEnrollAvailability = () => { const password = guestRegistration && !selectedProfileId ? root.querySelector('[data-password]') : null; const confirm = guestRegistration && !selectedProfileId ? root.querySelector('[data-password-confirm]') : null; const needsAccountFields = guestRegistration && !selectedProfileId; const matches = !needsAccountFields || password.value === confirm.value; if (needsAccountFields) root.querySelector('[data-password-state]').textContent = confirm.value && !matches ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : ''; enroll.disabled = samples.length < 3 || samples.length > 5 || !root.querySelector('[data-consent]').checked || !nameField.value.trim() || (needsAccountFields && (!root.querySelector('[data-email]').checkValidity() || !password.checkValidity() || !confirm.checkValidity() || !matches || !registrationToken)); };
    const resetNewProfileMode = () => {
      selectedProfileId = null;
      enrollTitle.textContent = 'ลงทะเบียนเสียงที่อนุญาต';
      modeCancel.style.display = 'none';
      [nameField, typeField, relationshipField].forEach(field => { field.disabled = false; });
      nameField.value = ''; typeField.value = 'user'; relationshipField.value = '';
      samples.splice(0); prompts = shuffledPrompts();
      count.textContent = '0 / 5 ช่วง'; record.disabled = false;
      root.querySelector('[data-consent]').checked = false;
      enroll.textContent = guestRegistration ? 'ลงทะเบียนเสียงและสร้างบัญชี' : 'บันทึก Voice Identity';
      formState.textContent = '';
      showPrompt(); updateEnrollAvailability();
    };
    const selectExistingProfile = profile => {
      selectedProfileId = profile.profileId;
      enrollTitle.textContent = `เพิ่มตัวอย่างให้โปรไฟล์เดิม: ${profile.displayName}`;
      modeCancel.style.display = '';
      nameField.value = profile.displayName; typeField.value = profile.subjectType; relationshipField.value = profile.relationship || '';
      [nameField, typeField, relationshipField].forEach(field => { field.disabled = true; });
      samples.splice(0); prompts = shuffledPrompts();
      count.textContent = '0 / 5 ช่วงใหม่';
      record.disabled = false; root.querySelector('[data-consent]').checked = false;
      enroll.textContent = 'เพิ่มตัวอย่างในโปรไฟล์เดิม';
      formState.textContent = 'ตัวอย่างใหม่จะรวมกับโปรไฟล์เดิม ไม่สร้างโปรไฟล์ซ้ำ';
      showPrompt(); updateEnrollAvailability();
      root.querySelector('[data-record]')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    modeCancel.onclick = resetNewProfileMode;
    const listNode = root.querySelector('[data-list]');
    listNode.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-add-samples]');
      if (!button) return;
      const profile = (profileCache || []).find(item => item.profileId === button.dataset.addSamples);
      if (!profile) { formState.textContent = 'โหลดโปรไฟล์ไม่สำเร็จ • กดรีเฟรชแล้วลองอีกครั้ง'; return; }
      selectExistingProfile(profile);
    });
    if (guestRegistration) {
      root.querySelector('[data-email]').oninput = () => { registrationToken = null; root.querySelector('[data-email-otp-state]').textContent = ''; updateEnrollAvailability(); };
      root.querySelector('[data-password]').oninput = updateEnrollAvailability;
      root.querySelector('[data-password-confirm]').oninput = updateEnrollAvailability;
      root.querySelector('[data-request-otp]').onclick = async () => {
        const state = root.querySelector('[data-email-otp-state]');
        try { await api('/api/auth/email/otp/request', { method: 'POST', body: JSON.stringify({ email: root.querySelector('[data-email]').value.trim() }) }); state.textContent = 'ส่งรหัสแล้ว กรุณาตรวจอีเมล (รหัสใช้ได้ 10 นาที)'; }
        catch (error) { state.textContent = `ส่งรหัสไม่สำเร็จ: ${error.message}`; }
      };
      root.querySelector('[data-verify-otp]').onclick = async () => {
        const state = root.querySelector('[data-email-otp-state]');
        try { const result = await api('/api/auth/email/otp/verify', { method: 'POST', body: JSON.stringify({ email: root.querySelector('[data-email]').value.trim(), code: root.querySelector('[data-email-otp]').value.trim() }) }); registrationToken = result.registrationToken; state.textContent = 'ยืนยันอีเมลแล้ว สามารถลงทะเบียนเสียงและสร้างบัญชีได้'; updateEnrollAvailability(); }
        catch (error) { state.textContent = `ยืนยันไม่สำเร็จ: ${error.message}`; }
      };
    }
    root.querySelector('[data-consent]').onchange = updateEnrollAvailability; root.querySelector('[data-name]').oninput = updateEnrollAvailability;
    record.onclick = async () => { try { if (samples.length >= 5) return; samples.push(await capture(record)); updateSampleCount(); record.disabled = samples.length >= 5; updateEnrollAvailability(); showPrompt(); } catch (error) { formState.textContent = `บันทึกเสียงไม่สำเร็จ: ${errorText(error)}`; } };
    const register = async existingProfileId => {
      const email = root.querySelector('[data-email]')?.value.trim();
      const password = root.querySelector('[data-password]')?.value;
      const rememberMe = root.querySelector('[data-remember]')?.checked === true;
      if (!registrationToken) throw new Error('email_verification_required');
      const confirmPassword = root.querySelector('[data-password-confirm]').value;
      if (password !== confirmPassword) throw new Error('password_mismatch');
      const payload = { email, password, confirmPassword, registrationToken, rememberMe, deviceKey, ...(existingProfileId ? { existingProfileId } : { displayName: root.querySelector('[data-name]').value.trim(), subjectType: root.querySelector('[data-type]').value, relationship: root.querySelector('[data-relationship]').value.trim(), consent: root.querySelector('[data-consent]').checked, samples }) };
      const result = await api('/api/auth/register/voice', { method: 'POST', body: JSON.stringify(payload) });
      window.PanthoriumAuth.acceptSession(result);
      await window.PanthoriumAuth.savePassword(email, password, rememberMe);
      root.querySelector('[data-password]').value = '';
      root.remove(); notify('สร้างบัญชีถาวรสำเร็จ เข้าสู่ระบบจากอุปกรณ์อื่นด้วยอีเมลและรหัสผ่านนี้ได้');
    };
    enroll.onclick = async () => {
      enroll.disabled = true;
      formState.textContent = selectedProfileId ? 'กำลังเพิ่มตัวอย่างเข้าโปรไฟล์เดิม…' : 'กำลังตรวจเสียงและบันทึก…';
      try {
        if (selectedProfileId) {
          const profileId = selectedProfileId;
          const result = await api(`/api/biometrics/voice/profiles/${encodeURIComponent(profileId)}/samples`, {
            method: 'POST',
            body: JSON.stringify({ consent: root.querySelector('[data-consent]').checked, samples })
          });
          samples.splice(0); prompts = shuffledPrompts();
          count.textContent = `0 / 5 ช่วงใหม่ • ตัวอย่างรวม ${result.profile?.sampleCount || ''} ครั้ง`;
          record.disabled = false; root.querySelector('[data-consent]').checked = false; showPrompt();
          profileCache = null; formState.textContent = 'เพิ่มตัวอย่างเข้าโปรไฟล์เดิมสำเร็จ'; await refresh(root);
        } else if (guestRegistration) {
          await register(null);
        } else {
          await api('/api/biometrics/voice/profiles', { method: 'POST', body: JSON.stringify({ displayName: nameField.value.trim(), subjectType: typeField.value, relationship: relationshipField.value.trim(), consent: root.querySelector('[data-consent]').checked, samples }) });
          samples.splice(0); prompts = shuffledPrompts(); count.textContent = '0 / 5 ช่วง'; record.disabled = false; root.querySelector('[data-consent]').checked = false; showPrompt(); profileCache = null; formState.textContent = 'บันทึกเสียงสำเร็จ'; await refresh(root);
        }
      } catch (error) {
        if (error.message === 'email_verification_required') { registrationToken = null; root.querySelector('[data-email]').disabled = false; root.querySelector('[data-email-otp-state]').textContent = 'การยืนยันหมดอายุหรือไม่ตรงกับบัญชีนี้ กรุณาส่ง OTP ใหม่แล้วกดยืนยันอีกครั้ง'; }
        formState.textContent = `บันทึกไม่สำเร็จ: ${errorText(error)}`;
      }
      updateEnrollAvailability();
    };
    if (guestRegistration) {
      const login = root.querySelector('[data-login]');
      login.onclick = async () => {
        const state = root.querySelector('[data-login-state]'); login.disabled = true; state.textContent = 'กำลังเข้าสู่ระบบ…';
        const email = root.querySelector('[data-login-email]').value.trim();
        const password = root.querySelector('[data-login-password]').value;
        const rememberMe = root.querySelector('[data-login-remember]').checked;
        try { await window.PanthoriumAuth.login(email, password, rememberMe); await window.PanthoriumAuth.savePassword(email, password, rememberMe); root.querySelector('[data-login-password]').value = ''; root.remove(); notify('เข้าสู่บัญชีถาวรสำเร็จ'); }
        catch (error) { state.textContent = `เข้าสู่ระบบไม่สำเร็จ: ${error.message}`; login.disabled = false; }
      };
      const resetPanel = root.querySelector('[data-reset]');
      root.querySelector('[data-forgot]').onclick = () => { resetPanel.style.display = ''; root.querySelector('[data-reset-email]').value = root.querySelector('[data-login-email]').value.trim(); root.querySelector('[data-reset-state]').textContent = ''; };
      root.querySelector('[data-reset-request]').onclick = async () => {
        const state = root.querySelector('[data-reset-state]');
        try { await api('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: root.querySelector('[data-reset-email]').value.trim() }) }); state.textContent = 'หากอีเมลนี้มีบัญชี ระบบจะส่ง OTP ให้ (รหัสใช้ได้ 10 นาที)'; }
        catch (error) { state.textContent = `ส่ง OTP ไม่สำเร็จ: ${error.message}`; }
      };
      root.querySelector('[data-reset-confirm]').onclick = async () => {
        const state = root.querySelector('[data-reset-state]');
        try { const password = root.querySelector('[data-reset-password]').value; const confirmPassword = root.querySelector('[data-reset-password-confirm]').value; if (password !== confirmPassword) throw new Error('password_mismatch'); await api('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({ email: root.querySelector('[data-reset-email]').value.trim(), code: root.querySelector('[data-reset-code]').value.trim(), password, confirmPassword }) }); root.querySelector('[data-reset-code]').value = ''; root.querySelector('[data-reset-password]').value = ''; root.querySelector('[data-reset-password-confirm]').value = ''; resetPanel.style.display = 'none'; root.querySelector('[data-login-state]').textContent = 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบ'; }
        catch (error) { state.textContent = `เปลี่ยนรหัสผ่านไม่สำเร็จ: ${errorText(error)}`; }
      };
      const upgrade = document.createElement('button'); upgrade.dataset.upgrade = '1'; upgrade.textContent = 'สร้างบัญชีถาวรจากเสียงที่ลงทะเบียนไว้'; upgrade.style.cssText = 'display:none;margin-top:8px'; enroll.after(upgrade);
      upgrade.onclick = async () => { upgrade.disabled = true; formState.textContent = 'กำลังสร้างบัญชีจากเสียงเดิม…'; try { const existing = (await profiles(true))[0]; if (!existing) throw new Error('voice_profile_not_found'); await register(existing.profileId); } catch (error) { formState.textContent = `สร้างบัญชีไม่สำเร็จ: ${error.message}`; upgrade.disabled = false; } };
    }
    if (!guestRegistration) {
      const email = root.querySelector('[data-security-email]');
      const state = root.querySelector('[data-security-state]');
      root.querySelector('[data-security-request-otp]').onclick = async () => {
        if (!email.checkValidity()) { state.textContent = 'กรอกอีเมลให้ถูกต้องก่อนขอ OTP'; email.focus(); return; }
        const button = root.querySelector('[data-security-request-otp]'); button.disabled = true; state.textContent = 'กำลังส่ง OTP…';
        try { await api('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: email.value.trim() }) }); state.textContent = 'หากอีเมลนี้เป็นบัญชีของคุณ ระบบส่ง OTP แล้ว (ใช้ได้ 10 นาที)'; }
        catch (error) { state.textContent = `ส่ง OTP ไม่สำเร็จ: ${error.message}`; }
        finally { button.disabled = false; }
      };
      root.querySelector('[data-security-password-submit]').onclick = async () => {
        const code = root.querySelector('[data-security-otp]').value.trim();
        const password = root.querySelector('[data-security-password]').value;
        const confirmPassword = root.querySelector('[data-security-password-confirm]').value;
        if (!email.checkValidity()) { state.textContent = 'กรอกอีเมลให้ถูกต้อง'; email.focus(); return; }
        if (!/^[0-9]{6}$/.test(code)) { state.textContent = 'กรอกรหัส OTP 6 หลัก'; return; }
        if (password.length < 10 || password.length > 256) { state.textContent = 'รหัสผ่านใหม่ต้องมี 10–256 ตัวอักษร'; return; }
        if (password !== confirmPassword) { state.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'; return; }
        const button = root.querySelector('[data-security-password-submit]'); button.disabled = true;
        try { await api('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({ email: email.value.trim(), code, password, confirmPassword }) }); root.querySelector('[data-security-otp]').value = ''; root.querySelector('[data-security-password]').value = ''; root.querySelector('[data-security-password-confirm]').value = ''; state.textContent = 'เปลี่ยนรหัสผ่านสำเร็จ'; }
        catch (error) { state.textContent = `เปลี่ยนรหัสผ่านไม่สำเร็จ: ${errorText(error)}`; }
        finally { button.disabled = false; }
      };
    }
    root.querySelector('[data-close]').onclick = () => root.remove(); root.querySelector('[data-refresh]').onclick = () => refresh(root); refresh(root); return true;
  }
  function install() {
    const menu = document.getElementById('sm-apps') || document.querySelector('.start-menu, #start-menu');
    if (!canManageVoiceProfiles() || window.PanthoriumAuth?.isAdminEntry?.()) { document.getElementById('voice-identity-launcher')?.remove(); return !!menu; }
    if (!menu || document.getElementById('voice-identity-launcher')) return !!menu;
    const button = document.createElement('button'); button.id = 'voice-identity-launcher'; button.className = 'sm-app'; button.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit'; button.innerHTML = '<div class="ico">🎙️</div><span>ลงทะเบียน/เข้าสู่ระบบ/Voice Identity</span>'; button.onclick = () => { open(); try { closeStartMenu(); } catch (_) {} }; menu.appendChild(button); window.dispatchEvent(new CustomEvent('panthorium:apps-changed',{detail:{app:'voice-identity'}})); return true;
  }
  function openLogin() { open(); setTimeout(() => document.querySelector('#panthorium-voice-identity [data-login-email]')?.focus(), 0); }
  window.PanthoriumVoiceIdentity = { open, openLogin, refresh, authorizeAudio, profiles };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  window.addEventListener('panthorium:auth-changed', () => { profileCache = null; install(); }); setInterval(install, 1500);
})();
