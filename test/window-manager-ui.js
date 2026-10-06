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
  assert.match(maximizedRule, /padding:\s*0px\s+0px\s+0px\s+0px/, 'native and web windows fill the full viewport in both orientations');
  const managedFullscreenRule = /\.panthorium-managed-window\.panthorium-window-fullscreen\s*\{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] || '';
  assert.match(managedFullscreenRule, /padding:\s*0px\s+0px\s+0px\s+0px/, 'every catalog window fills all four screen edges');
  assert.doesNotMatch(fullscreenCss, /safe-area-inset-/, 'fullscreen window rules do not reintroduce any safe-area gaps');
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
  assert.match(voiceIdentity, /inset:0!important;padding:clamp\(10px,3vw,16px\)/, 'voice registration fills the phone viewport');
  assert.match(voiceIdentity, /@media\(max-width:760px\)/, 'voice registration and login switch to a single column on phones');

  window.PanthoriumWindowManager = manager;
  window.PanthoriumWindowCatalog = {
    apps: [
      { id: 'ai-platform', label: 'AI Platform', selector: '#ai-window', closeButton: '[data-close]' },
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
  await new Promise(resolve => window.setTimeout(resolve, 0));

  assert.equal(manager.findByAppId('ai-platform').el, root, 'new catalog windows register with the shared manager');
  assert.ok(root.classList.contains('panthorium-window-fullscreen'), 'new function windows open in the shared fullscreen layout');
  assert.ok(root.querySelector('[data-panthorium-window-action="minimize"]'), 'catalog windows receive a minimize control');
  assert.equal(root.querySelector('[data-fullscreen], [data-panthorium-window-action="fullscreen"]'), null, 'catalog windows do not expose a size-restore control');
  assert.ok(root.querySelector('[data-close]'), 'catalog windows keep a close control');
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
