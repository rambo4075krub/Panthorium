/* Shared reference workspace, permission-aware navigation and OS-style keyboard controls.
 * Application DOM nodes are moved, never cloned: live forms, handlers and sessions survive.
 */
(function () {
  'use strict';
  if (window.PanthoriumWorkspace) return;
  const api = () => window.PanthoriumWindow;
  const catalog = () => window.PanthoriumWindowCatalog;
  const user = () => typeof OS !== 'undefined' ? OS.state?.user : null;
  const icons = {
    logo: '<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5M12 12v10M7 5l10 6v5"/>',
    chat: '<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 10h8M7 14h5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z"/>',
    book: '<path d="M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2v16"/>',
    auto: '<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6 3 3M6 18l3-3m6-6 3-3"/><circle cx="12" cy="12" r="4"/>',
    settings: '<path d="m9 3-.5 3-2 1-3-.5-1 3 2.5 2v2L2.5 16l2 2.5 3-1 2 1 .5 3h4l.5-3 2-1 3 1 2-2.5-2.5-2.5v-2l2.5-2-1-3-3 .5-2-1-.5-3Z"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    send: '<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    keys: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 13h1m4 0h1m4 0h1M7 16h10"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
  const node = (tag, className, text) => {
    const el = document.createElement(tag); el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function availableApps() {
    return (catalog()?.apps || []).filter(app => app.opener && catalog().allowed(app, user()));
  }
  function launch(id) {
    const app = availableApps().find(item => item.id === id);
    if (!app) return false;
    const existing = window.PanthoriumWindowManager?.findByAppId?.(id);
    if (existing) { api()?.focus(existing.id || existing.el.dataset.id); return true; }
    // Resolve only the catalog's fixed allowlist. Recheck permissions on every launch.
    const parts = app.opener.split('.');
    let owner = window;
    for (const part of parts.slice(0, -1)) owner = owner?.[part];
    const fn = owner?.[parts.at(-1)];
    if (typeof fn !== 'function') return false;
    fn.call(owner); return true;
  }
  const navigation = [
    { label: 'แชท', icon: 'chat', ids: ['sentinel'] },
    { label: 'พื้นที่ทำงาน', icon: 'grid', ids: ['files', 'notes', 'calendar', 'reminders', 'goals'] },
    { label: 'สร้างสรรค์', icon: 'spark', ids: ['media-studio', 'developer-studio'] },
    { label: 'คลังความรู้', icon: 'book', ids: ['memory-knowledge'] },
    { label: 'ระบบอัตโนมัติ', icon: 'auto', ids: ['agent-automation', 'sentinel-agent'] },
    { label: 'ตั้งค่า', icon: 'settings', ids: ['settings', 'assistant-preferences', 'voice-identity'] }
  ];
  function sidebar(root) {
    const side = node('nav', 'pt-sidebar'); side.setAttribute('aria-label', 'เมนูพื้นที่ทำงาน');
    side.append(node('div', 'pt-section-label', 'YOUR UNIVERSE'));
    const allowed = new Set(availableApps().map(app => app.id));
    for (const item of navigation) {
      const targets = item.ids.filter(id => allowed.has(id));
      if (!targets.length) continue;
      const current = item.ids.includes(root.dataset.id);
      const button = node('button', 'pt-nav' + (current ? ' active' : ''));
      button.type = 'button'; button.title = item.label;
      button.innerHTML = icon(item.icon); button.append(node('span', '', item.label));
      if (current) button.setAttribute('aria-current', 'page');
      button.onclick = () => targets.length === 1 ? launch(targets[0]) : openPalette('', targets);
      side.append(button);
    }
    const all = node('button', 'pt-nav'); all.type = 'button'; all.title = 'ค้นหาแอป · Alt+Shift+K';
    all.innerHTML = icon('search'); all.append(node('span', '', 'แอปทั้งหมด'));
    all.onclick = () => openPalette(); side.append(all);
    const bottom = node('div', 'pt-sidebar-bottom');
    bottom.innerHTML = '<div class="pt-sidebar-card"><strong>พื้นที่สำหรับทุกความคิด</strong><small>Imagine. Create. Make it happen.</small><svg class="pt-mini-wave" viewBox="0 0 160 40" aria-hidden="true"><path d="M0 29Q20 28 35 19T65 25T95 15T125 23T160 12M0 32Q25 12 45 25T90 23T130 15T160 24"/></svg><small>Panthorium OS</small></div><div class="pt-profile"><div class="pt-avatar">P</div><div><strong>Personal workspace</strong><small>PANTHORIUM OS</small></div></div>';
    side.append(bottom); return side;
  }
  function apply(root) {
    if (!root?.isConnected || root.querySelector(':scope > .pt-workspace')) return;
    const bar = root.querySelector(':scope > .window-titlebar');
    // The base manager owns controls, close hooks and registrations.
    if (!bar) return;
    root.classList.add('pt-shell');
    const name = bar.querySelector('.window-name');
    const title = name?.textContent || root.getAttribute('aria-label') || 'Workspace';
    if (name) {
      const brand = node('div', 'pt-brand'); brand.innerHTML = icon('logo');
      const text = node('div', ''); text.append(node('strong', '', 'Panthorium'), node('small', '', title.toUpperCase()));
      brand.append(text); name.parentElement.replaceWith(brand);
    }
    const controls = bar.querySelector('.window-controls');
    if (controls) {
      controls.classList.add('pt-window-tools');
      const search = node('button', 'pt-title-search'); search.type = 'button'; search.innerHTML = icon('search');
      search.title = 'ค้นหาแอป · Alt+Shift+K'; search.setAttribute('aria-label', search.title); search.onclick = () => openPalette();
      const meta = node('span', 'pt-title-meta'); meta.innerHTML = '<i class="pt-pill-dot"></i> PERSONAL WORKSPACE';
      controls.prepend(meta, search);
    }
    let body = root.querySelector(':scope > .window-body');
    let main, inner;
    if (body) {
      main = body.querySelector(':scope > .window-content');
      inner = main?.querySelector(':scope > .window-content-inner');
    } else {
      body = node('div', 'window-body'); main = node('main', 'window-content');
      inner = node('div', 'window-content-inner pt-external-content');
      // Move the app's live nodes, including its functional toolbar and original close handler.
      Array.from(root.childNodes).filter(child => child !== bar && !child.classList?.contains('window-resize')).forEach(child => inner.append(child));
      main.append(inner); body.append(main); root.append(body);
      const app = catalog()?.apps.find(item => item.id === root.dataset.id);
      if (app?.closeButton) inner.querySelectorAll(app.closeButton).forEach(button => { button.hidden = true; button.classList.add('pt-legacy-close'); });
    }
    if (!main || !inner) return;
    body.classList.add('pt-workspace'); main.classList.add('pt-main'); inner.classList.add('pt-app-content');
    // Custom application sidebars remain within the application region.
    body.querySelectorAll(':scope > .window-sidebar').forEach(side => inner.prepend(side));
    body.prepend(sidebar(root));
    const top = node('div', 'pt-main-top');
    const crumb = node('div', 'pt-breadcrumb'); crumb.append(node('span', '', 'Workspace'), node('span', '', '/'), node('b', '', title));
    const help = node('button', 'pt-session'); help.type = 'button'; help.innerHTML = icon('keys'); help.append(node('span', '', 'คีย์ลัด')); help.onclick = openHelp;
    top.append(crumb, help); main.prepend(top);
    if (root.dataset.id === 'sentinel') root.classList.add('pt-chat-window');
  }
  function scan() { document.querySelectorAll('.window,.panthorium-managed-window,[data-panthorium-window]').forEach(apply); }
  function refreshAccess() {
    document.querySelectorAll('.pt-shell').forEach(root => {
      const old = root.querySelector(':scope > .pt-workspace > .pt-sidebar');
      if (old) old.replaceWith(sidebar(root));
    });
    closePalette(); desktopWindows = [];
  }
  const records = () => Array.from(api()?.all?.() || []).filter(([, rec]) => rec.el?.isConnected);
  const visible = () => records().filter(([, rec]) => !rec.minimized && rec.el.style.display !== 'none');
  const active = () => visible().sort((a, b) => Number(b[1].el.style.zIndex) - Number(a[1].el.style.zIndex))[0];
  function cycle(direction) {
    const list = records(); if (!list.length) return;
    const id = active()?.[0]; const index = list.findIndex(row => row[0] === id);
    const next = list[(index + direction + list.length) % list.length];
    api().focus(next[0]); next[1].el.focus({ preventScroll: true });
  }
  let desktopWindows = [];
  function showDesktop() {
    if (desktopWindows.length) {
      desktopWindows.forEach(id => { if (api()?.has(id)) api().focus(id); }); desktopWindows = [];
      active()?.[1].el.focus({ preventScroll: true });
    } else {
      desktopWindows = visible().sort((a,b) => Number(a[1].el.style.zIndex) - Number(b[1].el.style.zIndex)).map(([id]) => id);
      desktopWindows.forEach(id => api().minimize(id)); document.getElementById('start-btn')?.focus();
    }
  }
  const shortcuts = [
    ['K', 'ค้นหาและเปิดแอป'], ['← / →', 'สลับหน้าต่าง ก่อนหน้า / ถัดไป'],
    ['M', 'ย่อหน้าต่างปัจจุบัน'], ['X', 'ขยาย / คืนขนาดหน้าต่าง'], ['W', 'ปิดหน้าต่างปัจจุบัน'],
    ['1 / 2', 'จัดหน้าต่างครึ่งจอ ซ้าย / ขวา'], ['D', 'แสดงเดสก์ท็อป / คืนหน้าต่าง'],
    ['S', 'เปิด Sentinel AI'], ['/', 'แสดงคีย์ลัด']
  ];
  let overlay = null, previousFocus = null, paletteIndex = 0, paletteItems = [];
  function closePalette() {
    if (!overlay) return;
    overlay.remove(); overlay = null;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function dialog(title) {
    closePalette(); previousFocus = document.activeElement;
    overlay = node('div', 'pt-overlay'); const panel = node('section', 'pt-command-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'pt-command-title');
    const head = node('header', 'pt-command-head'); const heading = node('h2', '', title); heading.id = 'pt-command-title';
    const close = node('button', 'pt-icon-button'); close.type = 'button'; close.innerHTML = icon('close'); close.setAttribute('aria-label', 'ปิด'); close.onclick = closePalette;
    head.append(heading, close); panel.append(head); overlay.append(panel); document.body.append(overlay);
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) closePalette(); });
    return panel;
  }
  function openHelp() {
    const panel = dialog('คีย์ลัดของพื้นที่ทำงาน');
    panel.append(node('p', 'pt-shortcut-intro', 'กด Alt + Shift พร้อมปุ่มด้านล่าง · Mac ใช้ Option + Shift'));
    const list = node('dl', 'pt-shortcut-list');
    shortcuts.forEach(([key, label]) => { list.append(node('dt', '', key), node('dd', '', label)); }); panel.append(list);
    panel.append(node('p', 'pt-shortcut-note', 'ใช้ตำแหน่งปุ่มเดิมได้ทั้งแป้นไทยและอังกฤษ · Enter ส่งข้อความ · Shift + Enter ขึ้นบรรทัดใหม่ · Esc ปิดแผงนี้\nAlt + Tab และ Ctrl/Cmd + W เป็นคำสั่งของระบบหรือเบราว์เซอร์'));
    panel.querySelector('button').focus();
  }
  function markSelection() {
    paletteItems.forEach((button, index) => { button.setAttribute('aria-selected', String(index === paletteIndex)); });
    const selected = paletteItems[paletteIndex];
    const input = overlay?.querySelector('input');
    if (selected) { input?.setAttribute('aria-activedescendant', selected.id); selected.scrollIntoView?.({ block: 'nearest' }); }
    else input?.removeAttribute('aria-activedescendant');
  }
  function openPalette(query = '', subset) {
    const panel = dialog('ไปที่ไหนต่อดี?');
    const input = node('input', 'pt-command-input'); input.placeholder = 'ค้นหาแอปหรือหน้าต่าง…'; input.setAttribute('aria-label', 'ค้นหาแอป');
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'pt-command-results'); input.setAttribute('aria-autocomplete', 'list');
    const results = node('div', 'pt-command-results'); results.id = 'pt-command-results'; results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', 'แอปที่เปิดได้');
    panel.append(input, results, node('p', 'pt-command-hint', '↑ ↓ เลือก    Enter เปิด    Esc ปิด'));
    const render = () => {
      results.replaceChildren(); paletteItems = []; paletteIndex = 0;
      const term = input.value.toLocaleLowerCase().trim();
      availableApps().filter(app => (!subset || subset.includes(app.id)) && [app.label, app.id, ...(app.aliases || [])].join(' ').toLocaleLowerCase().includes(term)).forEach(app => {
        const button = node('button', 'pt-command-item'); button.type = 'button'; button.tabIndex = -1; button.id = 'pt-result-' + app.id; button.setAttribute('role', 'option');
        button.innerHTML = icon('grid'); button.append(node('span', '', app.label));
        const open = records().some(([id, rec]) => id === (app.windowId || app.id) || rec.menuAppId === app.id);
        button.append(node('small', '', open ? 'เปิดอยู่' : 'เปิดแอป'));
        button.onclick = () => { closePalette(); launch(app.id); };
        paletteItems.push(button); results.append(button);
      });
      if (!paletteItems.length) results.append(node('p', 'pt-empty', 'ไม่พบแอปที่คุณมีสิทธิ์ใช้งาน'));
      markSelection();
    };
    input.oninput = render; input.value = query; render(); input.focus();
    input.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); if (paletteItems.length) paletteIndex = (paletteIndex + (event.key === 'ArrowDown' ? 1 : -1) + paletteItems.length) % paletteItems.length; markSelection();
      } else if (event.key === 'Enter') { event.preventDefault(); paletteItems[paletteIndex]?.click(); }
    };
  }
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return;
    if (overlay) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePalette(); return; }
      if (event.key === 'Tab') {
        const items = Array.from(overlay.querySelectorAll('input,button:not([tabindex="-1"])'));
        const index = items.indexOf(document.activeElement);
        event.preventDefault(); items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      }
      return;
    }
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const login = document.getElementById('login-screen');
    if (login && getComputedStyle(login).display !== 'none' && !login.classList.contains('hidden')) return;
    const code = event.code;
    if (event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') && !['KeyK', 'Slash'].includes(code)) return;
    const current = active();
    const actions = {
      KeyK: () => openPalette(), Slash: openHelp, KeyS: () => launch('sentinel'), KeyD: showDesktop,
      ArrowRight: () => cycle(1), ArrowLeft: () => cycle(-1),
      KeyM: () => { if (current) api().minimize(current[0]); },
      KeyX: () => { if (current) api().toggleMaximize(current[0]); },
      KeyW: () => { current?.[1].el.querySelector('.window-titlebar .win-btn.close')?.click(); },
      Digit1: () => { if (current) api().setMode(current[0], 'left'); },
      Digit2: () => { if (current) api().setMode(current[0], 'right'); }
    };
    if (actions[code]) { event.preventDefault(); event.stopPropagation(); actions[code](); }
  }, true);
  document.addEventListener('click', event => { if (event.target.closest('[data-pt-command="launcher"]')) openPalette(); });
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true; Promise.resolve().then(() => { queued = false; if (window.document?.body) scan(); });
  });
  function start() { scan(); observer.observe(document.body, { childList: true, subtree: true }); }
  for (const name of ['panthorium:auth-changed', 'panthorium:apps-changed', 'panthorium:desktop-ready']) window.addEventListener(name, refreshAccess);
  // The markup below is populated from the checked-in reference during development.
  const chatMarkup = () => "<div class=\"chat-container pt-chat\"><div class=\"chat-messages pt-scroll\" id=\"chat-messages\"><section class=\"pt-hero\"><div class=\"pt-hero-art\" aria-hidden=\"true\"><svg viewBox=\"0 0 1000 300\" preserveAspectRatio=\"none\"><defs><linearGradient id=\"pt-chat-wave\" x1=\"0\" x2=\"1\"><stop stop-color=\"#1bcaff\" stop-opacity=\"0\"/><stop offset=\".4\" stop-color=\"#3defff\"/><stop offset=\".75\" stop-color=\"#9c72ff\"/><stop offset=\"1\" stop-color=\"#a1eaff\" stop-opacity=\".1\"/></linearGradient><filter id=\"pt-chat-glow\"><feGaussianBlur stdDeviation=\"4\"/></filter></defs><g class=\"pt-flow\" stroke=\"url(#pt-chat-wave)\" fill=\"none\"><path d=\"M-100 240C100 340 200 80 420 140S730 330 1100 35\" stroke-width=\"15\" opacity=\".18\" filter=\"url(#pt-chat-glow)\"/><path d=\"M-100 240C100 340 200 80 420 140S730 330 1100 35\"/><path d=\"M-100 252C120 325 190 110 420 154S750 300 1100 62\" opacity=\".65\"/><path d=\"M-100 268C150 280 200 160 420 169S800 270 1100 100\" opacity=\".3\"/><path d=\"M0 285C300 180 470 280 680 145S960 80 1100 115\" opacity=\".6\"/><path d=\"M0 289C300 185 470 285 680 154S960 100 1100 125\" opacity=\".2\"/></g></svg></div><div class=\"pt-eyebrow\"><svg style=\"width:13px;height:13px\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z\"/></svg> INTELLIGENCE, REIMAGINED</div><h1>ทุกความคิดของคุณ<br><span>เริ่มเป็นจริงได้ที่นี่</span></h1><p>พูดคุย สร้างสรรค์ และจัดการทุกวันของคุณ<br>ในพื้นที่เดียวกับ Sentinel AI</p><div class=\"pt-hero-line\"></div></section>\n<div class=\"pt-shortcuts\"><button class=\"pt-action\" data-pt-prompt=\"ช่วยออกแบบภาพแนวล้ำอนาคตให้ฉัน\"><div class=\"pt-action-top\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"3\"/><circle cx=\"8\" cy=\"8\" r=\"1.5\"/><path d=\"m3 17 5-5 4 4 4-6 5 7\"/></svg><svg class=\"pt-arrow\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M5 12h14m-6-6 6 6-6 6\"/></svg></div><strong>เปลี่ยนไอเดียเป็นภาพ</strong><small>CREATE SOMETHING EXTRAORDINARY</small></button><button class=\"pt-action\" data-pt-prompt=\"ช่วยวางโครงสร้างโค้ดสำหรับโปรเจกต์ใหม่\"><div class=\"pt-action-top\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m7 5-6 7 6 7m10-14 6 7-6 7M14 3l-4 18\"/></svg><svg class=\"pt-arrow\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M5 12h14m-6-6 6 6-6 6\"/></svg></div><strong>สร้างด้วยโค้ด</strong><small>BUILD YOUR NEXT POSSIBILITY</small></button><button class=\"pt-action\" data-pt-prompt=\"ช่วยวางแผนวันพรุ่งนี้ให้ฉัน\"><div class=\"pt-action-top\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M7 2v6m10-6v6M3 11h18m-13 5h2m4 0h2\"/></svg><svg class=\"pt-arrow\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M5 12h14m-6-6 6 6-6 6\"/></svg></div><strong>ออกแบบวันของคุณ</strong><small>MAKE ROOM FOR WHAT MATTERS</small></button></div>\n<div class=\"pt-conversation-head\">YOUR CONVERSATION</div><div class=\"msg ai\"><strong>SENTINEL AI</strong>สวัสดี วันนี้คุณอยากสร้างอะไรใหม่ ๆ?<br>เริ่มจากไอเดียเล็ก ๆ หรือส่งรายละเอียดงานมาได้เลย</div></div><div class=\"pt-compose-area\"><div class=\"pt-composer chat-input-area\"><textarea class=\"chat-input\" id=\"chat-input\" rows=\"1\" aria-label=\"ข้อความถึง Sentinel AI\" placeholder=\"บอก Sentinel AI ว่าคุณอยากทำอะไร...\"></textarea><div class=\"pt-compose-tools\"><div class=\"pt-left-tools\"><button class=\"pt-tool\" type=\"button\" data-pt-command=\"launcher\" aria-label=\"เปิดเครื่องมือและแอป\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 5v14M5 12h14\"/></svg></button><span class=\"pt-mode\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z\"/></svg> Sentinel AI</span></div><div class=\"pt-right-tools\"><button class=\"pt-tool chat-mic\" id=\"chat-mic\" type=\"button\" aria-label=\"เริ่มพูดกับ Sentinel AI\" aria-pressed=\"false\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"9\" y=\"2\" width=\"6\" height=\"13\" rx=\"3\"/><path d=\"M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8\"/></svg></button><button class=\"pt-send chat-send\" id=\"chat-send\" type=\"button\" aria-label=\"ส่งข้อความ\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m3 3 19 9-19 9 4-9-4-9Zm4 9h15\"/></svg></button></div></div></div><div class=\"pt-foot\"><span>Sentinel AI · Panthorium</span><span>Enter เพื่อส่ง · Shift + Enter ขึ้นบรรทัดใหม่</span></div></div></div>";
  window.PanthoriumWorkspace = Object.freeze({ apply, scan, icon, launch, openPalette, openHelp, chatMarkup });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
