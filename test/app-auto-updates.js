'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { MessageChannel } = require('node:worker_threads');
const { JSDOM, VirtualConsole } = require('jsdom');
const source = fs.readFileSync('app-update-client.js', 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
async function clientScenario(run, { hidden = false } = {}) {
  let reloads = 0, next = 'revision-a', fail = false, requests = 0, visible = !hidden;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (error.message.includes('navigation')) reloads++; else throw error; });
  const dom = new JSDOM('<body data-panthorium-release="revision-a"><input id="draft"></body>', { url: 'https://panthorium.net/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  Object.defineProperty(w.document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
  w.AbortSignal = AbortSignal;
  w.fetch = async (url, options) => { requests++; assert.equal(url, '/app-release.json'); assert.equal(options.cache, 'no-store'); if (fail) throw Error('offline'); return Response.json({ release: next }); };
  w.confirm = () => false;
  w.localStorage.setItem('account', 'keep-account');
  w.eval(source); await settle();
  try { await run({ w, setNext: value => { next = value; }, setFail: value => { fail = value; }, show: () => { visible = true; w.document.dispatchEvent(new w.Event('visibilitychange')); }, reloads: () => reloads, requests: () => requests }); }
  finally { assert.equal(w.localStorage.getItem('account'), 'keep-account'); w.close(); }
}
(async () => {
  await clientScenario(async ({ w, setNext, reloads }) => {
    assert.equal(w.PanthoriumUpdates.state().available, false);
    setNext('revision-b'); await w.PanthoriumUpdates.check(); assert.equal(reloads(), 1);
    await w.PanthoriumUpdates.check(); assert.equal(reloads(), 1, 'no duplicate reload while applying');
  });
  await clientScenario(async ({ w, setNext, show, requests, reloads }) => {
    assert.equal(requests(), 0); setNext('revision-b');
    await w.PanthoriumUpdates.check(); assert.equal(requests(), 0);
    show(); await settle(); assert.equal(reloads(), 1, 'hidden tabs update on return, without losing their old baseline');
  }, { hidden: true });
  await clientScenario(async ({ w, setNext, reloads }) => {
    const input = w.document.getElementById('draft'); input.focus(); input.value = 'unsaved'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
    setNext('revision-b'); await w.PanthoriumUpdates.check(); assert.equal(reloads(), 0);
    assert(w.document.getElementById('panthorium-update-pending'));
    await w.PanthoriumUpdates.apply({ manual: true }); assert.equal(reloads(), 0, 'declining preserves edits');
    w.PanthoriumUpdates.markSaved(input); await settle(); assert.equal(reloads(), 1, 'saving unblocks the pending update');
  });
  await clientScenario(async ({ w, setNext, setFail, reloads }) => {
    setFail(true); await w.PanthoriumUpdates.check(); assert.equal(w.PanthoriumUpdates.state().ok, false); assert.equal(reloads(), 0);
    setFail(false); setNext('https://untrusted.example/'); await w.PanthoriumUpdates.check(); assert.equal(reloads(), 0);
    setNext('revision-b'); w.sessionStorage.setItem('pt_update_attempt', JSON.stringify({ at: Date.now(), release: 'revision-b' }));
    await w.PanthoriumUpdates.check(); assert.equal(reloads(), 0, 'stale caching cannot create a reload loop');
    await w.PanthoriumUpdates.apply({ manual: true }); assert.equal(reloads(), 1);
  });
  for (const marker of ['capacitor', 'legacy-android']) {
    let storeNavigations = 0;
    const vc = new VirtualConsole(); vc.on('jsdomError', error => { if (error.message.includes('navigation')) storeNavigations++; else throw error; });
    const dom = new JSDOM('<body><div id="start-menu"><div id="sm-apps"></div><div class="sm-footer"></div></div></body>', { url: 'https://panthorium.net', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
    const w = dom.window; w.OS = { state: { user: { roles: ['guest'] } } };
    if (marker === 'capacitor') w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    else Object.defineProperty(w.navigator, 'userAgent', { value: 'Android PanthoriumAndroid' });
    w.eval(fs.readFileSync('access-shell-ui.js', 'utf8')); w.PanthoriumAccessShell.sync(); await w.PanthoriumAccessShell.refreshUpdateStatus(true);
    const button = w.document.getElementById('panthorium-browser-update');
    assert.equal(button.querySelector('[data-update-label]').textContent, 'อัพเดท');
    assert.match(button.querySelector('[data-update-message]').textContent, /Google Play/);
    assert.equal(w.document.getElementById('panthorium-browser-download'), null);
    await button.onclick(); assert.equal(storeNavigations, 1); w.close();
  }
  const handlers = {}; let navigated = 0;
  const clients = [
    { postMessage(data, ports) { assert.equal(data.type, 'panthorium:update-ready'); ports[0].postMessage({ managed: true }); ports[0].close(); }, navigate() { throw Error('managed client must preserve edits'); } },
    { postMessage() { throw Error('legacy client'); }, navigate() { navigated++; }, url: 'https://panthorium.net/' }
  ];
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), { self: { addEventListener: (name, fn) => { handlers[name] = fn; }, clients: { claim: async () => {}, matchAll: async () => clients } }, caches: { keys: async () => [] }, MessageChannel, setTimeout, clearTimeout });
  let activated; handlers.activate({ waitUntil(promise) { activated = promise; } }); await activated; assert.equal(navigated, 1);
  const versions = [1, 59999, 60000].map(run => execFileSync(process.execPath, ['scripts/desktop-release-version.js'], { env: { ...process.env, GITHUB_RUN_NUMBER: String(run) }, encoding: 'utf8' }).trim().split('=')[1]);
  assert.deepEqual(versions, ['15.1.1', '15.1.59999', '15.2.0']);
  console.log('Automatic updates: active/hidden tabs, edits, offline recovery, loop bounds, Android store fallback, worker migration and native build versions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
