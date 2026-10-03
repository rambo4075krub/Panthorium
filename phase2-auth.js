(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ADMIN_PATHS = new Set(['/admin', '/admin/', '/admin.html']);

  function isAdminEntry() { return ADMIN_PATHS.has(window.location.pathname.toLowerCase()); }
  function hasPermission(permission) { return (OS?.state?.user?.permissions || []).includes(permission); }
  function isAdministrator() { return !isGuest() && !!OS?.state?.user?.roles?.includes('administrator'); }
  function isGuest() { return !!OS?.state?.user?.roles?.includes('guest'); }
  function roleLabel(user) {
    const roles = user?.roles || [];
    if (roles.includes('guest')) return 'Guest';
    if (roles.includes('administrator')) return 'Administrator';
    if (roles.includes('operator')) return 'Operator';
    return 'User';
  }
  function notifyAuthChanged() {
    try { window.dispatchEvent(new CustomEvent('panthorium:auth-changed', { detail: { user: OS.state.user, adminEntry: isAdminEntry() } })); } catch (_) {}
    try { window.PanthoriumSecurityDashboard?.refresh?.(); } catch (_) {}
    try { window.PanthoriumUserManager?.refresh?.(); } catch (_) {}
  }
  function ensureSecurityScript() {
    if (!isAdministrator() || window.PanthoriumSecurityDashboard || document.querySelector('script[data-phase3-security-loader]')) return;
    const script = document.createElement('script'); script.src = '/security-dashboard.js?v=admin-public-split-v1'; script.dataset.phase3SecurityLoader = '1'; script.onload = notifyAuthChanged; document.head.appendChild(script);
  }
  function permissionDenied(permission) { if (typeof toast === 'function') toast(`ไม่มีสิทธิ์ ${permission}`); return false; }
  function closeForbiddenWindows() {
    if (!hasPermission('settings') && OS?.windows?.has('settings')) try { closeWindow('settings'); } catch (_) {}
    if (!isAdministrator() && OS?.windows?.has('security-dashboard')) try { closeWindow('security-dashboard'); } catch (_) {}
  }
  function updateIdentityUI() {
    const user = OS.state.user;
    const userEl = document.querySelector('.sm-user'); const statusEl = document.getElementById('sm-status'); const footerBtn = document.getElementById('btn-logout'); const settingsBtn = document.getElementById('btn-settings-quick');
    if (userEl) userEl.textContent = user?.displayName || user?.username || 'guest';
    if (statusEl) statusEl.textContent = `Online · ${roleLabel(user)}`;
    if (settingsBtn) settingsBtn.style.display = hasPermission('settings') ? '' : 'none';
    if (footerBtn) {
      if (isGuest()) { footerBtn.textContent = '🔐 เข้าสู่ระบบ'; footerBtn.title = 'เข้าสู่บัญชีด้วยอีเมล'; footerBtn.onclick = () => { window.PanthoriumVoiceIdentity?.openLogin?.(); }; }
      else { footerBtn.textContent = '🚪 ออกจากระบบ'; footerBtn.title = 'ออกจากระบบ'; footerBtn.onclick = () => logout(); }
    }
    if (isAdministrator()) ensureSecurityScript();
    setTimeout(notifyAuthChanged, 0);
  }
  function activateDesktop() {
    const loginScreen = document.getElementById('login-screen'); const desktop = document.getElementById('desktop');
    if (loginScreen) { loginScreen.classList.remove('active'); loginScreen.style.display = 'none'; }
    desktop?.classList.add('active'); OS.state.loggedIn = true; OS.state.verified = true; updateIdentityUI(); setTimeout(notifyAuthChanged, 100);
  }
  const GUEST_SESSION_KEY = 'panthorium.guest.voice-session.v1';
  const VOICE_DEVICE_KEY = 'panthorium.guest.voice-device.v1';
  const GUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;
  let guestExpiryTimer = null;
  function rememberedDeviceKey() {
    try { const key = window.localStorage.getItem(VOICE_DEVICE_KEY); return /^[0-9a-f]{64}$/i.test(key || '') ? key : null; }
    catch (_) { return null; }
  }
  function stableGuestSessionId() {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    try {
      const raw = window.sessionStorage.getItem(GUEST_SESSION_KEY);
      let entry;
      try { entry = JSON.parse(raw); } catch (_) { entry = { id: raw, createdAt: Date.now() }; }
      if (!entry || !pattern.test(entry.id || '') || !Number.isFinite(entry.createdAt) ||
          (!rememberedDeviceKey() && Date.now() - entry.createdAt >= GUEST_LIFETIME_MS)) {
        entry = { id: window.crypto?.randomUUID?.(), createdAt: Date.now() };
      }
      if (pattern.test(entry.id || '')) window.sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(entry));
      return pattern.test(entry.id || '') ? entry.id : undefined;
    } catch (_) { return undefined; }
  }
  function rememberVoiceDevice(key) {
    if (!/^[0-9a-f]{64}$/i.test(key || '')) throw new Error('invalid_device_key');
    window.localStorage.setItem(VOICE_DEVICE_KEY, key.toLowerCase());
    if (guestExpiryTimer) clearTimeout(guestExpiryTimer);
  }
  function scheduleGuestExpiry() {
    if (guestExpiryTimer) clearTimeout(guestExpiryTimer);
    if (rememberedDeviceKey() || !isGuest() || isAdminEntry()) return;
    try {
      const entry = JSON.parse(window.sessionStorage.getItem(GUEST_SESSION_KEY));
      const remaining = entry.createdAt + GUEST_LIFETIME_MS - Date.now();
      guestExpiryTimer = setTimeout(() => { guestExpiryTimer = null; if (isGuest() && !rememberedDeviceKey()) guestSession().catch(error => console.error('[Phase2 Auth] guest expiry', error)); }, Math.max(1, remaining));
    } catch (_) {}
  }
  async function guestSession() {
    const base = OS.config.backendUrl.replace(/\/$/, '');
    const deviceKey = rememberedDeviceKey();
    const res = await fetch(base + '/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestSessionId: stableGuestSessionId(), deviceKey }), credentials: 'include' });
    if (!res.ok) throw new Error('guest_auth_failed'); const data = await res.json();
    if (deviceKey && !data.deviceRecognized) try { window.localStorage.removeItem(VOICE_DEVICE_KEY); } catch (_) {}
    if (data.user?.id?.startsWith('guest:')) {
      const id = data.user.id.slice(6);
      try { const old = JSON.parse(window.sessionStorage.getItem(GUEST_SESSION_KEY)); window.sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify({ id, createdAt: old?.id === id ? old.createdAt : Date.now() })); } catch (_) {}
    }
    OS.config.accessToken = data.accessToken || ''; OS.state.user = data.user || null; updateIdentityUI(); closeForbiddenWindows(); notifyAuthChanged(); scheduleGuestExpiry(); return data;
  }
  function acceptSession(data) {
    if (!data?.accessToken || !data?.user) throw new Error('invalid_auth_response');
    if (!isAdminEntry() && data.user.roles?.includes('administrator')) throw new Error('admin_entry_required');
    OS.config.accessToken = data.accessToken; OS.state.user = data.user; updateIdentityUI(); notifyAuthChanged(); return data;
  }
  async function refreshSession() {
    if (isGuest() && !isAdminEntry()) {
      // Guests have no refresh cookie. Start a new identity for the next request;
      // authorizedFetch must discard the old identity's in-flight response.
      await guestSession();
      return false;
    }
    const base = OS.config.backendUrl.replace(/\/$/, ''); const res = await fetch(base + '/api/auth/refresh', { method: 'POST', credentials: 'include' }); if (!res.ok) return false;
    const data = await res.json();
    // A shared browser may still carry an Admin refresh cookie on the public
    // Guest route. Never install an administrator token outside /admin.
    if (!isAdminEntry() && data.user?.roles?.includes('administrator')) return false;
    OS.config.accessToken = data.accessToken || ''; OS.state.user = data.user || null; updateIdentityUI(); closeForbiddenWindows(); notifyAuthChanged(); return !!OS.config.accessToken;
  }
  async function fetchIdentity() {
    if (!OS.config.accessToken) return null; const base = OS.config.backendUrl.replace(/\/$/, ''); const res = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${OS.config.accessToken}` }, credentials: 'include' }); if (!res.ok) return null;
    const data = await res.json(); OS.state.user = data.user || OS.state.user; updateIdentityUI(); closeForbiddenWindows(); notifyAuthChanged(); return data.user || null;
  }
  async function login(username, password, rememberMe = true) {
    const base = OS.config.backendUrl.replace(/\/$/, ''); const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, rememberMe }), credentials: 'include' });
    const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'login_failed'); return acceptSession(data);
  }
  async function savePassword(email, password, selected) {
    if (!selected || !navigator.credentials?.store || !window.PasswordCredential) return;
    try { await navigator.credentials.store(new PasswordCredential({ id: email, password, name: email })); }
    catch (error) { console.info('[Phase2 Auth] browser password save unavailable', error); }
  }
  async function revokeServerSession() { const base = OS.config.backendUrl.replace(/\/$/, ''); await fetch(base + '/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null); }
  async function logout() { await revokeServerSession(); OS.config.accessToken = ''; OS.state.user = null; OS.state.loggedIn = false; OS.state.verified = false; closeForbiddenWindows(); notifyAuthChanged(); document.getElementById('desktop')?.classList.remove('active'); if (isAdminEntry()) showLogin(); else { await guestSession(); activateDesktop(); } }
  function showLogin() {
    const loginScreen = document.getElementById('login-screen'); const desktop = document.getElementById('desktop'); if (!loginScreen || !desktop) return;
    loginScreen.innerHTML = `<div class="login-card"><div class="login-avatar"><img src="/panthorium-logo.svg" alt="Panthorium" style="width:64px;height:64px;object-fit:contain;"></div><div class="login-title">Panthorium OS · Admin</div><div class="login-sub">เข้าสู่ระบบผู้ดูแลเพื่อใช้งานฟังก์ชันหลังบ้าน</div><input id="phase2-username" autocomplete="username" value="admin" placeholder="ชื่อผู้ใช้" style="width:100%;padding:12px;margin-bottom:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:var(--text);outline:none;"><input id="phase2-password" type="password" autocomplete="current-password" placeholder="รหัสผ่าน" style="width:100%;padding:12px;margin-bottom:12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:var(--text);outline:none;"><button class="login-btn" id="phase2-login-btn">เข้าสู่ระบบ</button><div class="login-hint" id="phase2-login-status">Admin RBAC · Secure Session</div></div>`;
    desktop.classList.remove('active'); loginScreen.style.display = 'flex'; loginScreen.classList.add('active'); OS.state.loggedIn = false;
    const status = document.getElementById('phase2-login-status'); const password = document.getElementById('phase2-password');
    async function submitLogin() { const btn = document.getElementById('phase2-login-btn'); btn.disabled = true; status.textContent = 'กำลังตรวจสอบสิทธิ์...'; try { await login(document.getElementById('phase2-username').value.trim(), password.value); activateDesktop(); if (typeof toast === 'function') toast('เข้าสู่ระบบสำเร็จ'); } catch (error) { console.error('[Phase2 Auth] login failed', error); const code = error.message || 'login_failed'; status.textContent = code === 'invalid_credentials' ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : code === 'auth_unavailable' ? 'บริการเข้าสู่ระบบหรือฐานข้อมูล staging ยังไม่พร้อม' : code === 'cors_denied' ? 'ต้นทางเว็บไซต์นี้ไม่ได้รับอนุญาตจาก staging' : 'เข้าสู่ระบบไม่สำเร็จ (' + code + ')'; } finally { btn.disabled = false; password.value = ''; } }
    document.getElementById('phase2-login-btn').onclick = submitLogin; password.onkeydown = e => { if (e.key === 'Enter') submitLogin(); };
  }
  let authInFlight = null;
  async function phase2EnsureAuth(force = false) {
    if (OS.config.accessToken && OS.state.user && !force) return true;
    if (authInFlight) return authInFlight;
    authInFlight = (async () => {
      // /admin restores only an administrator session. The public root may
      // restore non-admin members, but an Admin cookie must never grant access there.
      if (isAdminEntry()) return await refreshSession() && isAdministrator();
      if (!isGuest() && await refreshSession()) return true;
      await guestSession();
      return Boolean(OS.config.accessToken && hasPermission('chat'));
    })().catch(error => { console.error('[Phase2 Auth] session unavailable', error); return false; })
      .finally(() => { authInFlight = null; });
    return authInFlight;
  }
  function installPermissionGuards() {
    const originalCreateWindow = typeof createWindow === 'function' ? createWindow : null;
    if (originalCreateWindow) createWindow = function(id, title, contentHTML, opts = {}) { if (id === 'settings' && !hasPermission('settings')) return permissionDenied('settings'); if (id === 'security-dashboard' && !isAdministrator()) return permissionDenied('administrator'); return originalCreateWindow(id, title, contentHTML, opts); };
    const originalOpenSettings = typeof openSettings === 'function' ? openSettings : null;
    if (originalOpenSettings) { const guarded = function(){ if (!hasPermission('settings')) return permissionDenied('settings'); return originalOpenSettings(); }; openSettings = guarded; if (typeof APP_LIST !== 'undefined' && Array.isArray(APP_LIST)) { const app = APP_LIST.find(a => a.id === 'settings'); if (app) app.open = guarded; } }
    const originalCallAI = typeof callAI === 'function' ? callAI : null; if (originalCallAI) callAI = async function(prompt, options = {}){ if (!(await phase2EnsureAuth())) return { ok:false,text:'เชื่อมต่อเซสชันไม่สำเร็จ กรุณาลองอีกครั้ง',provider:'Auth',via:'auth' }; if (!hasPermission('chat')) return { ok:false,text:'บัญชีนี้ไม่มีสิทธิ์ใช้งาน Chat',provider:'RBAC',via:'rbac' }; return originalCallAI(prompt, options); };
  }
  function hidePublicLoginScreen() {
    if (isAdminEntry()) return;
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) { loginScreen.classList.remove('active'); loginScreen.style.display = 'none'; }
  }
  async function initializePhase2() {
    hidePublicLoginScreen();
    OS.state.user = null; ensureAuth = phase2EnsureAuth; for (let i=0;i<40&&!OS.state.booted;i++) await sleep(100); installPermissionGuards(); OS.config.accessToken=''; OS.state.user=null; OS.state.loggedIn=false; OS.state.verified=false;
    if (isAdminEntry()) { if (await phase2EnsureAuth()) activateDesktop(); else showLogin(); return; }
    try { if (await phase2EnsureAuth()) activateDesktop(); else hidePublicLoginScreen(); }
    catch (error) { hidePublicLoginScreen(); console.error('[Phase2 Auth] guest entry failed', error); }
  }
  window.PanthoriumAuth = { ensureSession: phase2EnsureAuth, login, acceptSession, savePassword, logout, refreshSession, guestSession, fetchIdentity, rememberVoiceDevice, rememberedDeviceKey, hasPermission, isAdministrator, isGuest, isAdminEntry };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isGuest() && !rememberedDeviceKey()) {
      try { const entry = JSON.parse(window.sessionStorage.getItem(GUEST_SESSION_KEY)); if (Date.now() - entry.createdAt >= GUEST_LIFETIME_MS) guestSession().catch(error => console.error('[Phase2 Auth] guest expiry', error)); } catch (_) {}
    }
  });
  initializePhase2().catch(error => console.error('[Phase2 Auth]', error));
})();
