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

  function shouldOpenFullscreen(app, options = {}) {
    return app.id !== 'calculator'
      && app.fullscreenOnOpen !== false
      && options.fullscreenOnOpen !== false;
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
    root.querySelectorAll('[data-fullscreen], [data-maximize], [data-panthorium-window-action="fullscreen"], .win-btn.max')
      .forEach(button => button.remove());
    const alreadyHasMinimize = root.querySelector('[data-minimize], [data-panthorium-window-action="minimize"]');
    if (!alreadyHasMinimize) {
      const button = makeControl('minimize', 'ย่อไปไว้ใน Start Menu', '−', () => manager.minimize(app.id));
      if (closeButton) parent.insertBefore(button, closeButton);
      else parent.appendChild(button);
    }
  }

  function register(app, root) {
    if (!root || !root.isConnected || (root.classList.contains('window') && root.dataset.id)) return;
    const fullscreenOnOpen = shouldOpenFullscreen(app);
    const current = manager.findByAppId(app.id);
    if (current?.el !== root) {
      manager.registerExternalWindow(app.id, app.label || app.id, root, {
        menuAppId: app.id,
        fullscreenOnOpen
      });
    }
    if (fullscreenOnOpen) manager.setFullscreen?.(app.id, true);
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
    const fullscreenOnOpen = shouldOpenFullscreen(app, options);
    const record = manager.registerExternalWindow(id, title || app.label || id, root, {
      menuAppId: options.menuAppId || id,
      fullscreenOnOpen
    });
    if (!record || options.controls === false) return record;
    if (fullscreenOnOpen) manager.setFullscreen?.(id, true);
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
