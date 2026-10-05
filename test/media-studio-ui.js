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
  assert.ok(root.querySelector('[data-media-bin]'));
  assert.ok(root.querySelector('[data-media-preview]'));
  assert.ok(root.querySelector('[data-range-track]'));
  assert.equal(root.querySelectorAll('.ms-track-row').length, 2, 'V1 and A1 tracks are present');
  const css = root.querySelector('style').textContent;
  assert.match(css, /orientation:portrait/);
  assert.match(css, /orientation:landscape/);
  assert.match(css, /safe-area-inset/);
  assert.match(css, /100dvh/);

  window.PanthoriumMediaStudio.close();
  window.close();
  console.log('Media Studio UI: Sentinel prompts, V1/A1 timeline and responsive portrait/landscape rules passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
