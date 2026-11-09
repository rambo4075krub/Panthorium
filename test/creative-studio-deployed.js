'use strict';
// Read-only deployment check. Does not sign in, create files, or call paid models.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

(async () => {
  const origin = new URL(process.env.STUDIO_SMOKE_URL).origin;
  const get = route => fetch(origin + route, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  const scriptPaths = new Map();
  for (const route of ['/', '/admin']) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    const dom = new JSDOM(await response.text());
    for (const script of dom.window.document.scripts) if (script.src) { const url = new URL(script.src, origin); if (url.origin === origin) scriptPaths.set(url.pathname.slice(1), url.pathname + url.search); }
    for (const asset of ['panthorium-window-base.js', 'creative-editors-ui.js', 'creative-studio-ui.js']) assert.equal([...dom.window.document.scripts].filter(script => new URL(script.src || '/', origin).pathname === '/' + asset).length, 1, route + ' loads ' + asset + ' exactly once');
    dom.window.close();
  }
  for (const asset of ['panthorium-window-base.js', 'creative-editors-ui.js', 'file-preview-ui.js', 'office-suite-core.js', 'office-suite-ui.js', 'studio-editor-ui.js', 'creative-studio-ui.js', 'start-menu-ui.js', 'voice-window-catalog.js', 'ai-stream-client.js']) {
    const response = await get(scriptPaths.get(asset) || '/' + asset);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('cache-control') || '', /no-store/, asset + ' bypasses caches');
    assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '..', asset), 'utf8'), asset + ' matches tested source');
  }
  for (const route of ['/api/studio/catalog', '/api/studio/jobs', '/api/files/11111111-1111-4111-8111-111111111111/preview']) {
    const response = await get(route);
    assert.equal(response.status, 401, route + ' requires an authenticated account');
    const data = await response.json();
    assert.equal(data.ok, false);
  }
  const timeline = await fetch(origin + '/api/media/render-timeline', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert.equal(timeline.status, 401, 'timeline export exists at the production route and requires authentication');
  console.log('PASS deployed Studio: user/admin shell, exact frontend assets, private API authentication. Live provider generation requires a separate signed-in acceptance check.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
