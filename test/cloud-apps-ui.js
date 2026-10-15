'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) { for (let i = 0; i < 150; i++) { if (predicate()) return; await sleep(10); } throw Error(message); }

async function main() {
  const packs = JSON.parse(read('services/catalog/cloud-app-packs.json')).packs.map(pack => ({ ...pack, blocked: !!pack.requiresMinorReadiness }));
  const dom = new JSDOM('<div id="desktop-icons"><i id="original-desktop"></i></div><div id="orb">original orb</div><div id="start-menu"><input id="start-search"><div id="sm-apps"><button class="sm-app" data-app-id="sentinel">Sentinel AI</button><button class="sm-app" data-app-id="admin" hidden>Private admin</button><button class="sm-app" data-app-id="privacy-policy">Privacy</button></div></div>', { url: 'https://panthorium.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.OS = { config: { accessToken: 'test-token', backendUrl: '' }, state: { user: { id: 'user-1', permissions: ['chat'], roles: ['user'] } }, windows: new Map() };
  w.PanthoriumAuth = { refreshSession: async () => { w.dispatchEvent(new w.Event('panthorium:auth-changed')); return true; } };
  w.PanthoriumWindowManager = { restore() {} };
  let reportedResult = null;
  w.PanthoriumPrivacyPolicy = { openAIReport(target) { reportedResult = target; } };
  w.createWindow = (id, title, html) => {
    const el = d.createElement('div'); el.className = 'window'; el.dataset.id = id; el.innerHTML = '<div class="window-titlebar"></div><div class="window-body">' + html + '</div>'; d.body.append(el); w.OS.windows.set(id, el);
  };
  w.closeWindow = id => { w.OS.windows.get(id)?.remove(); w.OS.windows.delete(id); };
  w.focusWindow = () => {};
  const originalDesktop = d.getElementById('desktop-icons').outerHTML, originalOrb = d.getElementById('orb').outerHTML;
  Object.defineProperty(w, 'localStorage', { get() { throw Error('Cloud Apps must not persist browser data'); } });
  Object.defineProperty(w, 'sessionStorage', { get() { throw Error('Cloud Apps must keep session state in memory'); } });
  let mode = 'success', requests = [], runs = [], pending = null, holdCatalog = null, refreshed = false;
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  w.fetch = async (url, options = {}) => {
    const parsed = new URL(url, w.location.origin), body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path: parsed.pathname, query: parsed.searchParams, options, body });
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (parsed.pathname.endsWith('/catalog')) {
      if (holdCatalog) await holdCatalog;
      return response({ ok: true, catalog: { packs }, readiness: { aiReady: true, storageReady: true, minorProfilesEnabled: false } });
    }
    if (parsed.pathname.endsWith('/sessions')) return response({ ok: true, session: { id: 'session-1', packId: body.packId, scope: body.scope, expiresAt: new Date(Date.now() + 600000).toISOString() } });
    if (parsed.pathname.endsWith('/execute')) {
      if (mode === 'refresh' && !refreshed) { refreshed = true; return response({ ok: false, error: 'expired' }, 401); }
      if (mode === 'error') return response({ ok: false, error: 'quota_exceeded' }, 429);
      const existing = runs.find(r => r.idempotencyKey === body.idempotencyKey);
      if (existing) return response({ ok: true, run: existing });
      const run = { id: 'run-' + (runs.length + 1), packId: 'profession_1', featureId: body.featureId, idempotencyKey: body.idempotencyKey, status: mode === 'slow' || mode === 'account-switch' ? 'running' : 'draft_ready', result: { draft: '<img src=x onerror=alert(1)> draft', sources: [{ id: 'S1', title: 'ข้อมูลของฉัน' }], unknowns: ['ข้อมูลที่ยังขาด'], nextActions: ['ตรวจทาน'], requiresReview: true } };
      runs.unshift(run);
      if (mode === 'slow' || mode === 'account-switch') return new Promise(resolve => { pending = () => resolve(response({ ok: true, run })); });
      return response({ ok: true, run });
    }
    if (parsed.pathname.endsWith('/cancel')) {
      const run = runs.find(r => parsed.pathname.includes('/' + r.id + '/')); run.status = 'cancelled';
      if (pending) { const finish = pending; pending = null; finish(); }
      return response({ ok: true, run });
    }
    if (parsed.pathname.endsWith('/runs')) return response({ ok: true, runs: parsed.searchParams.has('idempotencyKey') ? runs.filter(r => r.idempotencyKey === parsed.searchParams.get('idempotencyKey')) : runs.filter(r => !parsed.searchParams.has('packId') || r.packId === parsed.searchParams.get('packId')) });
    return response({ ok: true, run: runs.find(r => parsed.pathname.endsWith('/' + r.id)) });
  };
  w.eval(read('start-menu-ui.js')); w.PanthoriumStartMenuUI.pinLast('privacy-policy');
  w.eval(read('window-theme-ui.js'));
  w.eval(read('cloud-apps-ui.js')); d.dispatchEvent(new w.Event('DOMContentLoaded'));
  await until(() => d.querySelectorAll('[data-cloud-pack]').length === 31, 'catalog launchers missing');
  assert.equal(d.querySelectorAll('[data-start-group]').length, 4);
  assert.equal(d.getElementById('desktop-icons').outerHTML, originalDesktop, 'desktop stays unchanged');
  assert.equal(d.getElementById('orb').outerHTML, originalOrb, 'orb stays unchanged');
  assert.equal(d.getElementById('sm-apps').lastElementChild.dataset.appId, 'privacy-policy');
  assert.equal(packs.reduce((sum, p) => sum + p.features.length, 0), 186);
  const menu = d.getElementById('sm-apps'), ui = w.PanthoriumStartMenuUI;
  ui.filter(packs.find(p => p.id === 'profession_1').features[0].name, menu);
  assert.equal(d.querySelector('[data-cloud-pack="profession_1"]').dataset.searchHidden, undefined, 'feature keywords find their pack');
  assert.equal(d.querySelector('[data-app-id="admin"]').hidden, true, 'search preserves access restrictions');
  ui.filter('วิชาชีพเฉพาะ', menu);
  assert(d.querySelectorAll('[data-start-group="specialist"] .sm-app:not([data-search-hidden])').length > 0, 'category search finds members');
  ui.filter('', menu);
  await w.PanthoriumCloudApps.open('profession_1');
  await until(() => d.querySelector('.window[data-id="cloud-apps"]').dataset.panthoriumTheme === 'reference-glass', 'new Cloud Apps window must inherit shared reference theme');
  const q = selector => d.querySelector('[data-cloud-apps] ' + selector);
  assert.equal(w.PanthoriumCloudApps.voiceContext(), null, 'selection alone does not invent a server session');
  q('[data-voice-context]').click();
  await until(() => w.PanthoriumCloudApps.voiceContext()?.sessionId === 'session-1', 'voice context requires a server launch session');
  assert.equal(w.PanthoriumCloudApps.voiceContext().packId, 'profession_1');
  assert.equal(w.PanthoriumCloudApps.voiceContext().scope, 'personal');
  assert(!('permissions' in w.PanthoriumCloudApps.voiceContext()));
  q('[data-input]').value = 'ช่วยเตรียมแผนการสอน'; q('[data-add-source]').click();
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert.equal(q('[data-input]').value, 'ช่วยเตรียมแผนการสอน', 'same-account refresh preserves form');
  q('[data-sources] input').value = 'ข้อมูลของฉัน'; q('[data-sources] textarea').value = 'ข้อมูลที่อนุญาต';
  q('[data-form]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => q('[data-result]').textContent.includes('ร่างพร้อม'), 'draft result missing');
  await until(() => !q('[data-execute]').disabled, 'execution did not settle');
  assert.equal(q('[data-result] img'), null, 'model output is rendered as plain text');
  q('[data-report-result]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(reportedResult)), { sourceType: 'cloud_app_run', sourceId: 'run-1' }, 'result report references owned Cloud run without resending output text');
  const request = requests.find(r => r.path.endsWith('/execute'));
  assert.equal(request.body.sources[0].content, 'ข้อมูลที่อนุญาต');
  assert.equal(request.body.featureId, 'profession_1_f1');
  assert.equal(requests.find(r => r.path.endsWith('/sessions')).body.scope, 'personal');
  const firstKey = request.body.idempotencyKey;
  q('[data-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => requests.filter(r => r.path.endsWith('/execute')).length === 2 && !q('[data-execute]').disabled, 'repeat did not settle');
  assert.equal(requests.filter(r => r.path.endsWith('/execute'))[1].body.idempotencyKey, firstKey, 'same payload reuses idempotency key');
  assert.equal(runs.length, 1, 'same payload does not create another run');
  q('[data-scope]').value = 'work'; q('[data-scope]').dispatchEvent(new w.Event('change'));
  assert.equal(w.PanthoriumCloudApps.voiceContext(), null, 'changing private context invalidates the previous server session');
  q('[data-voice-context]').click();
  await until(() => w.PanthoriumCloudApps.voiceContext()?.scope === 'work', 'work context launch missing');
  assert.equal(requests.filter(r => r.path.endsWith('/sessions')).at(-1).body.scope, 'work');
  assert(requests.some(r => r.path.endsWith('/runs') && r.query.get('scope') === 'work'), 'history is scoped');
  assert(q('[data-form]').textContent.includes('ยังไม่แบ่งปัน'), 'private contexts do not claim team sharing');
  q('[data-scope]').value = 'personal'; q('[data-scope]').dispatchEvent(new w.Event('change'));
  mode = 'refresh'; q('[data-input]').value = 'token refresh request'; q('[data-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => refreshed && !q('[data-execute]').disabled, 'authenticated retry did not settle');
  assert.equal(q('[data-input]').value, 'token refresh request', 'real same-account auth event during retry preserves private form');
  mode = 'error'; q('[data-input]').value = 'อีกคำขอ'; q('[data-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => q('[data-status]').textContent.includes('ขีดจำกัด'), 'quota error missing');
  await until(() => !q('[data-execute]').disabled, 'error must unlock form');
  mode = 'slow'; q('[data-input]').value = 'งานที่ต้องยกเลิก'; q('[data-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => pending !== null, 'slow run missing'); q('[data-cancel]').click();
  assert(q('[data-status]').textContent.includes('ยังไม่ยืนยัน'), 'cancel waits for Cloud acknowledgement');
  await until(() => q('[data-result]').textContent.includes('ยกเลิกงานแล้ว'), 'cancellation not confirmed');
  await until(() => !q('[data-execute]').disabled, 'cancel did not settle');
  assert.equal(runs[0].status, 'cancelled');
  const blocked = packs.find(p => p.blocked);
  await w.PanthoriumCloudApps.open(blocked.id);
  assert(q('[data-execute]').disabled, 'minor gate disables execution');
  await w.PanthoriumCloudApps.open('profession_1');
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, value: false });
  const before = requests.length; q('[data-input]').value = 'offline request'; q('[data-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await sleep(10); assert.equal(requests.length, before, 'offline Browser does not accept work');
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, value: true });
  mode = 'account-switch'; q('[data-input]').value = 'private draft'; q('[data-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => pending !== null, 'account swap run missing');
  w.OS.state.user = { id: 'guest:2', roles: ['guest'], permissions: ['chat'] };
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert.equal(d.querySelector('[data-cloud-apps]'), null, 'account swap clears private window immediately');
  assert.equal(d.querySelector('[data-cloud-pack]'), null, 'guest has no Cloud Apps launchers');
  assert.equal(w.PanthoriumCloudApps.voiceContext(), null);
  pending(); pending = null; await sleep(20);
  assert.equal(d.querySelector('[data-cloud-apps]'), null, 'late response cannot render previous account data');
  assert.equal(await w.PanthoriumCloudApps.open('profession_1'), false);
  assert.equal(d.getElementById('desktop-icons').outerHTML, originalDesktop);
  dom.window.close();
  console.log('Cloud Apps UI: 31 packs, 186 features, Start Menu grouping/search/access, cloud-only drafts/history, error/cancel/idempotency, minor/offline gates, and account isolation passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
