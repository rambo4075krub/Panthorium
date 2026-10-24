(function () {
  'use strict';
  const catalog = window.PanthoriumWindowCatalog;
  if (!catalog) return;

  // Fixed allowlist: never turn an AI answer or raw transcript into a URL.
  const allowedHosts = new Set([
    'www.youtube.com', 'www.facebook.com', 'line.me', 'www.tiktok.com',
    'www.instagram.com', 'x.com'
  ]);
  const icons = {
    'external-youtube': '▶️', 'external-facebook': '📘', 'external-line': '💬',
    'external-tiktok': '🎵', 'external-instagram': '📷', 'external-x': '𝕏'
  };
  const popups = new Map();
  const electron = !!window.panthoriumDesktop?.isElectron;
  const owner = () => String((typeof OS !== 'undefined' && (OS.state?.user?.sub || OS.state?.user?.id)) || '');
  const appFor = id => catalog.apps.find(app => app.id === id && app.external);
  const safeUrl = app => {
    try {
      const url = new URL(app.externalUrl);
      return url.protocol === 'https:' && allowedHosts.has(url.hostname) ? url.href : null;
    } catch (_) { return null; }
  };
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function focus(app) {
    if (typeof focusWindow === 'function') focusWindow(app.windowId);
    document.querySelector(app.selector)?.focus({ preventScroll: true });
  }

  function close(appId) {
    const popup = popups.get(appId);
    if (popup && !popup.closed) {
      try { popup.close(); } catch (_) {}
    }
    popups.delete(appId);
    const app = appFor(appId);
    const root = app && document.querySelector(app.selector);
    root?.querySelectorAll('webview').forEach(view => view.remove());
    if (root && typeof closeWindow === 'function') closeWindow(app.windowId);
    else root?.remove();
    return true;
  }

  function launch(app, url) {
    if (electron) return true;
    const current = popups.get(app.id);
    if (current && !current.closed) { try { current.focus(); } catch (_) {} return true; }
    const popup = window.open(url, `panthorium-external-${app.id}`, 'popup=yes,width=980,height=720,resizable=yes,scrollbars=yes');
    if (!popup) return false;
    try { popup.opener = null; } catch (_) {}
    popups.set(app.id, popup);
    return true;
  }

  function shell(app, url) {
    const icon = icons[app.id] || '🌐';
    const content = electron
      ? '<div data-external-mount style="width:100%;height:100%;display:flex">กำลังเตรียมพื้นที่เว็บไซต์…</div>'
      : `<button type="button" data-external-open style="padding:10px 16px;border-radius:8px;font:inherit;">เปิดเว็บไซต์จริง</button>`;
    return `<div class="external-app-window" data-external-app="${escapeHTML(app.id)}" style="height:100%;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;"><span style="font-size:20px;">${icon}</span><strong>${escapeHTML(app.label)}</strong><span data-external-status role="status" style="margin-left:auto;color:var(--text-dim);font-size:12px;">${electron ? 'กำลังทำงานใน WebView' : 'กำลังเปิดเว็บไซต์จริง…'}</span></div>
      <div data-external-content style="min-height:0;flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;">${content}</div>
    </div>`;
  }

  function bindRoot(app, root, url) {
    const status = root.querySelector('[data-external-status]');
    if (!status) return false;
    if (electron) {
      if (root.dataset.externalPreparing === '1' || root.querySelector('webview[data-external-webview]')) return true;
      const accountId = owner(), prepare = window.panthoriumDesktop.setBrowserAccount;
      if (!accountId || typeof prepare !== 'function') { status.textContent = 'กรุณาอัปเดต Panthorium Browser เพื่อเปิดเว็บอย่างปลอดภัย'; return false; }
      root.dataset.externalPreparing = '1';
      prepare(accountId).then(result => {
        if (!root.isConnected || owner() !== accountId) return;
        if (!result?.ok || !/^persist:panthorium-external-v2-[a-f0-9]{64}$/.test(result.partitions?.external || '')) throw Error('browser_session_unavailable');
        const webview = document.createElement('webview');
        webview.dataset.externalWebview = '';
        webview.setAttribute('partition', result.partitions.external);
        // Native popup policy enforces the same isolated session and sandbox.
        webview.setAttribute('allowpopups', '');
        webview.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,nodeIntegration=no,webSecurity=yes');
        webview.style.cssText = 'width:100%;height:100%;border:0;background:#fff';
        webview.addEventListener('did-start-loading', () => { status.textContent = `${app.label} กำลังโหลด`; });
        webview.addEventListener('did-stop-loading', () => { status.textContent = `${app.label} พร้อมใช้งาน`; });
        webview.addEventListener('did-fail-load', event => { if (event.errorCode !== -3) status.textContent = 'โหลดเว็บไซต์ไม่สำเร็จ'; });
        webview.setAttribute('src', url);
        root.querySelector('[data-external-mount]').replaceChildren(webview);
      }).catch(() => { if (root.isConnected) status.textContent = 'เตรียมพื้นที่เว็บไซต์ไม่สำเร็จ กรุณาลองเปิดใหม่'; })
        .finally(() => { delete root.dataset.externalPreparing; });
      return true;
    }
    const openButton = root.querySelector('[data-external-open]');
    if (!openButton) return false;
    const tryLaunch = () => {
      if (launch(app, url)) { status.textContent = `${app.label} เปิดอยู่ในหน้าต่างเบราว์เซอร์จริง`; return true; }
      status.textContent = 'เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup';
      return false;
    };
    openButton.onclick = tryLaunch;
    return tryLaunch();
  }

  function open(appId) {
    const app = appFor(appId);
    const url = app && safeUrl(app);
    if (!app || !url || typeof createWindow !== 'function') return false;
    let root = document.querySelector(app.selector);
    if (root && root.dataset.externalOwner !== owner()) { close(app.id); root = null; }
    if (!root) {
      createWindow(app.windowId, `${icons[app.id] || '🌐'} ${app.label}`, shell(app, url), { width: 520, height: 420 });
      root = document.querySelector(app.selector);
      if (root) root.dataset.externalOwner = owner();
    }
    if (!root) return false;
    focus(app);
    return bindRoot(app, root, url);
  }

  const api = { open, close, allowedHosts: [...allowedHosts], electron };
  for (const app of catalog.apps.filter(item => item.external)) {
    const name = app.id.replace(/^external-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    api[`open${name[0].toUpperCase()}${name.slice(1)}`] = () => open(app.id);
  }
  window.PanthoriumExternalApps = api;
  let previousOwner = owner();
  window.addEventListener('panthorium:auth-changed', () => {
    for (const app of catalog.apps.filter(item => item.external)) {
      const root = document.querySelector(app.selector);
      if (root && root.dataset.externalOwner !== owner()) close(app.id);
    }
    if (previousOwner !== owner()) for (const appId of [...popups.keys()]) close(appId);
    previousOwner = owner();
    if (electron && typeof window.panthoriumDesktop.setBrowserAccount === 'function') {
      window.panthoriumDesktop.setBrowserAccount(owner()).catch(() => {});
    }
  });
})();
