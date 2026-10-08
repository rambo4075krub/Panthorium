const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

async function main() {
  const dom = new JSDOM('<!doctype html><body><div id="sm-apps"></div></body>', {
    url: 'https://panthorium.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const window = dom.window;
  const windows = new Map();
  const manager = {
    preferences: { fullscreenOnOpen: true, minimizeToStartMenu: true, preserveStateUntilClose: true, landscapeEdgeToEdge: true },
    registerExternalWindow(id, title, root, options) {
      root.classList.add('panthorium-managed-window');
      if (options.fullscreenOnOpen !== false) root.classList.add('panthorium-window-fullscreen');
      const fullscreen = options.fullscreenOnOpen !== false;
      const record = { id, title, el: root, menuAppId: options.menuAppId, external: true, fullscreen, displayMode: 'flex' };
      windows.set(id, record);
      return record;
    },
    findByAppId(id) { return windows.get(id) || null; },
    minimize(id) { const record = windows.get(id); record.el.style.display = 'none'; return true; },
    restore(id) { const record = windows.get(id); if (!record) return false; record.el.style.display = record.displayMode; return true; },
    close(id) { const record = windows.get(id); if (record) record.el.remove(); windows.delete(id); return Boolean(record); },
    setFullscreen(id, active = true) { const record = windows.get(id); if (!record) return false; record.fullscreen = Boolean(active); record.el.classList.toggle('panthorium-window-fullscreen', Boolean(active)); return true; }
  };
  const shell = fs.readFileSync(require.resolve('../sentinel.html'), 'utf8');
  const fullscreenCssStart = shell.indexOf('.window.maximized {');
  const fullscreenCssEnd = shell.indexOf('.window-titlebar {', fullscreenCssStart);
  const fullscreenCss = shell.slice(fullscreenCssStart, fullscreenCssEnd);
  const maximizedRule = /\.window\.maximized\s*\{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] || '';
  assert.match(maximizedRule, /box-sizing:\s*border-box/, 'fullscreen windows keep safe-area padding inside the viewport');
  assert.match(maximizedRule, /padding:\s*var\(--panthorium-safe-area-top\)/, 'native and web windows keep the top safe area');
  const managedFullscreenRule = /\.panthorium-managed-window\.panthorium-window-fullscreen\s*\{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] || '';
  assert.match(managedFullscreenRule, /padding:\s*var\(--panthorium-safe-area-top\)/, 'every catalog window keeps the top safe area');
  assert.match(shell, /--panthorium-safe-area-top:\s*max\(env\(safe-area-inset-top,\s*0px\),\s*var\(--panthorium-native-safe-area-top,\s*0px\)\)/, 'fullscreen content uses browser and native safe-area values');
  assert.match(shell, /--panthorium-shell-dock-clearance:\s*calc\(var\(--taskbar-h\) \+ env\(safe-area-inset-bottom,\s*0px\) \+ 8px\)/, 'fullscreen windows reserve the system dock and bottom inset');
  assert.match(fullscreenCss, /@media \(orientation: portrait\)[\s\S]*\.window\.maximized, \.panthorium-managed-window\.panthorium-window-fullscreen\s*\{\s*padding:\s*var\(--panthorium-safe-area-top\) 0px var\(--panthorium-shell-dock-clearance\) 0px/, 'portrait fullscreen windows including tablets clear the bottom dock');
  assert.match(fullscreenCss, /@media \(orientation: landscape\)[\s\S]*padding:\s*var\(--panthorium-safe-area-top\) 0px var\(--panthorium-shell-dock-clearance\) 0px/, 'landscape fullscreen windows clear the bottom dock');
  assert.match(fullscreenCss, /@media \(orientation:\s*landscape\)[\s\S]*padding:\s*var\(--panthorium-safe-area-top\)/, 'landscape fullscreen keeps the top safe area');
  assert.match(fullscreenCss, /data-window-landscape-edge-to-edge="false"[\s\S]*padding:\s*var\(--panthorium-safe-area-top\)/, 'landscape preference cannot remove the top safe area');
  assert.doesNotMatch(shell, /html\[data-panthorium-immersive="true"\][^{}]*\.panthorium-window-fullscreen[^{}]*\{[^}]*padding:\s*0\s*!important/i, 'immersive state cannot erase safe-area padding from function windows');
  assert.doesNotMatch(shell, /html\[data-panthorium-immersive="true"\]\s*\.window\.maximized[\s\S]*?padding:\s*0\s*!important;/, 'immersive fullscreen must not erase safe-area padding');

  const sharedResponsiveRule = /\.window \*, \.panthorium-managed-window \* \{([^}]+)\}/.exec(shell)?.[1] || '';
  assert.match(sharedResponsiveRule, /box-sizing:\s*border-box/, 'all current and future function window content uses border-box sizing');
  assert.match(sharedResponsiveRule, /min-width:\s*0/, 'function window children can shrink instead of overflowing to the right');
  const loginScreenRule = /#login-screen \{([^}]+)\}/.exec(shell)?.[1] || '';
  const loginCardRule = /\.login-card \{([^}]+)\}/.exec(shell)?.[1] || '';
  assert.match(loginScreenRule, /overflow-x:\s*hidden/);
  assert.match(loginScreenRule, /overflow-y:\s*auto/);
  assert.match(loginCardRule, /box-sizing:\s*border-box/);
  assert.match(loginCardRule, /width:\s*100%[\s\S]*max-width:\s*360px/);
  assert.match(shell, /@media \(max-height: 540px\) and \(orientation: landscape\)/, 'admin login is compact and scrollable on short landscape screens');
  const voiceIdentity = fs.readFileSync(require.resolve('../voice-identity-ui.js'), 'utf8');
  assert.match(voiceIdentity, /box-sizing:border-box;position:fixed;inset:0;max-width:100vw/, 'voice registration can reach the left edge');
  assert.match(voiceIdentity, /#panthorium-voice-identity\.panthorium-managed-window\.panthorium-window-fullscreen\{padding:calc\(var\(--panthorium-safe-area-top,0px\)/, 'voice registration preserves the top device safe area in both orientations');
  assert.match(voiceIdentity, /var\(--panthorium-shell-dock-clearance,56px\)/, 'voice registration reserves the bottom system dock');
  assert.match(voiceIdentity, /overflow-y:auto!important/, 'voice registration remains scrollable after safe-area padding');
  assert.match(voiceIdentity, /@media\(max-width:760px\)/, 'voice registration and login switch to a single column on phones');

  window.PanthoriumWindowManager = manager;
  window.PanthoriumWindowCatalog = {
    apps: [
      { id: 'ai-platform', label: 'AI Platform', selector: '#ai-window', closeButton: '[data-close]' },
      { id: 'sentinel', label: 'Sentinel AI', selector: '#sentinel-window', closeButton: '[data-close]' },
      { id: 'notes', label: 'Notes', selector: '#notes-window', closeButton: '[data-close]' },
      { id: 'files', label: 'Files', selector: '#files-window', closeButton: '[data-close]' },
      { id: 'calendar', label: 'Calendar', selector: '#calendar-window', closeButton: '[data-close]' },
      { id: 'reminders', label: 'Reminders', selector: '#reminders-window', closeButton: '[data-close]' },
      { id: 'media-studio', label: 'Media Studio', selector: '#media-studio-window', closeButton: '[data-close]' },
      { id: 'voice-identity', label: 'Voice Identity', selector: '#voice-identity-window', closeButton: '[data-close]' },
      { id: 'calculator', label: 'Calculator', selector: '#calculator-window', closeButton: '[data-close]' }
    ]
  };
  window.eval(fs.readFileSync(require.resolve('../window-manager-ui.js'), 'utf8'));

  const launcher = window.document.createElement('button');
  launcher.className = 'sm-app';
  launcher.dataset.appId = 'ai-platform';
  window.document.getElementById('sm-apps').appendChild(launcher);
  const root = window.document.createElement('section');
  root.id = 'ai-window';
  root.style.cssText = 'position:fixed;inset:6%;display:flex';
  root.innerHTML = '<header><strong>AI Platform</strong><button type="button" data-fullscreen>⛶</button><button type="button" data-close>✕</button></header><input value="unsaved work">';
  window.document.body.appendChild(root);
  const calculator = window.document.createElement('section');
  calculator.id = 'calculator-window';
  calculator.style.cssText = 'position:fixed;inset:6%;display:flex';
  calculator.innerHTML = '<header><strong>Calculator</strong><button type="button" data-fullscreen>⛶</button><button type="button" data-close>✕</button></header>';
  window.document.body.appendChild(calculator);
  const additionalWindows = new Map();
  for (const appId of ['sentinel', 'notes', 'files', 'calendar', 'reminders', 'media-studio', 'voice-identity']) {
    const appWindow = window.document.createElement('section');
    appWindow.id = appId + '-window';
    appWindow.style.cssText = 'position:fixed;inset:1%;display:flex';
    appWindow.innerHTML = '<header><strong>' + appId + '</strong><button type="button" data-close>✕</button></header>';
    window.document.body.appendChild(appWindow);
    additionalWindows.set(appId, appWindow);
  }
  await new Promise(resolve => window.setTimeout(resolve, 0));

  assert.equal(manager.findByAppId('ai-platform').el, root, 'new catalog windows register with the shared manager');
  assert.ok(root.classList.contains('panthorium-window-fullscreen'), 'new function windows open in the shared fullscreen layout');
  assert.ok(root.querySelector('[data-panthorium-window-action="minimize"]'), 'catalog windows receive a minimize control');
  assert.equal(root.querySelector('[data-fullscreen], [data-panthorium-window-action="fullscreen"]'), null, 'catalog windows do not expose a size-restore control');
  assert.ok(root.querySelector('[data-close]'), 'catalog windows keep a close control');
  for (const [appId, appWindow] of additionalWindows) {
    assert.equal(manager.findByAppId(appId).el, appWindow, appId + ' registers with the shared manager');
    assert.ok(appWindow.classList.contains('panthorium-window-fullscreen'), appId + ' opens fullscreen by default');
  }
  assert.equal(manager.findByAppId('calculator').el, calculator, 'calculator registers with the shared manager');
  assert.equal(manager.findByAppId('calculator').fullscreen, false, 'calculator keeps its normal window size');
  assert.equal(calculator.classList.contains('panthorium-window-fullscreen'), false, 'calculator does not receive the fullscreen class');
  assert.equal(calculator.style.inset, '6%', 'calculator keeps its normal window geometry');
  assert.ok(calculator.querySelector('[data-panthorium-window-action="minimize"]'), 'calculator still receives the standard minimize control');
  assert.equal(calculator.querySelector('[data-fullscreen]'), null, 'calculator does not expose a fullscreen control');

  root.querySelector('[data-panthorium-window-action="minimize"]').click();
  assert.equal(root.style.display, 'none', 'minimize hides the same live window');
  manager.restore('ai-platform');
  assert.equal(root.style.display, 'flex', 'the shared manager restores the same window');
  assert.equal(root.querySelector('input').value, 'unsaved work', 'the existing session state remains in the window');

  root.querySelector('[data-close]').click();
  await new Promise(resolve => window.setTimeout(resolve, 5));
  assert.equal(manager.findByAppId('ai-platform'), null, 'explicit close clears the managed session');
  assert.equal(root.isConnected, false, 'explicit close removes the old window root');

  window.close();
  console.log('Window Manager UI: fullscreen-only layout, minimize/restore, close-only titlebar controls passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
