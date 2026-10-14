/**
 * Panthorium OS — Base Window System
 * Unified create / manage / focus / minimize / maximize / close
 * for all current and future windows.
 *
 * Usage:
 *   const win = PanthoriumWindow.create({
 *     id: 'sentinel',
 *     title: 'Sentinel AI',
 *     icon: '🛡️',                 // or HTML / img src
 *     content: htmlString,         // or HTMLElement
 *     sidebar: htmlString,         // optional
 *     width: 960,
 *     height: 640,
 *     fullscreenOnOpen: true,
 *     onClose: () => {}
 *   });
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    width: 920,
    height: 620,
    minWidth: 300,
    minHeight: 220,
    fullscreenOnOpen: true,
    animate: true,
    className: ''
  };

  let shell = null;

  // Shared state (compatible with existing OS.windows if present)
  function getStore() {
    if (shell) return shell.windows;
    if (global.OS && global.OS.windows instanceof Map) return global.OS.windows;
    if (!global.__panthoriumWindows) global.__panthoriumWindows = new Map();
    return global.__panthoriumWindows;
  }

  function getZ() {
    if (shell) return ++shell.zCounter;
    if (global.OS) {
      global.OS.zCounter = (global.OS.zCounter || 100) + 1;
      return global.OS.zCounter;
    }
    global.__panthoriumZ = (global.__panthoriumZ || 10030) + 1;
    return global.__panthoriumZ;
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function createTitlebar(title, icon) {
    const bar = document.createElement('div');
    bar.className = 'window-titlebar';

    const titleEl = document.createElement('div');
    titleEl.className = 'window-title';

    if (icon) {
      const ico = document.createElement('span');
      ico.className = 'window-icon';
      if (typeof icon === 'string' && (icon.startsWith('<') || icon.startsWith('http') || icon.startsWith('/'))) {
        ico.innerHTML = icon.startsWith('<') ? icon : `<img src="${icon}" alt="">`;
      } else {
        ico.textContent = icon;
      }
      titleEl.appendChild(ico);
    }

    const name = document.createElement('span');
    name.className = 'window-name';
    name.textContent = title || 'Window';
    titleEl.appendChild(name);

    const controls = document.createElement('div');
    controls.className = 'window-controls';
    controls.innerHTML = `
      <button type="button" class="win-btn close" title="ปิด" aria-label="ปิด"></button>
      <button type="button" class="win-btn min" title="ย่อ" aria-label="ย่อ"></button>
      <button type="button" class="win-btn max" title="ขยาย / คืนขนาด" aria-label="ขยาย"></button>
    `;

    bar.appendChild(titleEl);
    bar.appendChild(controls);
    return bar;
  }

  function bindDrag(winEl, titlebar) {
    let dragging = false;
    let ox = 0, oy = 0;

    titlebar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win-btn')) return;
      if (['maximized', 'panthorium-window-fullscreen', 'pw-maximized-workspace'].some(name => winEl.classList.contains(name))) return;
      dragging = true;
      ox = e.clientX - winEl.offsetLeft;
      oy = e.clientY - winEl.offsetTop;
      titlebar.setPointerCapture(e.pointerId);
      focus(winEl.dataset.id);
    });

    titlebar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      winEl.style.left = (e.clientX - ox) + 'px';
      winEl.style.top = Math.max(0, e.clientY - oy) + 'px';
    });

    titlebar.addEventListener('pointerup', () => { dragging = false; });
    titlebar.addEventListener('pointercancel', () => { dragging = false; });
  }

  function bindResize(winEl) {
    const handle = document.createElement('div');
    handle.className = 'window-resize';
    winEl.appendChild(handle);

    let resizing = false;
    let startX, startY, startW, startH;

    handle.addEventListener('pointerdown', (e) => {
      if (['maximized', 'panthorium-window-fullscreen', 'pw-maximized-workspace'].some(name => winEl.classList.contains(name))) return;
      e.preventDefault();
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = winEl.offsetWidth;
      startH = winEl.offsetHeight;
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const w = Math.max(DEFAULTS.minWidth, startW + (e.clientX - startX));
      const h = Math.max(DEFAULTS.minHeight, startH + (e.clientY - startY));
      winEl.style.width = w + 'px';
      winEl.style.height = h + 'px';
    });

    handle.addEventListener('pointerup', () => { resizing = false; });
    handle.addEventListener('pointercancel', () => { resizing = false; });
  }

  function focus(id) {
    const store = getStore();
    const rec = store.get(id);
    if (!rec || !rec.el) return;

    store.forEach((r) => {
      if (r.el) r.el.classList.remove('is-focused');
    });
    rec.el.classList.add('is-focused');
    rec.el.style.zIndex = String(getZ());
    rec.el.style.display = rec.displayMode || 'flex';
    rec.minimized = false;
    rec.el.classList.remove('is-minimized');

    // Notify existing taskbar if present
    if (typeof global.updateTaskbar === 'function') {
      try { global.updateTaskbar(); } catch (_) {}
    }
  }

  function minimize(id) {
    const store = getStore();
    const rec = store.get(id);
    if (!rec || !rec.el) return;
    rec.minimized = true;
    rec.el.classList.add('is-minimized');
    rec.el.style.display = 'none';
    if (typeof global.updateTaskbar === 'function') {
      try { global.updateTaskbar(); } catch (_) {}
    }
  }

  function setMode(id, mode) {
    const rec = getStore().get(id);
    if (!rec?.el || !['normal', 'maximized', 'fullscreen'].includes(mode)) return false;
    const el = rec.el;
    if (rec._normalStyle === undefined) rec._normalStyle = el.dataset.panthoriumWindowedStyle ?? el.getAttribute('style') ?? '';
    el.classList.remove('maximized', 'panthorium-window-fullscreen', 'pw-maximized-workspace');
    if (mode === 'normal') el.setAttribute('style', rec._normalStyle);
    if (mode === 'maximized') el.classList.add('pw-maximized-workspace');
    if (mode === 'fullscreen') el.classList.add(rec.external ? 'panthorium-window-fullscreen' : 'maximized');
    rec.windowMode = mode;
    rec.fullscreen = mode === 'fullscreen';
    rec.maximized = mode === 'maximized';
    focus(id);
    return true;
  }

  function toggleMaximize(id) {
    const rec = getStore().get(id);
    if (!rec?.el) return;
    const expanded = ['maximized', 'panthorium-window-fullscreen', 'pw-maximized-workspace'].some(name => rec.el.classList.contains(name));
    return setMode(id, expanded ? 'normal' : 'maximized');
  }

  function close(id) {
    const store = getStore();
    const rec = store.get(id);
    if (!rec) return;

    if (typeof rec.onClose === 'function') {
      try { rec.onClose(); } catch (_) {}
    }

    if (rec.el && rec.el.parentNode) {
      rec.el.parentNode.removeChild(rec.el);
    }
    store.delete(id);

    if (typeof global.updateTaskbar === 'function') {
      try { global.updateTaskbar(); } catch (_) {}
    }
  }

  /**
   * Create a new unified window.
   * @param {Object} opts
   * @returns {HTMLElement} the window root element
   */
  function create(opts = {}) {
    const id = String(opts.id || ('win-' + Date.now()));
    const store = getStore();

    // If already open → focus
    if (store.has(id)) {
      focus(id);
      return store.get(id).el;
    }

    const title = opts.title || 'Window';
    const icon = opts.icon || null;
    const fullscreenOnOpen = opts.fullscreenOnOpen !== undefined
      ? opts.fullscreenOnOpen
      : (id !== 'calculator' && DEFAULTS.fullscreenOnOpen);

    const width = opts.width || Math.min(DEFAULTS.width, window.innerWidth - 40);
    const height = opts.height || Math.min(DEFAULTS.height, window.innerHeight - 80);
    const left = opts.left ?? Math.max(20, (window.innerWidth - width) / 2 + (store.size * 22) % 80);
    const top = opts.top ?? Math.max(20, 48 + (store.size * 22) % 60);

    const win = document.createElement('div');
    win.className = 'panthorium-window window' + (opts.className ? ' ' + opts.className : '');
    win.dataset.id = id;
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', title);
    win.tabIndex = -1;

    if (fullscreenOnOpen) win.classList.add('maximized');
    if (opts.animate !== false) win.classList.add('pw-animate-in');

    win.style.width = width + 'px';
    win.style.height = height + 'px';
    win.style.left = left + 'px';
    win.style.top = top + 'px';
    win.style.zIndex = String(getZ());
    win.style.display = 'flex';

    // Titlebar
    const titlebar = createTitlebar(title, icon);
    win.appendChild(titlebar);

    // Body
    const body = document.createElement('div');
    body.className = 'window-body';

    if (opts.sidebar) {
      const side = document.createElement('aside');
      side.className = 'window-sidebar';
      if (typeof opts.sidebar === 'string') side.innerHTML = opts.sidebar;
      else if (opts.sidebar instanceof HTMLElement) side.appendChild(opts.sidebar);
      body.appendChild(side);
    }

    const content = document.createElement('main');
    content.className = 'window-content';
    const inner = document.createElement('div');
    inner.className = 'window-content-inner';
    if (opts.legacyContent) inner.classList.add('pw-legacy-content');

    if (typeof opts.content === 'string') {
      inner.innerHTML = opts.content;
    } else if (opts.content instanceof HTMLElement) {
      inner.appendChild(opts.content);
    } else if (opts.contentHTML) {
      inner.innerHTML = opts.contentHTML;
    }

    content.appendChild(inner);
    body.appendChild(content);
    win.appendChild(body);

    // Resize handle (only when not maximized)
    bindResize(win);
    bindDrag(win, titlebar);

    // Controls
    titlebar.querySelector('.win-btn.close').addEventListener('click', (e) => {
      e.stopPropagation();
      close(id);
    });
    titlebar.querySelector('.win-btn.min').addEventListener('click', (e) => {
      e.stopPropagation();
      minimize(id);
    });
    titlebar.querySelector('.win-btn.max').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMaximize(id);
    });

    // Double-click titlebar to toggle maximize
    titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.win-btn')) return;
      toggleMaximize(id);
    });

    // Focus on pointer down
    win.addEventListener('pointerdown', () => focus(id));

    // Mount
    const container = document.getElementById('windows') || document.getElementById('desktop') || document.body;
    container.appendChild(win);

    const record = {
      el: win,
      title,
      menuAppId: opts.menuAppId || id,
      minimized: false,
      external: false,
      fullscreen: fullscreenOnOpen,
      displayMode: 'flex',
      onClose: opts.onClose || null
    };
    store.set(id, record);

    if (typeof global.updateTaskbar === 'function') {
      try { global.updateTaskbar(); } catch (_) {}
    }

    // Focus after paint
    requestAnimationFrame(() => {
      if (!win.isConnected || store.get(id)?.minimized) return;
      focus(id);
      try { win.focus(); } catch (_) {}
    });

    return win;
  }

  /**
   * Wrap an existing DOM element as a managed window
   * (for legacy dashboards that create their own root)
   */
  function registerExternal(id, title, element, opts = {}) {
    if (!element) return null;
    const store = getStore();

    if (store.has(id) && store.get(id).el !== element) {
      close(id);
    }

    element.classList.add('panthorium-window', 'panthorium-managed-window');
    element.dataset.id = id;

    if (store.get(id)?.el === element && element.querySelector(':scope > .window-titlebar')) return store.get(id);
    const previous = store.get(id);
    const fullscreen = opts.fullscreenOnOpen !== false && id !== 'calculator';
    if (fullscreen) {
      element.classList.add('panthorium-window-fullscreen');
    }

    // Ensure titlebar exists
    let titlebar = element.querySelector(':scope > .window-titlebar');
    if (!titlebar) {
      titlebar = createTitlebar(title, opts.icon);
      element.insertBefore(titlebar, element.firstChild);
      bindDrag(element, titlebar);

      titlebar.querySelector('.win-btn.close').addEventListener('click', (e) => {
        e.stopPropagation();
        if (opts.closeButton && element.querySelector(opts.closeButton)) {
          element.querySelector(opts.closeButton).click();
        } else {
          close(id);
        }
      });
      titlebar.querySelector('.win-btn.min').addEventListener('click', (e) => {
        e.stopPropagation();
        minimize(id);
      });
      titlebar.querySelector('.win-btn.max').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMaximize(id);
      });
    }

    element.style.zIndex = String(getZ());
    element.style.display = opts.displayMode || previous?.displayMode || 'flex';

    const record = {
      el: element,
      title,
      menuAppId: opts.menuAppId || id,
      minimized: false,
      external: true,
      fullscreen,
      displayMode: opts.displayMode || previous?.displayMode || 'flex',
      onClose: opts.onClose || null
    };
    store.set(id, record);

    element.addEventListener('pointerdown', () => focus(id));

    if (typeof global.updateTaskbar === 'function') {
      try { global.updateTaskbar(); } catch (_) {}
    }
    return record;
  }

  // Public API
  const API = {
    create,
    registerExternal,
    focus,
    minimize,
    toggleMaximize,
    setMode,
    close,
    get: (id) => getStore().get(id),
    has: (id) => getStore().has(id),
    all: () => getStore()
  };

  API.connectShell = function (state, manager) {
    shell = state;
    const register = manager.registerExternalWindow;
    manager.create = create;
    manager.setMode = setMode;
    manager.registerExternalWindow = function (id, title, element, options = {}) {
      const record = register(id, title, element, options);
      const app = global.PanthoriumWindowCatalog?.apps?.find(app => app.id === id);
      registerExternal(id, title, element, {
        ...options, fullscreenOnOpen: record?.fullscreen,
        displayMode: record?.displayMode, closeButton: app?.closeButton
      });
      return getStore().get(id);
    };
  };
  global.PanthoriumWindow = API;

})(typeof window !== 'undefined' ? window : globalThis);
