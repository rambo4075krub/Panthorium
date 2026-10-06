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
  const managedWindows = new Map();
  window.PanthoriumWindowManager = {
    registerExternal(id, title, root, options) {
      root.classList.add('panthorium-managed-window', 'panthorium-window-fullscreen');
      const record = { id, title, el: root, menuAppId: options.menuAppId, fullscreen: true, displayMode: 'flex' };
      managedWindows.set(id, record);
      return record;
    },
    findByAppId(id) { return managedWindows.get(id) || null; },
    restore(id) { const win = managedWindows.get(id); if (win) win.el.style.display = win.displayMode; return Boolean(win); },
    minimize(id) { const win = managedWindows.get(id); if (win) win.el.style.display = 'none'; return Boolean(win); },
    close(id) { const win = managedWindows.get(id); if (win) win.el.remove(); managedWindows.delete(id); return Boolean(win); },
    setFullscreen(id) {
      const win = managedWindows.get(id);
      if (!win) return false;
      win.fullscreen = true;
      win.el.classList.add('panthorium-window-fullscreen');
      return true;
    }
  };
  window.OS = {
    config: { accessToken: 'session-test' },
    state: { user: { id: '11111111-1111-4111-8111-111111111111', roles: [], permissions: ['chat'] } }
  };
  window.PanthoriumWindowCatalog = { apps: [{ id: 'media-studio' }], allowed: () => true };
  window.fetch = async url => ({
    ok: true,
    status: 200,
    async json() {
      return String(url).includes('/capabilities')
        ? { ok: true, aiEditPlanning: true, videoGeneration: true }
        : { ok: true, files: [] };
    }
  });
  window.eval(fs.readFileSync(require.resolve('../media-studio-ui.js'), 'utf8'));
  const root = window.PanthoriumMediaStudio.open();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(root.querySelector('[data-ai-instruction]'), 'Sentinel edit prompt is visible in the Inspector');
  assert.ok(root.querySelector('[data-generation-command]'), 'video generation has its own prompt field');
  assert.equal(root.querySelector('[data-fullscreen]'), null, 'editor does not expose a restore-size control');
  assert.ok(root.querySelector('[data-minimize]'), 'editor provides a minimize control');
  assert.ok(root.querySelector('[data-close]'), 'editor provides a close control');
  assert.ok(root.querySelector('[data-media-bin]'));
  assert.ok(root.querySelector('[data-media-preview]'));
  assert.ok(root.querySelector('[data-range-track]'));
  assert.equal(root.querySelectorAll('.ms-track-row').length, 2, 'V1 and A1 tracks are present');
  const css = root.querySelector('style').textContent;
  assert.match(css, /orientation:portrait/);
  assert.match(css, /orientation:landscape/);
  const sharedShell = fs.readFileSync(require.resolve('../sentinel.html'), 'utf8');
  const sharedFullscreenRule = /\.panthorium-managed-window\.panthorium-window-fullscreen\s*\{([\s\S]*?)\n\s*\}/.exec(sharedShell)?.[1] || '';
  assert.match(sharedFullscreenRule, /padding:\s*0px\s+0px\s+0px\s+0px/, 'Media Studio fills all viewport edges in portrait and landscape');
  assert.doesNotMatch(css, /safe-area-inset|data-panthorium-immersive/, 'Media Studio follows the shared immersive edge-to-edge rule');
  assert.match(css, /100dvh/);
  assert.ok(root.classList.contains('panthorium-managed-window'), 'Media Studio is registered with the common window manager');
  assert.ok(root.classList.contains('panthorium-window-fullscreen'), 'Media Studio uses the common fullscreen window preference');

  const prompt = root.querySelector('[data-ai-instruction]');
  prompt.value = 'keep this edit brief';
  root.querySelector('[data-minimize]').click();
  assert.equal(root.style.display, 'none', 'minimize hides the editor window');
  assert.equal(window.document.querySelector('#media-studio-restore'), null, 'the editor does not create a floating restore control');
  const restored = window.PanthoriumMediaStudio.open();
  assert.equal(restored, root, 'opening from its Start Menu launcher restores the same editor root');
  assert.equal(root.style.display, 'flex', 'restore brings the editor back');
  assert.equal(root.querySelector('[data-ai-instruction]').value, 'keep this edit brief', 'the editor state remains until the user closes it');

  window.PanthoriumMediaStudio.close();
  assert.equal(managedWindows.has('media-studio'), false, 'closing the editor clears its managed session');
  window.close();
  console.log('Media Studio UI: Sentinel prompts, V1/A1 timeline and responsive portrait/landscape rules passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
