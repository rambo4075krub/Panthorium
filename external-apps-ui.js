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

  function open(appId) {
    const app = appFor(appId);
    const url = app && safeUrl(app);
    if (!app || !url || typeof createWindow !== 'function') return false;
    let root = document.querySelector(app.selector);
    if (root) { root.style.display = 'flex'; focus(app); return true; }
    const icon = icons[app.id] || '🌐';
    const html = `<div class="external-app-window" data-external-app="${escapeHTML(app.id)}" style="height:100%;display:flex;flex-direction:column;gap:10px;min-height:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto;"><span style="color:var(--text-dim);font-size:12px;">${icon} ${escapeHTML(app.label)} · เว็บภายนอก</span><button type="button" data-external-open-tab style="padding:6px 10px;border-radius:8px;">เปิดแท็บใหม่</button></div>
      <div data-external-status role="status" style="color:var(--text-dim);font-size:12px;">กำลังโหลด ${escapeHTML(app.label)}…</div>
      <iframe title="${escapeHTML(app.label)}" src="about:blank" loading="eager" referrerpolicy="no-referrer" sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts allow-same-origin" style="width:100%;height:100%;min-height:260px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#fff;"></iframe>
      <div style="color:var(--text-dim);font-size:11px;flex:0 0 auto;">บางเว็บไซต์ไม่อนุญาตให้ฝังในหน้าต่างอื่น หากไม่แสดง ให้กด “เปิดแท็บใหม่”</div>
    </div>`;
    createWindow(app.windowId, `${icon} ${app.label}`, html, { width: 860, height: 620 });
    root = document.querySelector(app.selector);
    if (!root) return false;
    const frame = root.querySelector('iframe');
    const status = root.querySelector('[data-external-status]');
    const openTab = root.querySelector('[data-external-open-tab]');
    if (!frame || !status || !openTab) return false;
    frame.addEventListener('load', () => { status.textContent = `${app.label} โหลดเสร็จแล้ว หากพื้นที่ว่างให้เปิดแท็บใหม่`; });
    frame.addEventListener('error', () => { status.textContent = `${app.label} ไม่อนุญาตให้ฝัง กดเปิดแท็บใหม่`; });
    openTab.onclick = () => window.open(url, '_blank', 'noopener,noreferrer');
    frame.src = url;
    focus(app);
    return true;
  }

  const api = { open, allowedHosts: [...allowedHosts] };
  for (const app of catalog.apps.filter(item => item.external)) {
    const name = app.id.replace(/^external-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    api[`open${name[0].toUpperCase()}${name.slice(1)}`] = () => open(app.id);
  }
  window.PanthoriumExternalApps = api;
})();
