(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ADMIN_PATHS = new Set(['/admin', '/admin/', '/admin.html']);

  function isAdminEntry() { return ADMIN_PATHS.has(window.location.pathname.toLowerCase()); }
  function hasPermission(permission) { return (OS?.state?.user?.permissions || []).includes(permission); }
  function isAdministrator() { return !!OS?.state?.user?.roles?.includes('administrator'); }
  function isGuest() { return !!OS?.state?.user?.roles?.includes('guest'); }
  function roleLabel(user) {
    const roles = user?.roles || [];
    if (roles.includes('administrator')) return 'Administrator';
    if (roles.includes('operator')) return 'Operator';
    if (roles.includes('guest')) return 'Guest';
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
    if (userEl) userEl.textContent = user?.username || 'guest';
    if (statusEl) statusEl.textContent = `Online · ${roleLabel(user)}`;
    if (settingsBtn) settingsBtn.style.display = hasPermission('settings') ? '' : 'none';
    if (footerBtn) {
      if (isGuest()) { footerBtn.textContent = '🔐 เข้าสู่ระบบผู้ดูแล'; footerBtn.title = 'ไปหน้าผู้ดูแล'; footerBtn.onclick = () => { window.location.href = '/admin'; }; }
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
  async function guestSession() {
    const base = OS.config.backendUrl.replace(/\/$/, '');
    const res = await fetch(base + '/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'include' });
    if (!res.ok) throw new Error('guest_auth_failed'); const data = await res.json(); OS.config.accessToken = data.accessToken || ''; OS.state.user = data.user || null; updateIdentityUI(); closeForbiddenWindows(); notifyAuthChanged(); return data;
  }
  async function refreshSession() {
    const base = OS.config.backendUrl.replace(/\/$/, ''); const res = await fetch(base + '/api/auth/refresh', { method: 'POST', credentials: 'include' }); if (!res.ok) return false;
    const data = await res.json(); OS.config.accessToken = data.accessToken || ''; OS.state.user = data.user || null; updateIdentityUI(); closeForbiddenWindows(); notifyAuthChanged(); return !!OS.config.accessToken;
  }
  async function fetchIdentity() {
    if (!OS.config.accessToken) return null; const base = OS.config.backendUrl.replace(/\/$/, ''); const res = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${OS.config.accessToken}` }, credentials: 'include' }); if (!res.ok) return null;
    const data = await res.json(); OS.state.user = data.user || OS.state.user; updateIdentityUI(); closeForbiddenWindows(); notifyAuthChanged(); return data.user || null;
  }
  async function login(username, password) {
    const base = OS.config.backendUrl.replace(/\/$/, ''); const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), credentials: 'include' });
    const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'login_failed'); OS.config.accessToken = data.accessToken || ''; OS.state.user = data.user || null; updateIdentityUI(); notifyAuthChanged(); return data;
  }
  async function revokeServerSession() { const base = OS.config.backendUrl.replace(/\/$/, ''); await fetch(base + '/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null); }
  async function logout() { await revokeServerSession(); OS.config.accessToken = ''; OS.state.user = null; OS.state.loggedIn = false; OS.state.verified = false; closeForbiddenWindows(); notifyAuthChanged(); document.getElementById('desktop')?.classList.remove('active'); if (isAdminEntry()) showLogin(); else { await guestSession(); activateDesktop(); } }
  function showLogin() {
    const loginScreen = document.getElementById('login-screen'); const desktop = document.getElementById('desktop'); if (!loginScreen || !desktop) return;
    loginScreen.innerHTML = `<div class="login-card"><div class="login-avatar"><img src="/panthorium-logo.svg" alt="Panthorium" style="width:64px;height:64px;object-fit:contain;"></div><div class="login-title">Panthorium OS · Admin</div><div class="login-sub">เข้าสู่ระบบผู้ดูแลเพื่อใช้งานฟังก์ชันหลังบ้าน</div><input id="phase2-username" autocomplete="username" value="admin" placeholder="ชื่อผู้ใช้" style="width:100%;padding:12px;margin-bottom:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:var(--text);outline:none;"><input id="phase2-password" type="password" autocomplete="current-password" placeholder="รหัสผ่าน" style="width:100%;padding:12px;margin-bottom:12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:var(--text);outline:none;"><button class="login-btn" id="phase2-login-btn">เข้าสู่ระบบ</button><div class="login-hint" id="phase2-login-status">Admin RBAC · Secure Session</div></div>`;
    desktop.classList.remove('active'); loginScreen.style.display = 'flex'; loginScreen.classList.add('active'); OS.state.loggedIn = false;
    const status = document.getElementById('phase2-login-status'); const password = document.getElementById('phase2-password');
    async function submitLogin() { const btn = document.getElementById('phase2-login-btn'); btn.disabled = true; status.textContent = 'กำลังตรวจสอบสิทธิ์...'; try { await login(document.getElementById('phase2-username').value.trim(), password.value); activateDesktop(); if (typeof toast === 'function') toast('เข้าสู่ระบบสำเร็จ'); } catch (error) { status.textContent = error.message === 'invalid_credentials' ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : 'ไม่สามารถเข้าสู่ระบบได้'; } finally { btn.disabled = false; password.value = ''; } }
    document.getElementById('phase2-login-btn').onclick = submitLogin; password.onkeydown = e => { if (e.key === 'Enter') submitLogin(); };
  }
  async function phase2EnsureAuth(force = false) { if (OS.config.accessToken && !force) return true; return false; }
  function installPermissionGuards() {
    const originalCreateWindow = typeof createWindow === 'function' ? createWindow : null;
    if (originalCreateWindow) createWindow = function(id, title, contentHTML, opts = {}) { if (id === 'settings' && !hasPermission('settings')) return permissionDenied('settings'); if (id === 'security-dashboard' && !isAdministrator()) return permissionDenied('administrator'); return originalCreateWindow(id, title, contentHTML, opts); };
    const originalOpenSettings = typeof openSettings === 'function' ? openSettings : null;
    if (originalOpenSettings) { const guarded = function(){ if (!hasPermission('settings')) return permissionDenied('settings'); return originalOpenSettings(); }; openSettings = guarded; if (typeof APP_LIST !== 'undefined' && Array.isArray(APP_LIST)) { const app = APP_LIST.find(a => a.id === 'settings'); if (app) app.open = guarded; } }
    const originalCallAI = typeof callAI === 'function' ? callAI : null; if (originalCallAI) callAI = async function(prompt){ if (!hasPermission('chat')) return { ok:false,text:'บัญชีนี้ไม่มีสิทธิ์ใช้งาน Chat',provider:'RBAC',via:'rbac' }; return originalCallAI(prompt); };
  }
  async function initializePhase2() {
    OS.state.user = null; ensureAuth = phase2EnsureAuth; for (let i=0;i<40&&!OS.state.booted;i++) await sleep(100); installPermissionGuards(); await revokeServerSession(); OS.config.accessToken=''; OS.state.user=null; OS.state.loggedIn=false; OS.state.verified=false;
    if (isAdminEntry()) { showLogin(); return; }
    try { await guestSession(); activateDesktop(); } catch (error) { console.error('[Phase2 Auth] guest entry failed', error); }
  }
  window.PanthoriumAuth = { login, logout, refreshSession, guestSession, fetchIdentity, hasPermission, isAdministrator, isGuest, isAdminEntry };
  initializePhase2().catch(error => console.error('[Phase2 Auth]', error));
})();