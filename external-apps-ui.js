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
    const current = popups.get(app.id);
    if (current && !current.closed) {
      try { current.focus(); } catch (_) {}
      return true;
    }
    const popup = window.open(
      url,
      `panthorium-external-${app.id}`,
      'popup=yes,width=980,height=720,resizable=yes,scrollbars=yes'
    );
    if (!popup) return false;
    popups.set(app.id, popup);
    return true;
  }

  function shell(app, url) {
    const icon = icons[app.id] || '🌐';
    return `<div class="external-app-window" data-external-app="${escapeHTML(app.id)}" style="height:100%;display:flex;flex-direction:column;gap:12px;justify-content:center;align-items:center;text-align:center;padding:24px;">
      <div style="font-size:42px;line-height:1;">${icon}</div>
      <h2 style="margin:0;">${escapeHTML(app.label)}</h2>
      <div data-external-status role="status" style="color:var(--text-dim);font-size:13px;">กำลังเปิดเว็บไซต์จริง…</div>
      <button type="button" data-external-open style="padding:10px 16px;border-radius:8px;font:inherit;">เปิดเว็บไซต์จริง</button>
      <div style="color:var(--text-dim);font-size:12px;max-width:520px;">เว็บไซต์จะเปิดในหน้าต่างเบราว์เซอร์จริงของ ${escapeHTML(app.label)} ไม่ได้ถูกฝังหรือคัดลอกเข้ามาใน Panthorium หากไม่เปิด ให้กดปุ่มอีกครั้งหรืออนุญาต popup ของเว็บไซต์นี้</div>
      <div style="color:var(--text-dim);font-size:11px;word-break:break-all;">${escapeHTML(url)}</div>
    </div>`;
  }

  function bindRoot(app, root, url) {
    const status = root.querySelector('[data-external-status]');
    const openButton = root.querySelector('[data-external-open]');
    if (!status || !openButton) return false;
    const tryLaunch = () => {
      if (launch(app, url)) {
        status.textContent = `${app.label} เปิดอยู่ในหน้าต่างเบราว์เซอร์จริง`;
        return true;
      }
      status.textContent = 'เบราว์เซอร์บล็อก popup ให้กด “เปิดเว็บไซต์จริง” อีกครั้งหรืออนุญาต popup';
      return false;
    };
    openButton.onclick = tryLaunch;
    const closeButton = root.querySelector('.win-btn.close');
    if (closeButton && closeButton.dataset.externalCloseBound !== '1') {
      closeButton.dataset.externalCloseBound = '1';
      closeButton.addEventListener('click', () => close(app.id));
    }
    root.dataset.externalBound = '1';
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

  const api = { open, close, allowedHosts: [...allowedHosts] };
  for (const app of catalog.apps.filter(item => item.external)) {
    const name = app.id.replace(/^external-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    api[`open${name[0].toUpperCase()}${name.slice(1)}`] = () => open(app.id);
  }
  window.PanthoriumExternalApps = api;
})();
