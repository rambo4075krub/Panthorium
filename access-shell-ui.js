(function () {
  'use strict';
  const restrictedLaunchers = ['sentinel-training-launcher', 'phase4-ai-launcher', 'phase5-agent-launcher', 'phase6-automation-launcher', 'phase7-memory-launcher', 'phase8-multi-agent-launcher', 'phase9-integrations-launcher', 'phase10-production-launcher', 'phase3-security-launcher', 'phase3-security-start', 'phase2-user-manager-launcher', 'phase13-governance-launcher'];
  const restrictedLabels = /ตั้งค่า|Settings|Security|AI Platform|Sentinel Agent|Agent Automation|Memory|Multi-Agent|Integrations|Learning Lab|Training Lab|Production Intelligence|Governance|Sentinel Control|User Management/i;
  const desktop = () => window.panthoriumDesktop;
  const electron = () => desktop()?.isElectron === true;
  const auth = () => window.PanthoriumAuth;
  const user = () => typeof OS !== 'undefined' ? OS.state.user : null;
  const guest = () => !user() || user().roles?.includes('guest');
  const admin = () => auth()?.isAdministrator?.() === true;
  let updateStatus = null, checking = null, installing = false, lastChecked = 0;

  function style() {
    if (document.getElementById('panthorium-access-style')) return;
    const el = document.createElement('style');
    el.id = 'panthorium-access-style';
    el.textContent = `
      #start-menu .browser-action{display:block;width:calc(100% - 24px);margin:0 12px 12px;padding:12px 10px;border:1px solid rgba(0,255,204,.22);border-radius:10px;background:rgba(0,255,204,.06);color:inherit;font:inherit;text-align:center;cursor:pointer;text-decoration:none;box-sizing:border-box;}
      #start-menu .browser-action:disabled{cursor:default;opacity:.7;}
      body[data-panthorium-role="guest"] #btn-settings-quick,body[data-panthorium-role="guest"] #btn-restart{display:none!important;}
      body[data-panthorium-role="guest"][data-panthorium-browser="desktop"] #sm-apps{display:none!important;}
      #start-menu .sm-footer{display:flex;gap:8px;}
      #start-menu .sm-footer button{flex:1;min-height:38px;}
    `;
    el.textContent += restrictedLaunchers.map(id => 'body[data-panthorium-role="guest"] #' + id).concat('body[data-panthorium-role="guest"] [data-production-intelligence="1"]').join(',') + '{display:none!important;}';
    document.head.appendChild(el);
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
    button.textContent = installing ? 'กำลังเตรียมอัปเดตบราวเซอร์' : checking && !updateStatus ? 'กำลังตรวจสอบเวอร์ชั่น' : !updateStatus?.ok ? 'ตรวจสอบอัปเดตอีกครั้ง' : updateStatus.available ? 'โปรดอัพเดทบราวเซอร์' : 'บราวเซอร์เป็นเวอร์ชั่นปัจจุบัน';
    button.dataset.state = installing ? 'installing' : !updateStatus?.ok ? 'unknown' : updateStatus.available ? 'available' : 'current';
    button.title = updateStatus?.current ? 'เวอร์ชั่นที่ติดตั้ง ' + updateStatus.current + (updateStatus.remote ? ' · รุ่นที่เผยแพร่ ' + updateStatus.remote : '') : '';
  }
  async function refreshUpdateStatus(force = false) {
    if (!electron()) return;
    if (checking) return checking;
    if (!force && lastChecked && Date.now() - lastChecked < 60000) return updateStatus;
    checking = (async () => {
      try {
        const result = desktop()?.getUpdateStatus ? await desktop().getUpdateStatus() : await legacyStatus();
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
    const status = await refreshUpdateStatus(true);
    if (!status?.ok || !status.available) return;
    if (!desktop()?.checkForUpdates) {
      window.open('/browser-download.html' + (admin() ? '?edition=admin' : ''), '_blank', 'noopener');
      return;
    }
    installing = true;
    renderUpdateStatus();
    try {
      const result = await desktop().checkForUpdates();
      if (!result?.ok) updateStatus = { ok: false };
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
          else node.remove();
        }
      }
    }
  }
  function sync() {
    const menu = document.getElementById('start-menu');
    if (!menu) return;
    style();
    const isGuest = guest(), isDesktop = electron();
    document.body.dataset.panthoriumRole = isGuest ? 'guest' : admin() ? 'admin' : 'user';
    document.body.dataset.panthoriumBrowser = isDesktop ? 'desktop' : 'web';
    restrictedLaunchers.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = isGuest ? 'none' : ''; });
    menu.querySelectorAll('#sm-apps > *').forEach(el => { if (restrictedLabels.test(el.textContent || '')) el.style.display = isGuest ? 'none' : ''; });
    const settings = document.getElementById('btn-settings-quick');
    if (settings) settings.style.display = isGuest || admin() ? 'none' : '';
    const footer = menu.querySelector('.sm-footer');
    const logout = document.getElementById('btn-logout');
    let login = document.getElementById('btn-login');
    if (isGuest && isDesktop && footer) {
      if (!login) { login = document.createElement('button'); login.id = 'btn-login'; login.type = 'button'; footer.prepend(login); }
      login.textContent = 'เข้าสู่ระบบ';
      login.onclick = () => { location.href = '/admin'; };
    } else login?.remove();
    if (logout) {
      logout.style.display = '';
      logout.textContent = isGuest && !isDesktop ? 'ดาวน์โหลด Panthorium Browser' : 'ออกจากระบบ';
      logout.title = logout.textContent;
      logout.onclick = isGuest && !isDesktop ? () => { location.href = '/browser-download.html'; } : () => auth()?.logout?.();
    }
    if (isDesktop) {
      // Inside the installed browser: only update controls — no installer hyperlink.
      document.getElementById('panthorium-browser-download')?.remove();
      let update = document.getElementById('panthorium-browser-update');
      if (!update) { update = document.createElement('button'); update.id = 'panthorium-browser-update'; update.type = 'button'; update.className = 'browser-action'; update.onclick = updateBrowser; menu.appendChild(update); }
      renderUpdateStatus();
      refreshUpdateStatus();
    } else {
      document.getElementById('panthorium-browser-update')?.remove();
      let download = document.getElementById('panthorium-browser-download');
      if (admin()) {
        if (!download) {
          download = document.createElement('a');
          download.id = 'panthorium-browser-download';
          download.className = 'browser-action';
          download.target = '_blank';
          download.rel = 'noopener';
          menu.appendChild(download);
        }
        download.textContent = 'ดาวน์โหลด Panthorium Browser Admin';
        download.href = '/browser-download.html?edition=admin';
      } else if (download) {
        download.remove();
      }
    }
    restrictWindows();
  }
  const scheduleSync = () => requestAnimationFrame(sync);
  for (const name of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:desktop-ready', 'panthorium:boot-complete', 'focus']) window.addEventListener(name, scheduleSync);
  document.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
  document.getElementById('start-btn')?.addEventListener('click', scheduleSync);
  scheduleSync();
  window.PanthoriumAccessShell = { sync, refreshUpdateStatus };
})();
