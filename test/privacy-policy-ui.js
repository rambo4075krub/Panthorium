const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

async function main() {
  const dom = new JSDOM('<!doctype html><body><div id="sm-apps"><button class="sm-app" data-app-id="privacy-policy">Privacy/Policy</button></div></body>', {
    url: 'https://panthorium.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const window = dom.window;
  const root = window.document;
  const windows = new Map();
  const manager = {
    preferences: { fullscreenOnOpen: true, minimizeToStartMenu: true, preserveStateUntilClose: true, landscapeEdgeToEdge: true },
    registerExternalWindow(id, title, el, options) {
      el.classList.add('panthorium-managed-window', 'panthorium-window-fullscreen');
      const record = { id, title, el, menuAppId: options.menuAppId, external: true, fullscreen: true, displayMode: 'flex' };
      windows.set(id, record);
      return record;
    },
    setFullscreen(id) { const record = windows.get(id); if (!record) return false; record.fullscreen = true; record.el.classList.add('panthorium-window-fullscreen'); return true; },
    findByAppId(id) { return windows.get(id) || null; },
    minimize(id) { const record = windows.get(id); if (!record) return false; record.el.style.display = 'none'; return true; },
    restore(id) { const record = windows.get(id); if (!record) return false; record.el.style.display = 'flex'; return true; },
    close(id) { const record = windows.get(id); if (!record) return false; record.el.remove(); windows.delete(id); return true; }
  };
  window.PanthoriumWindowManager = manager;
  window.PanthoriumWindowCatalog = {
    apps: [{ id: 'privacy-policy', label: 'Privacy/Policy', selector: '#panthorium-privacy-policy', closeButton: '[data-close]' }]
  };
  window.eval(fs.readFileSync(require.resolve('../start-menu-ui.js'), 'utf8'));
  window.eval(fs.readFileSync(require.resolve('../window-manager-ui.js'), 'utf8'));
  window.eval(fs.readFileSync(require.resolve('../privacy-policy-ui.js'), 'utf8'));

  const api = window.PanthoriumPrivacyPolicy;
  const articles = api.list();
  assert.ok(articles.length >= 8, 'the registry contains separate privacy, account, AI, voice, cloud, retention, terms and archive topics');
  assert.ok(articles.some(article => article.id === 'policy-archive'), 'the central archive explains which prior policy records were found');
  assert.ok(articles.some(article => article.id === 'voice-identity'), 'the central policy covers voice consent, encryption and deletion');
  assert.equal(api.register({ id: 'unsafe', title: 'Injected', sections: [['Unsafe', '<img src=x onerror=alert(1)>']] }), true);

  const policyWindow = api.open();
  assert.equal(policyWindow.id, 'panthorium-privacy-policy', 'Privacy/Policy has its own window');
  assert.ok(policyWindow.classList.contains('panthorium-window-fullscreen'), 'policy window uses the shared fullscreen layout');
  assert.ok(policyWindow.querySelector('[data-minimize], [data-panthorium-window-action="minimize"]'), 'policy window can minimize to the Start Menu');
  assert.ok(policyWindow.querySelector('[data-close]'), 'policy window can close');
  assert.equal(policyWindow.querySelector('[data-fullscreen]'), null, 'policy window has no restore-size control');
  assert.ok(policyWindow.querySelectorAll('[data-policy-nav] button').length >= articles.length + 1, 'each policy topic is independently selectable');
  assert.equal(policyWindow.querySelector('[data-policy-content] img'), null, 'policy text is rendered as text rather than executable HTML');

  policyWindow.querySelector('[data-policy-nav] [data-policy-id="cloud-files"]').click();
  assert.equal(policyWindow.dataset.selectedPolicy, 'cloud-files', 'selecting a topic changes the article in place');
  assert.match(policyWindow.querySelector('[data-policy-content]').textContent, /Cloud Files/);
  manager.minimize('privacy-policy');
  assert.equal(api.open(), policyWindow, 'reopening restores the original policy window');
  assert.equal(policyWindow.dataset.selectedPolicy, 'cloud-files', 'the selected article is preserved until explicit close');
  assert.equal(manager.findByAppId('privacy-policy').el, policyWindow);

  manager.close('privacy-policy');
  assert.equal(root.getElementById('panthorium-privacy-policy'), null, 'explicit close discards the live policy window');
  window.close();
  console.log('Privacy/Policy UI: central topic registry, safe article rendering, fullscreen window lifecycle and topic state passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
