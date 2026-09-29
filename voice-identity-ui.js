(function () {
  'use strict';
  let profileCache = null;
  let profileCacheAt = 0;

  function getOS() { try { return typeof OS !== 'undefined' ? OS : null; } catch (_) { return null; } }
  function isAdminEnrollmentContext() { const auth = window.PanthoriumAuth; return auth?.isAdministrator?.() === true && auth?.isAdminEntry?.() === true; }
  function canManageVoiceProfiles() { const auth = window.PanthoriumAuth; return !!auth && (auth.isGuest?.() === true || auth.hasPermission?.('chat') === true || auth.hasPermission?.('settings') === true); }
  function notify(message) { try { if (typeof toast === 'function') toast(message); else console.info('[VoiceIdentity]', message); } catch (_) {} }
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
    if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
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
      state.textContent = !status.configured ? 'ยังต้องตั้งค่าบริการ Speaker Verification และกุญแจเข้ารหัสบนเซิร์ฟเวอร์' : status.gateEnabled ? 'ด่านคัดเสียงเปิดใช้งานแล้ว' : 'พร้อมลงทะเบียนและทดสอบเสียง · ด่านคัดเสียงยังไม่เปิด';
      state.style.color = status.configured ? '#6ee7b7' : '#fbbf24';
      const upgrade = root.querySelector('[data-upgrade]'); if (upgrade) upgrade.style.display = list.length ? '' : 'none';
      root.querySelector('[data-list]').innerHTML = list.length ? list.map(item => `<div style="padding:10px;border-bottom:1px solid #243448"><b>${esc(item.displayName)}</b> · ${esc(label(item.subjectType))}<div style="font-size:11px;color:#8ea3b8">ตัวอย่าง ${esc(item.sampleCount)} ครั้ง${item.relationship ? ` · ${esc(item.relationship)}` : ''}</div><button data-remove="${esc(item.profileId)}" style="margin-top:6px">ลบเสียงนี้</button></div>`).join('') : '<div style="color:#94a3b8">ยังไม่มีเสียงที่ลงทะเบียน ระบบจะยังไม่เปิดด่านคัดกรอง</div>';
      root.querySelectorAll('[data-remove]').forEach(button => { button.onclick = async () => { if (!confirm('ลบเสียงที่ลงทะเบียนนี้?')) return; await api(`/api/biometrics/voice/profiles/${encodeURIComponent(button.dataset.remove)}`, { method: 'DELETE' }); profileCache = null; await refresh(root); }; });
    } catch (error) { state.textContent = `โหลดข้อมูลไม่สำเร็จ: ${error.message}`; state.style.color = '#fda4af'; }
  }
  async function open() {
    if (!canManageVoiceProfiles()) { notify('กรุณาเข้าสู่ระบบบัญชีที่มีสิทธิ์จัดการเสียงก่อน'); return false; }
    if (document.getElementById('panthorium-voice-identity')) return;
    const root = document.createElement('div');
    root.id = 'panthorium-voice-identity';
    root.style.cssText = 'position:fixed;inset:5%;z-index:10050;background:rgba(7,15,26,.99);border:1px solid #2b5268;border-radius:16px;color:#e6f5ff;padding:16px;overflow:auto;box-shadow:0 24px 80px #000;font-family:system-ui';
    const adminOption = isAdminEnrollmentContext() ? '<option value="administrator">แอดมิน</option>' : '';
    const guestRegistration = window.PanthoriumAuth?.isGuest?.() === true;
    const emailField = guestRegistration ? '<label style="display:block;margin-top:10px;font-size:12px">อีเมลสำหรับบัญชีถาวร<input data-email type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"></label><button data-request-otp type="button" style="margin-top:8px">ส่งรหัสยืนยันอีเมล</button><input data-email-otp inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="รหัส OTP 6 หลัก" style="width:130px;padding:9px;margin:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><button data-verify-otp type="button">ยืนยันอีเมล</button><div data-email-otp-state style="font-size:12px"></div><label style="display:block;margin-top:8px;font-size:12px">ตั้งรหัสผ่าน (อย่างน้อย 10 ตัวอักษร)<input data-password type="password" autocomplete="new-password" required minlength="10" maxlength="256" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"></label><label style="display:block;margin-top:8px;font-size:12px"><input data-remember type="checkbox"> ให้เบราว์เซอร์จดจำรหัสผ่านและการเข้าสู่ระบบบนอุปกรณ์นี้</label><p style="font-size:12px;color:#9fb4c7">ยืนยันอีเมลด้วยรหัส OTP ก่อนลงทะเบียนเสียง เมื่อสำเร็จระบบจะสร้างบัญชีถาวร ใช้เข้าสู่ระบบจากอุปกรณ์อื่นได้ หากไม่ลงทะเบียนเสียง guest จะหมดอายุภายใน 24 ชั่วโมง</p>' : '';
    const loginPanel = guestRegistration ? '<div style="margin-top:22px;border-top:1px solid #294154;padding-top:14px"><h3>เข้าสู่บัญชีถาวร</h3><input data-login-email type="email" autocomplete="username" placeholder="อีเมล" style="width:100%;box-sizing:border-box;padding:9px;margin-bottom:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><input data-login-password type="password" autocomplete="current-password" placeholder="รหัสผ่าน" style="width:100%;box-sizing:border-box;padding:9px;margin-bottom:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><label style="display:block;font-size:12px"><input data-login-remember type="checkbox"> จดจำรหัสผ่านและการเข้าสู่ระบบบนอุปกรณ์นี้</label><button data-login style="margin-top:8px">เข้าสู่ระบบ</button> <button data-forgot type="button">ลืมรหัสผ่าน</button><div data-reset style="display:none;margin-top:12px"><button data-reset-request type="button">ส่ง OTP ไปยังอีเมลนี้</button><input data-reset-code inputmode="numeric" maxlength="6" placeholder="OTP 6 หลัก" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><input data-reset-password type="password" autocomplete="new-password" minlength="10" placeholder="รหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร" style="width:100%;box-sizing:border-box;padding:9px;margin-top:8px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><button data-reset-confirm type="button" style="margin-top:8px">ตั้งรหัสผ่านใหม่</button><div data-reset-state style="font-size:12px;margin-top:6px"></div></div><div data-login-state style="font-size:12px;margin-top:6px"></div></div>' : '';
    const deviceKey = guestRegistration ? (window.PanthoriumAuth?.rememberedDeviceKey?.() || Array.from(window.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')) : null;
    root.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px"><div><h2 style="margin:0">🎙️ Voice Identity</h2><div data-state style="font-size:12px;color:#8ea3b8">กำลังตรวจสอบ…</div></div><div><button data-refresh>รีเฟรช</button> <button data-close>✕</button></div></div><div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:14px;margin-top:14px"><section style="border:1px solid #294154;border-radius:12px;padding:14px;background:#0a1725"><h3 style="margin-top:0">ลงทะเบียนเสียงที่อนุญาต</h3><input data-name maxlength="80" placeholder="ชื่อบุคคล" style="width:100%;box-sizing:border-box;padding:9px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px">${emailField}<select data-type style="width:100%;margin-top:8px;padding:9px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><option value="user">ผู้ใช้</option><option value="family">คนในครอบครัว</option>${adminOption}</select><input data-relationship maxlength="80" placeholder="ความสัมพันธ์ (ถ้ามี)" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;background:#07111d;color:#fff;border:1px solid #36566c;border-radius:8px"><p style="font-size:12px;color:#9fb4c7">อ่านข้อความที่แสดงแล้วบันทึก 3–5 ช่วง ช่วงละ 12 วินาที รวมประมาณ 36–60 วินาที พูดด้วยเสียงธรรมชาติ</p><div data-prompt style="margin:10px 0;padding:12px;border-radius:8px;background:#11263a;line-height:1.6" aria-live="polite"></div><button data-record>บันทึกตัวอย่างเสียง</button><div data-count style="margin:9px 0;color:#67e8f9">0 / 5 ช่วง</div><label style="font-size:12px"><input data-consent type="checkbox"> บุคคลนี้ยินยอมให้สร้างและเก็บแม่แบบเสียงแบบเข้ารหัส</label><br><button data-enroll disabled style="margin-top:12px">บันทึก Voice Identity</button><div data-form-state style="margin-top:8px;font-size:12px"></div></section><section style="border:1px solid #294154;border-radius:12px;padding:14px;background:#0a1725"><h3 style="margin-top:0">เสียงที่ระบบยอมรับ</h3><div data-list></div><p style="font-size:11px;color:#8ea3b8">เมื่อมีอย่างน้อยหนึ่งรายการ ระบบจะตรวจลายนิ้วมือเสียงก่อนถอดคำพูด เสียงอื่นจะไม่ถูกส่งไป STT หรือ Sentinel</p>${loginPanel}</section></div>`;
    document.body.appendChild(root);
    let registrationToken = null;
    const samples = [];
    let prompts = shuffledPrompts();
    const prompt = root.querySelector('[data-prompt]');
    const showPrompt = () => { prompt.textContent = samples.length < 5 ? `อ่านข้อความช่วงที่ ${samples.length + 1}: ${prompts[samples.length]}` : 'บันทึกครบ 60 วินาที พร้อมลงทะเบียน'; };
    showPrompt();
    const record = root.querySelector('[data-record]'); const enroll = root.querySelector('[data-enroll]'); const count = root.querySelector('[data-count]'); const formState = root.querySelector('[data-form-state]');
    const updateEnrollAvailability = () => { enroll.disabled = samples.length < 3 || !root.querySelector('[data-consent]').checked || !root.querySelector('[data-name]').value.trim() || (guestRegistration && (!root.querySelector('[data-email]').checkValidity() || !root.querySelector('[data-password]').checkValidity() || !registrationToken)); };
    if (guestRegistration) {
      root.querySelector('[data-email]').oninput = () => { registrationToken = null; root.querySelector('[data-email-otp-state]').textContent = ''; updateEnrollAvailability(); };
      root.querySelector('[data-password]').oninput = updateEnrollAvailability;
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
    record.onclick = async () => { try { if (samples.length >= 5) return; samples.push(await capture(record)); count.textContent = `${samples.length} / 5 ช่วง · ${samples.length * 12} วินาที${samples.length >= 3 ? ' · พร้อมลงทะเบียน' : ''}`; record.disabled = samples.length >= 5; updateEnrollAvailability(); showPrompt(); } catch (error) { formState.textContent = `บันทึกเสียงไม่สำเร็จ: ${error.message}`; } };
    const register = async existingProfileId => {
      const email = root.querySelector('[data-email]')?.value.trim();
      const password = root.querySelector('[data-password]')?.value;
      const rememberMe = root.querySelector('[data-remember]')?.checked === true;
      if (!registrationToken) throw new Error('email_verification_required');
      const payload = { email, password, rememberMe, deviceKey, registrationToken, ...(existingProfileId ? { existingProfileId } : { displayName: root.querySelector('[data-name]').value.trim(), subjectType: root.querySelector('[data-type]').value, relationship: root.querySelector('[data-relationship]').value.trim(), consent: root.querySelector('[data-consent]').checked, samples }) };
      const result = await api('/api/auth/register/voice', { method: 'POST', body: JSON.stringify(payload) });
      window.PanthoriumAuth.acceptSession(result);
      await window.PanthoriumAuth.savePassword(email, password, rememberMe);
      root.querySelector('[data-password]').value = '';
      root.remove(); notify('สร้างบัญชีถาวรสำเร็จ เข้าสู่ระบบจากอุปกรณ์อื่นด้วยอีเมลและรหัสผ่านนี้ได้');
    };
    enroll.onclick = async () => {
      enroll.disabled = true; formState.textContent = 'กำลังตรวจเสียงและสร้างบัญชี…';
      try {
        if (guestRegistration) await register(null);
        else {
          await api('/api/biometrics/voice/profiles', { method: 'POST', body: JSON.stringify({ displayName: root.querySelector('[data-name]').value.trim(), subjectType: root.querySelector('[data-type]').value, relationship: root.querySelector('[data-relationship]').value.trim(), consent: root.querySelector('[data-consent]').checked, samples }) });
          samples.splice(0); prompts = shuffledPrompts(); count.textContent = '0 / 5 ช่วง'; record.disabled = false; root.querySelector('[data-consent]').checked = false; showPrompt(); profileCache = null; formState.textContent = 'บันทึกเสียงสำเร็จ'; await refresh(root);
        }
      } catch (error) { formState.textContent = `บันทึกไม่สำเร็จ: ${error.message}`; }
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
      root.querySelector('[data-forgot]').onclick = () => { resetPanel.style.display = ''; root.querySelector('[data-reset-state]').textContent = 'กรอกอีเมลด้านบนเพื่อรับรหัส OTP'; };
      root.querySelector('[data-reset-request]').onclick = async () => {
        const state = root.querySelector('[data-reset-state]');
        try { await api('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: root.querySelector('[data-login-email]').value.trim() }) }); state.textContent = 'หากอีเมลนี้มีบัญชี ระบบจะส่ง OTP ให้ (รหัสใช้ได้ 10 นาที)'; }
        catch (error) { state.textContent = `ส่ง OTP ไม่สำเร็จ: ${error.message}`; }
      };
      root.querySelector('[data-reset-confirm]').onclick = async () => {
        const state = root.querySelector('[data-reset-state]');
        try { await api('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({ email: root.querySelector('[data-login-email]').value.trim(), code: root.querySelector('[data-reset-code]').value.trim(), password: root.querySelector('[data-reset-password]').value }) }); root.querySelector('[data-reset-code]').value = ''; root.querySelector('[data-reset-password]').value = ''; resetPanel.style.display = 'none'; root.querySelector('[data-login-state]').textContent = 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบ'; }
        catch (error) { state.textContent = `เปลี่ยนรหัสผ่านไม่สำเร็จ: ${error.message}`; }
      };
      const upgrade = document.createElement('button'); upgrade.dataset.upgrade = '1'; upgrade.textContent = 'สร้างบัญชีถาวรจากเสียงที่ลงทะเบียนไว้'; upgrade.style.cssText = 'display:none;margin-top:8px'; enroll.after(upgrade);
      upgrade.onclick = async () => { upgrade.disabled = true; formState.textContent = 'กำลังสร้างบัญชีจากเสียงเดิม…'; try { const existing = (await profiles(true))[0]; if (!existing) throw new Error('voice_profile_not_found'); await register(existing.profileId); } catch (error) { formState.textContent = `สร้างบัญชีไม่สำเร็จ: ${error.message}`; upgrade.disabled = false; } };
    }
    root.querySelector('[data-close]').onclick = () => root.remove(); root.querySelector('[data-refresh]').onclick = () => refresh(root); refresh(root); return true;
  }
  function install() {
    const menu = document.getElementById('sm-apps') || document.querySelector('.start-menu, #start-menu');
    if (!canManageVoiceProfiles() || window.PanthoriumAuth?.isAdminEntry?.()) { document.getElementById('voice-identity-launcher')?.remove(); return !!menu; }
    if (!menu || document.getElementById('voice-identity-launcher')) return !!menu;
    const button = document.createElement('button'); button.id = 'voice-identity-launcher'; button.className = 'sm-app'; button.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit'; button.innerHTML = '<div class="ico">🎙️</div><span>Voice Identity</span>'; button.onclick = () => { open(); try { closeStartMenu(); } catch (_) {} }; menu.appendChild(button); return true;
  }
  function openLogin() { open(); setTimeout(() => document.querySelector('#panthorium-voice-identity [data-login-email]')?.focus(), 0); }
  window.PanthoriumVoiceIdentity = { open, openLogin, refresh, authorizeAudio, profiles };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  window.addEventListener('panthorium:auth-changed', () => { profileCache = null; install(); }); setInterval(install, 1500);
})();
