(function () {
  'use strict';
  const restrictedLaunchers = ['sentinel-training-launcher', 'phase4-ai-launcher', 'phase5-agent-launcher', 'phase6-automation-launcher', 'phase7-memory-launcher', 'phase8-multi-agent-launcher', 'phase9-integrations-launcher', 'phase10-production-launcher', 'phase3-security-launcher', 'phase3-security-start', 'phase2-user-manager-launcher', 'phase13-governance-launcher'];
  const restrictedLabels = /ตั้งค่า|Settings|Security|AI Platform|Sentinel Agent|Agent Automation|Memory|Multi-Agent|Integrations|Learning Lab|Training Lab|Production Intelligence|Governance|Sentinel Control|User Management/i;
  const desktop = () => window.panthoriumDesktop;
  const electron = () => desktop()?.isElectron === true;
  const android = () => window.Capacitor?.getPlatform?.() === 'android' || /PanthoriumAndroid/.test(navigator.userAgent);
  const installed = () => electron() || android() || window.Capacitor?.isNativePlatform?.() === true;
  const playUrl = 'https://play.google.com/store/apps/details?id=com.panthorium.browser';
  const auth = () => window.PanthoriumAuth;
  const user = () => typeof OS !== 'undefined' ? OS.state.user : null;
  const guest = () => !user() || user().roles?.includes('guest');
  const staff = () => !guest() && (admin() || (user()?.roles || []).includes('operator'));
  const admin = () => auth()?.isAdministrator?.() === true;
  let updateStatus = null, checking = null, installing = false, lastChecked = 0;
  let appMenuObserver = null, observedAppMenu = null;

  function style() {
    if (document.getElementById('panthorium-access-style')) return;
    const el = document.createElement('style');
    el.id = 'panthorium-access-style';
    el.textContent = `
      #start-menu .browser-action{display:block;width:calc(100% - 24px);margin:0 12px 12px;padding:12px 10px;border:1px solid rgba(0,255,204,.22);border-radius:10px;background:rgba(0,255,204,.06);color:inherit;font:inherit;text-align:center;cursor:pointer;text-decoration:none;box-sizing:border-box;}
      #start-menu .browser-action:disabled{cursor:default;opacity:.7;}
      #start-menu .browser-action [data-update-label]{display:block;font-weight:700;}
      #start-menu .browser-action [data-update-message]{display:block;margin-top:4px;font-size:12px;opacity:.8;}
      body[data-panthorium-role="user"] #btn-settings-quick,body[data-panthorium-role="guest"] #btn-settings-quick{display:none!important;}
      body[data-panthorium-role="guest"][data-panthorium-browser="desktop"] #sm-apps{display:block!important;}
      #start-menu .sm-footer{display:flex;gap:8px;}
      #start-menu .sm-footer button{flex:1;min-height:38px;}
    `;
    el.textContent += restrictedLaunchers.map(id => 'body[data-panthorium-role="guest"] #' + id).concat('body[data-panthorium-role="guest"] [data-production-intelligence="1"]').join(',') + '{display:none!important;}';
    document.head.appendChild(el);
  }
  function observeAppMenu() {
    const apps = document.getElementById('sm-apps');
    if (!apps || apps === observedAppMenu || typeof MutationObserver === 'undefined') return;
    appMenuObserver?.disconnect();
    observedAppMenu = apps;
    appMenuObserver = new MutationObserver(() => scheduleSync());
    appMenuObserver.observe(apps, { childList: true });
  }
  function newer(current, next) {
    const a = String(current).split('.').map(Number), b = String(next).split('.').map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
    return false;
  }
  // 15.0.3 exposes app-info and manual updates, but no quiet status IPC.
  async function legacyStatus() {
    if (!desktop()?.getAppInfo) return { ok: true, available: true };
    const info = await desktop().getAppInfo();
    if (!/^\d+\.\d+\.\d+$/.test(info.version || '')) throw new Error('version_unavailable');
    const response = await fetch('/browser-releases.json', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('release_unavailable');
    const release = await response.json();
    const extension = { win32: 'exe', darwin: 'dmg', linux: 'AppImage' }[info.platform];
    if (!extension) throw new Error('unsupported_platform');
    const edition = info.edition === 'admin' ? 'admin' : 'user';
    const pattern = new RegExp('^Panthorium-Browser-' + edition + '-(\\d+\\.\\d+\\.\\d+)-.+\\.' + extension + '$');
    const versions = (release.assets || []).map(asset => pattern.exec(asset.name || '')?.[1]).filter(Boolean);
    if (!versions.length) throw new Error('release_unavailable');
    const remote = versions.reduce((best, value) => newer(best, value) ? value : best);
    return { ok: true, current: info.version, remote, available: newer(info.version, remote) };
  }
  function renderUpdateStatus() {
    const button = document.getElementById('panthorium-browser-update');
    if (!button) return;
    button.disabled = installing || !!checking;
    if (!button.querySelector('[data-update-label]')) button.innerHTML = '<span data-update-label>อัพเดท</span><small data-update-message role="status" aria-live="polite"></small>';
    const web = window.PanthoriumUpdates?.state?.();
    const message = installing ? 'กำลังเตรียมอัพเดท' : checking ? 'กำลังตรวจสอบเวอร์ชั่น' : web?.available ? 'มีเวอร์ชั่นเว็บใหม่พร้อมอัพเดท' : !updateStatus?.ok ? 'ตรวจสอบไม่สำเร็จ กดเพื่อลองอัพเดท' : updateStatus.storeCheck ? 'ตรวจสอบและอัพเดทผ่าน Google Play' : updateStatus.available ? 'มีเวอร์ชั่นใหม่พร้อมอัพเดท' : 'เป็นเวอร์ชั่นล่าสุดแล้ว';
    button.querySelector('[data-update-message]').textContent = message;
    button.dataset.state = installing ? 'installing' : !updateStatus?.ok ? 'unknown' : updateStatus.available ? 'available' : 'current';
    button.title = 'อัพเดท — ' + message;
  }
  async function refreshUpdateStatus(force = false) {
    if (!installed()) return;
    if (checking) return checking;
    if (!force && lastChecked && Date.now() - lastChecked < 60000) return updateStatus;
    checking = (async () => {
      try {
        const result = android() ? { ok: true, available: true, storeCheck: true } : electron() ? (desktop()?.getUpdateStatus ? await desktop().getUpdateStatus() : await legacyStatus()) : { ok: false };
        updateStatus = { ...result, available: result?.available === true || (!!result?.current && !!result?.remote && newer(result.current, result.remote)) };
      } catch (_) { updateStatus = { ok: false }; }
      finally { lastChecked = Date.now(); }
      return updateStatus;
    })();
    renderUpdateStatus();
    try { return await checking; }
    finally { checking = null; renderUpdateStatus(); }
  }
  async function updateBrowser() {
    if (installing) return;
    if (android()) {
      // A user gesture opens the verified store destination even on older APKs
      // without an app-version bridge. Never claim their binary is current.
      window.location.assign(playUrl);
      return;
    }
    if (window.PanthoriumUpdates?.state?.().available) {
      await window.PanthoriumUpdates.apply({ manual: true });
      return;
    }
    const status = await refreshUpdateStatus(true);
    if (status?.ok && !status.available) {
      await window.PanthoriumUpdates?.check?.({ manual: true });
      if (window.PanthoriumUpdates?.state?.().available) await window.PanthoriumUpdates.apply({ manual: true });
      return;
    }
    if (!desktop()?.checkForUpdates) {
      window.location.assign('/browser-download.html' + (admin() ? '?edition=admin' : ''));
      return;
    }
    installing = true;
    renderUpdateStatus();
    try {
      const result = await desktop().checkForUpdates();
      if (!result?.ok) {
        updateStatus = { ok: false };
        window.location.assign('/browser-download.html' + (admin() ? '?edition=admin' : ''));
      }
      else updateStatus = { ...result, available: !!result.deferred || (!!result.current && !!result.remote && newer(result.current, result.remote)) };
    } catch (_) { updateStatus = { ok: false }; }
    finally { installing = false; renderUpdateStatus(); }
  }
  function restrictWindows() {
    const catalog = window.PanthoriumWindowCatalog;
    if (!catalog) return;
    for (const app of catalog.apps) {
      if (!catalog.allowed(app, user())) {
        const node = document.querySelector(app.selector);
        if (node) {
          if (app.windowId && typeof closeWindow === 'function') closeWindow(app.windowId);
          else if (app.closeButton && node.querySelector(app.closeButton)) node.querySelector(app.closeButton).click();
          else node.remove();
        }
      }
    }
  }
  function sync() {
    const menu = document.getElementById('start-menu');
    if (!menu) return;
    style();
    const isGuest = guest(), isDesktop = electron(), isInstalled = installed(), isStaff = staff();
    document.body.dataset.panthoriumRole = isGuest ? 'guest' : admin() ? 'admin' : 'user';
    document.body.dataset.panthoriumBrowser = isDesktop ? 'desktop' : 'web';
    restrictedLaunchers.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = isStaff ? '' : 'none'; });
    const apps = document.getElementById('sm-apps');
    observeAppMenu();
    if (apps && !isStaff) {
      const entries = [...apps.children];
      let sentinel = entries.find(el => /Sentinel AI/i.test(el.textContent || ''));
      let voice = entries.find(el => el.dataset.appId === 'account-register');
      if (!sentinel) { sentinel = document.createElement('button'); sentinel.type = 'button'; sentinel.className = 'sm-app'; sentinel.innerHTML = '<div class="ico">🤖</div><span>Sentinel AI</span>'; sentinel.onclick = () => window.PanthoriumVoiceCommands?.windowAction?.('open_sentinel'); }
      if (isGuest && !voice) { voice = document.createElement('button'); voice.type = 'button'; voice.className = 'sm-app'; voice.dataset.appId = 'account-register'; voice.innerHTML = '<div class="ico">📝</div><span>ลงทะเบียน</span>'; voice.onclick = () => window.PanthoriumAccounts?.openRegistration?.(); }
      const account = typeof OS !== 'undefined' ? OS?.state?.user : null;
      const registered = entries.filter(el => {
        const id = el.dataset.appId;
        if (id === 'voice-identity' || el.id === 'voice-identity-launcher') return false;
        if (!id || restrictedLaunchers.includes(el.id) || el.dataset.productionIntelligence === '1') return false;
        if (!isGuest && ['account-register', 'account-login'].includes(id)) return false;
        if (guest() && id !== 'cloud-group-settings' && id !== 'contact' && id !== 'privacy-policy' && id !== 'sentinel' && id !== 'voice-identity' && id !== 'billing' && id !== 'account-register' && id !== 'account-login') return false;
        if ((id === 'notes' || id === 'files' || id === 'calendar') && !account?.permissions?.includes('chat')) return false;
        return true;
      });
      const registeredIds = new Set(['sentinel', 'voice-identity', ...registered.map(el => el.dataset.appId)]);
      const minimized = entries.filter(el => el.dataset.minimizedWindow && registeredIds.has(el.dataset.minimizedWindow));
      let safeEntries = [...new Set([sentinel, isGuest ? voice : null, ...registered, ...minimized].filter(Boolean))];
      // The menu layout owns ordering. Preserve its existing order while
      // filtering access, otherwise the two observers keep moving Guest's
      // registration entry back and forth and starve clicks/rendering.
      if (window.PanthoriumStartMenuUI?.keepPinnedLast) {
        const allowed = new Set(safeEntries);
        safeEntries = [...entries.filter(entry => allowed.has(entry)), ...safeEntries.filter(entry => !entries.includes(entry))];
      }
      if (apps.children.length !== safeEntries.length || safeEntries.some((entry, index) => apps.children[index] !== entry)) apps.replaceChildren(...safeEntries);
    } else if (apps) menu.querySelectorAll('#sm-apps > *').forEach(el => { el.style.display = ''; });
    if (!isGuest) apps?.querySelectorAll('[data-app-id="account-register"], [data-app-id="account-login"]').forEach(el => el.remove());
    window.PanthoriumStartMenuUI?.keepPinnedLast?.(apps);
    const settings = document.getElementById('btn-settings-quick');
    if (settings) settings.style.display = isStaff ? '' : 'none';
    const footer = menu.querySelector('.sm-footer');
    let restart = document.getElementById('btn-restart');
    if (footer && !restart) {
      restart = document.createElement('button');
      restart.id = 'btn-restart';
      restart.type = 'button';
      footer.insertBefore(restart, footer.firstChild);
    }
    if (restart) {
      restart.hidden = false;
      restart.style.display = '';
      restart.textContent = '🔄 รีสตาร์ท';
      restart.title = 'รีสตาร์ท Panthorium';
      restart.onclick = () => {
        window.PanthoriumLiveVoice?.stop?.();
        window.PanthoriumVoice?.pause?.();
        menu.classList.remove('open');
        document.getElementById('start-btn')?.setAttribute('aria-expanded', 'false');
        window.location.reload();
      };
    }
    const logout = document.getElementById('btn-logout');
    document.getElementById('btn-login')?.remove();
    if (logout) {
      logout.style.display = '';
      logout.textContent = '🚪 ออกจากระบบ';
      logout.title = 'ออกจากระบบ';
      logout.onclick = () => auth()?.logout?.();
    }
    if (isInstalled) {
      // Every installed edition uses the same update controls.
      document.getElementById('panthorium-browser-download')?.remove();
      let update = document.getElementById('panthorium-browser-update');
      if (!update) { update = document.createElement('button'); update.id = 'panthorium-browser-update'; update.type = 'button'; update.className = 'browser-action'; update.onclick = updateBrowser; menu.appendChild(update); }
      renderUpdateStatus();
      refreshUpdateStatus();
    } else {
      document.getElementById('panthorium-browser-update')?.remove();
    }
    if (!isInstalled) {
      document.getElementById('panthorium-browser-update')?.remove();
      let download = document.getElementById('panthorium-browser-download');
      if (!download) {
        download = document.createElement('a');
        download.id = 'panthorium-browser-download';
        download.className = 'browser-action';
        download.target = '_blank';
        download.rel = 'noopener';
        menu.appendChild(download);
      }
      download.textContent = admin() ? 'ดาวน์โหลด Panthorium Browser Admin' : 'ดาวน์โหลด Panthorium Browser';
      download.href = admin() ? '/browser-download.html?edition=admin' : '/browser-download.html';
    } else {
      document.getElementById('panthorium-browser-download')?.remove();
    }
    restrictWindows();
  }
  let syncQueued = false;
  const scheduleSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => { syncQueued = false; sync(); });
  };
  for (const name of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:desktop-ready', 'panthorium:boot-complete', 'focus']) window.addEventListener(name, scheduleSync);
  window.addEventListener('panthorium:update-status', renderUpdateStatus);
  document.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
  document.getElementById('start-btn')?.addEventListener('click', scheduleSync);
  scheduleSync();
  window.PanthoriumAccessShell = { sync, refreshUpdateStatus };
})();
