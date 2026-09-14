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
    return true;
  }

  function launch(app, url) {
    if (electron) return true;
    const current = popups.get(app.id);
    if (current && !current.closed) { try { current.focus(); } catch (_) {} return true; }
    const popup = window.open(url, `panthorium-external-${app.id}`, 'popup=yes,width=980,height=720,resizable=yes,scrollbars=yes');
    if (!popup) return false;
    popups.set(app.id, popup);
    return true;
  }

  function shell(app, url) {
    const icon = icons[app.id] || '🌐';
    const content = electron
      ? `<webview data-external-webview src="${escapeHTML(url)}" partition="persist:panthorium-external" allowpopups style="width:100%;height:100%;border:0;background:#fff;"></webview>`
      : `<button type="button" data-external-open style="padding:10px 16px;border-radius:8px;font:inherit;">เปิดเว็บไซต์จริง</button>`;
    return `<div class="external-app-window" data-external-app="${escapeHTML(app.id)}" style="height:100%;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;"><span style="font-size:20px;">${icon}</span><strong>${escapeHTML(app.label)}</strong><span data-external-status role="status" style="margin-left:auto;color:var(--text-dim);font-size:12px;">${electron ? 'กำลังทำงานใน WebView' : 'กำลังเปิดเว็บไซต์จริง…'}</span></div>
      <div data-external-content style="min-height:0;flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;">${content}</div>
    </div>`;
  }

  function bindRoot(app, root, url) {
    const status = root.querySelector('[data-external-status]');
    if (!status) return false;
    const webview = root.querySelector('webview[data-external-webview]');
    if (electron) {
      if (!webview) return false;
      if (webview.dataset.bound !== '1') {
        webview.dataset.bound = '1';
        webview.addEventListener('did-start-loading', () => { status.textContent = `${app.label} กำลังโหลด`; });
        webview.addEventListener('did-stop-loading', () => { status.textContent = `${app.label} พร้อมใช้งาน`; });
        webview.addEventListener('did-fail-load', event => { if (event.errorCode !== -3) status.textContent = 'โหลดเว็บไซต์ไม่สำเร็จ'; });
      }
      if (webview.getAttribute('src') !== url) webview.setAttribute('src', url);
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
    if (!root) {
      createWindow(app.windowId, `${icons[app.id] || '🌐'} ${app.label}`, shell(app, url), { width: 520, height: 420 });
      root = document.querySelector(app.selector);
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
})();
