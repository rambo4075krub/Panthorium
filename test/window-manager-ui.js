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
      root.classList.add('panthorium-managed-window', 'panthorium-window-fullscreen');
      const record = { id, title, el: root, menuAppId: options.menuAppId, external: true, fullscreen: true, displayMode: 'flex' };
      windows.set(id, record);
      return record;
    },
    findByAppId(id) { return windows.get(id) || null; },
    minimize(id) { const record = windows.get(id); record.el.style.display = 'none'; return true; },
    restore(id) { const record = windows.get(id); if (!record) return false; record.el.style.display = record.displayMode; return true; },
    close(id) { const record = windows.get(id); if (record) record.el.remove(); windows.delete(id); return Boolean(record); },
    setFullscreen(id) { const record = windows.get(id); if (!record) return false; record.fullscreen = true; record.el.classList.add('panthorium-window-fullscreen'); return true; }
  };
  const shell = fs.readFileSync(require.resolve('../sentinel.html'), 'utf8');
  const maximizedRule = /\.window\.maximized\s*\{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] || '';
  assert.match(maximizedRule, /box-sizing:\s*border-box/, 'fullscreen windows keep safe-area padding inside the viewport');
  assert.match(maximizedRule, /padding:\s*env\(safe-area-inset-top,\s*0px\)\s+env\(safe-area-inset-right,\s*0px\)\s+env\(safe-area-inset-bottom,\s*0px\)\s+env\(safe-area-inset-left,\s*0px\)/, 'native and web fullscreen windows reserve visible system-bar insets');
  const managedFullscreenRule = /\.panthorium-managed-window\.panthorium-window-fullscreen\s*\{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] || '';
  assert.match(managedFullscreenRule, /padding:\s*env\(safe-area-inset-top,\s*0px\)[\s\S]*env\(safe-area-inset-bottom,\s*0px\)/, 'every catalog window reserves shared safe-area insets');
  assert.doesNotMatch(shell, /html\[data-panthorium-immersive="true"\][^{}]*\.panthorium-window-fullscreen[^{}]*\{[^}]*padding:\s*0\s*!important/i, 'immersive state cannot erase safe-area padding from function windows');
  assert.doesNotMatch(shell, /html\[data-panthorium-immersive="true"\]\s*\.window\.maximized[\s\S]*?padding:\s*0\s*!important;/, 'immersive fullscreen must not erase safe-area padding');

  window.PanthoriumWindowManager = manager;
  window.PanthoriumWindowCatalog = {
    apps: [{ id: 'ai-platform', label: 'AI Platform', selector: '#ai-window', closeButton: '[data-close]' }]
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
  await new Promise(resolve => window.setTimeout(resolve, 0));

  assert.equal(manager.findByAppId('ai-platform').el, root, 'new catalog windows register with the shared manager');
  assert.ok(root.classList.contains('panthorium-window-fullscreen'), 'new function windows open in the shared fullscreen layout');
  assert.ok(root.querySelector('[data-panthorium-window-action="minimize"]'), 'catalog windows receive a minimize control');
  assert.equal(root.querySelector('[data-fullscreen], [data-panthorium-window-action="fullscreen"]'), null, 'catalog windows do not expose a size-restore control');
  assert.ok(root.querySelector('[data-close]'), 'catalog windows keep a close control');

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
