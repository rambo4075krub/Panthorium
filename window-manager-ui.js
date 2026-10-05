(function () {
  'use strict';

  const manager = window.PanthoriumWindowManager;
  if (!manager) return;
  const managed = new Map();
  let scanQueued = false;

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    Promise.resolve().then(() => {
      scanQueued = false;
      scan();
    });
  }

  function closeAfterAppHandler(id, root) {
    window.setTimeout(() => {
      const entry = manager.findByAppId(id);
      if (entry?.el === root) manager.close(id);
    }, 0);
  }

  function bindClose(app, root) {
    if (root.dataset.panthoriumCloseBound === 'true' || !app.closeButton) return;
    let closeButton;
    try { closeButton = root.querySelector(app.closeButton); } catch (_) { return; }
    if (!closeButton) return;
    root.dataset.panthoriumCloseBound = 'true';
    closeButton.addEventListener('click', () => closeAfterAppHandler(app.id, root), true);
  }

  function makeControl(action, label, glyph, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panthorium-window-control';
    button.dataset.panthoriumWindowAction = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = glyph;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handler(button);
    });
    return button;
  }

  function bindControls(app, root) {
    const closeButton = app.closeButton ? root.querySelector(app.closeButton) : null;
    const parent = closeButton?.parentElement || root.firstElementChild;
    if (!parent) return;
    const alreadyHasMinimize = root.querySelector('[data-minimize], [data-panthorium-window-action="minimize"]');
    const alreadyHasFullscreen = root.querySelector('[data-fullscreen], [data-panthorium-window-action="fullscreen"]');
    if (!alreadyHasMinimize) {
      const button = makeControl('minimize', 'ย่อไปไว้ใน Start Menu', '−', () => manager.minimize(app.id));
      if (closeButton) parent.insertBefore(button, closeButton);
      else parent.appendChild(button);
    }
    if (!alreadyHasFullscreen) {
      const button = makeControl('fullscreen', 'คืนขนาดหน้าต่าง', '⛶', control => {
        manager.toggleFullscreen(app.id);
        const active = Boolean(manager.findByAppId(app.id)?.fullscreen);
        control.textContent = active ? '⤢' : '⛶';
        control.title = active ? 'คืนขนาดหน้าต่าง' : 'เต็มจอ';
        control.setAttribute('aria-label', control.title);
      });
      if (closeButton) parent.insertBefore(button, closeButton);
      else parent.appendChild(button);
    }
  }

  function register(app, root) {
    if (!root || !root.isConnected || (root.classList.contains('window') && root.dataset.id)) return;
    const current = manager.findByAppId(app.id);
    if (current?.el !== root) {
      manager.registerExternalWindow(app.id, app.label || app.id, root, {
        menuAppId: app.id,
        fullscreenOnOpen: manager.preferences?.fullscreenOnOpen
      });
    }
    root.dataset.panthoriumManagedWindow = app.id;
    bindControls(app, root);
    bindClose(app, root);
    managed.set(app.id, root);
  }

  function scan() {
    const apps = window.PanthoriumWindowCatalog?.apps || [];
    apps.forEach(app => {
      if (!app.selector) return;
      let root;
      try { root = document.querySelector(app.selector); } catch (_) { return; }
      if (root) register(app, root);
    });
    for (const [id, root] of managed) {
      if (root.isConnected) continue;
      managed.delete(id);
      const current = manager.findByAppId(id);
      if (current?.el === root) manager.close(id);
    }
  }

  manager.registerExternal = (id, title, root, options = {}) => {
    const app = (window.PanthoriumWindowCatalog?.apps || []).find(entry => entry.id === id) || {
      id, label: title, selector: null, closeButton: null
    };
    const record = manager.registerExternalWindow(id, title || app.label || id, root, {
      menuAppId: options.menuAppId || id,
      fullscreenOnOpen: options.fullscreenOnOpen
    });
    if (!record || options.controls === false) return record;
    root.dataset.panthoriumManagedWindow = id;
    bindControls(app, root);
    bindClose(app, root);
    managed.set(id, root);
    return record;
  };
  manager.scan = scan;

  if (window.MutationObserver && document.body) {
    const observer = new MutationObserver(queueScan);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener('panthorium:apps-changed', queueScan);
  window.addEventListener('panthorium:desktop-ready', queueScan);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueScan, { once: true });
  else queueScan();
})();
