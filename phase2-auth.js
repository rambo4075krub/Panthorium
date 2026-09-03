(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function hasPermission(permission) {
    const permissions = OS?.state?.user?.permissions || [];
    return permissions.includes(permission);
  }

  function isAdministrator() {
    return !!OS?.state?.user?.roles?.includes('administrator');
  }

  function updateIdentityUI() {
    const user = OS.state.user;
    const userEl = document.querySelector('.sm-user');
    const statusEl = document.getElementById('sm-status');
    const logoutBtn = document.getElementById('btn-logout');
    if (userEl) userEl.textContent = user?.username || 'ผู้ใช้ทั่วไป';
    if (statusEl) statusEl.textContent = isAdministrator() ? 'Online · Administrator' : 'Online · Guest';
    if (logoutBtn) logoutBtn.textContent = isAdministrator() ? '🚪 ออกจากระบบ' : '🔄 รีสตาร์ท';
  }

  function permissionDenied(permission) {
    toast(`ไม่มีสิทธิ์ ${permission}`);
    return false;
  }

  function closeForbiddenWindows() {
    if (!hasPermission('settings') && OS?.windows?.has('settings')) {
      try { closeWindow('settings'); } catch (_) {}
    }
  }

  async function guestSession() {
    const base = OS.config.backendUrl.replace(/\/$/, '');
    const res = await fetch(base + '/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('guest_auth_failed');
    const data = await res.json();
    OS.config.accessToken = data.accessToken || '';
    OS.state.user = data.user || null;
    updateIdentityUI();
    closeForbiddenWindows();
    return data;
  }

  async function refreshSession() {
    const base = OS.config.backendUrl.replace(/\/$/, '');
    const res = await fetch(base + '/api/auth/refresh', {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) return false;
    const data = await res.json();
    OS.config.accessToken = data.accessToken || '';
    OS.state.user = data.user || null;
    updateIdentityUI();
    closeForbiddenWindows();
    return !!OS.config.accessToken;
  }

  async function fetchIdentity() {
    if (!OS.config.accessToken) return null;
    const base = OS.config.backendUrl.replace(/\/$/, '');
    const res = await fetch(base + '/api/auth/me', {
      headers: { Authorization: `Bearer ${OS.config.accessToken}` },
      credentials: 'include'
    });
    if (!res.ok) return null;
    const data = await res.json();
    OS.state.user = data.user || OS.state.user;
    updateIdentityUI();
    closeForbiddenWindows();
    return data.user || null;
  }

  async function login(username, password) {
    const base = OS.config.backendUrl.replace(/\/$/, '');
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'login_failed');
    OS.config.accessToken = data.accessToken || '';
    OS.state.user = data.user || null;
    updateIdentityUI();
    return data;
  }

  async function logout() {
    const base = OS.config.backendUrl.replace(/\/$/, '');
    await fetch(base + '/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null);
    OS.config.accessToken = '';
    OS.state.user = null;
    closeForbiddenWindows();
    showLogin();
  }

  function showLogin() {
    const loginScreen = document.getElementById('login-screen');
    const desktop = document.getElementById('desktop');
    if (!loginScreen || !desktop) return;

    loginScreen.innerHTML = `
      <div class="login-card">
        <div class="login-avatar">🛡️</div>
        <div class="login-title">Panthorium OS</div>
        <div class="login-sub">เข้าสู่ระบบเพื่อใช้สิทธิ์ผู้ดูแล หรือใช้งานต่อในโหมด Guest</div>
        <input id="phase2-username" autocomplete="username" value="admin" placeholder="ชื่อผู้ใช้" style="width:100%;padding:12px;margin-bottom:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:var(--text);outline:none;">
        <input id="phase2-password" type="password" autocomplete="current-password" placeholder="รหัสผ่าน" style="width:100%;padding:12px;margin-bottom:12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:var(--text);outline:none;">
        <button class="login-btn" id="phase2-login-btn">เข้าสู่ระบบ</button>
        <button class="login-btn" id="phase2-guest-btn" style="margin-top:10px;background:rgba(255,255,255,.08);color:var(--text);">ใช้งานแบบ Guest</button>
        <div class="login-hint" id="phase2-login-status">บัญชี Admin ใช้สิทธิ์จาก PostgreSQL / RBAC</div>
      </div>`;

    desktop.classList.remove('active');
    loginScreen.style.display = 'flex';
    loginScreen.classList.add('active');

    const status = document.getElementById('phase2-login-status');
    const password = document.getElementById('phase2-password');

    async function submitLogin() {
      const btn = document.getElementById('phase2-login-btn');
      btn.disabled = true;
      status.textContent = 'กำลังตรวจสอบสิทธิ์...';
      try {
        await login(document.getElementById('phase2-username').value.trim(), password.value);
        loginScreen.classList.remove('active');
        loginScreen.style.display = 'none';
        desktop.classList.add('active');
        OS.state.loggedIn = true;
        toast('เข้าสู่ระบบสำเร็จ');
      } catch (error) {
        status.textContent = error.message === 'invalid_credentials' ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : 'ไม่สามารถเข้าสู่ระบบได้';
      } finally {
        btn.disabled = false;
        password.value = '';
      }
    }

    document.getElementById('phase2-login-btn').onclick = submitLogin;
    password.onkeydown = (event) => { if (event.key === 'Enter') submitLogin(); };
    document.getElementById('phase2-guest-btn').onclick = async () => {
      status.textContent = 'กำลังเปิด Guest session...';
      try {
        await guestSession();
        loginScreen.classList.remove('active');
        loginScreen.style.display = 'none';
        desktop.classList.add('active');
        OS.state.loggedIn = true;
        toast('เข้าสู่ระบบแบบ Guest');
      } catch {
        status.textContent = 'ไม่สามารถสร้าง Guest session ได้';
      }
    };
  }

  async function phase2EnsureAuth(force = false) {
    if (OS.config.accessToken && !force) return true;
    if (await refreshSession().catch(() => false)) return true;
    return !!(await guestSession().catch(() => null));
  }

  function installPermissionGuards() {
    // Strongest boundary: every Settings launch ultimately creates the "settings" window.
    // Guard createWindow itself so stale function references or alternate launch paths cannot bypass RBAC.
    const originalCreateWindow = typeof createWindow === 'function' ? createWindow : null;
    if (originalCreateWindow) {
      createWindow = function (id, title, contentHTML, opts = {}) {
        if (id === 'settings' && !hasPermission('settings')) {
          return permissionDenied('settings');
        }
        return originalCreateWindow(id, title, contentHTML, opts);
      };
    }

    const originalOpenSettings = typeof openSettings === 'function' ? openSettings : null;
    if (originalOpenSettings) {
      const guardedSettings = function () {
        if (!hasPermission('settings')) return permissionDenied('settings');
        return originalOpenSettings();
      };
      openSettings = guardedSettings;

      if (typeof APP_LIST !== 'undefined' && Array.isArray(APP_LIST)) {
        const settingsApp = APP_LIST.find((app) => app.id === 'settings');
        if (settingsApp) settingsApp.open = guardedSettings;
      }

      const quickSettings = document.getElementById('btn-settings-quick');
      if (quickSettings) {
        quickSettings.onclick = () => {
          if (!hasPermission('settings')) return permissionDenied('settings');
          guardedSettings();
          if (typeof closeStartMenu === 'function') closeStartMenu();
        };
      }
    }

    const originalCallAI = typeof callAI === 'function' ? callAI : null;
    if (originalCallAI) {
      callAI = async function (prompt) {
        if (!hasPermission('chat')) return { ok: false, text: 'บัญชีนี้ไม่มีสิทธิ์ใช้งาน Chat', provider: 'RBAC', via: 'rbac' };
        return originalCallAI(prompt);
      };
    }
  }

  async function initializePhase2() {
    OS.state.user = null;
    ensureAuth = phase2EnsureAuth;

    for (let i = 0; i < 40 && !OS.state.booted; i++) await sleep(100);

    installPermissionGuards();

    const restored = await refreshSession().catch(() => false);
    if (restored) {
      await fetchIdentity().catch(() => null);
      toast('กู้คืน Session สำเร็จ');
    } else {
      showLogin();
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        if (isAdministrator()) await logout();
        else location.reload();
      };
    }
  }

  window.PanthoriumAuth = {
    login,
    logout,
    refreshSession,
    guestSession,
    fetchIdentity,
    hasPermission,
    isAdministrator
  };
  initializePhase2().catch((error) => console.error('[Phase2 Auth]', error));
})();
