const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "sentinel.html"), "utf8");
const start = html.indexOf("function openFiles() {");
const ownerStart = html.indexOf("const ownerId =", start);
const helpersEnd = html.indexOf("const messageFor =", ownerStart);

assert.notEqual(start, -1, "Files window should be present");
assert.ok(ownerStart > start, "Files should resolve an account owner");
assert.ok(helpersEnd > ownerStart, "Files owner helpers should remain before error mapping");

const helperSource = html.slice(ownerStart, helpersEnd);
const createHelpers = new Function("OS", helperSource + "; return { ownerId, isRegistered };");

const accountId = "11111111-1111-4111-8111-111111111111";
const signedIn = createHelpers({ state: { user: { sub: accountId, roles: [] } } });
assert.equal(signedIn.ownerId(), accountId);
assert.equal(signedIn.isRegistered(), true, "registered sessions should enable cloud file actions");

const guestId = "guest:33333333-3333-4333-8333-333333333333";
const guest = createHelpers({ state: { user: { sub: guestId, roles: ["guest"] } } });
assert.equal(guest.ownerId(), guestId);
assert.equal(guest.isRegistered(), false, "Guest sessions must not enable private cloud files");

const idFallback = createHelpers({ state: { user: { id: accountId, roles: [] } } });
assert.equal(idFallback.ownerId(), accountId, "account id fallback should continue to work");

console.log("Cloud Files UI session: registered-account upload gating and Guest denial passed");

(async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body></body>', { url: 'https://panthorium.test', runScripts: 'outside-only' });
  const w = dom.window;
  w.OS = { windows: new Map(), config: { backendUrl: 'https://panthorium.test' }, state: { user: { sub: accountId, roles: [] } } };
  w.createWindow = (id, title, markup) => { w.OS.windows.set(id, true); w.document.body.innerHTML = markup; };
  w.focusWindow = () => {};
  let opened; w.PanthoriumFilePreview = { open: file => { opened = file; } };
  const { folderListing } = require('../services/fileFolders');
  const payload = { ok: true, ...folderListing([{id: '1', name:'photo.png', size:10}, {id:'2',name:'report.xlsx',size:20}]), usedBytes:30,maxBytes:100 };
  let resolveLate;
  w.authorizedFetch = async () => ({ ok:true, json:async()=>payload });
  const end = html.indexOf('// ---------- App: Terminal', start);
  w.eval(html.slice(start, end));
  w.openFiles();
  const tick = () => new Promise(resolve => setTimeout(resolve, 10));
  await tick();
  assert.equal(w.document.querySelectorAll('[data-folder-id]').length, 11);
  w.document.querySelector('[data-folder-id="spreadsheets"]').click();
  assert.match(w.document.querySelector('#files-list').textContent, /report.xlsx/);
  assert.doesNotMatch(w.document.querySelector('#files-list').textContent, /photo.png/);
  w.document.querySelector('[data-files-action="open"]').click();
  assert.equal(opened.name, 'report.xlsx');
  w.document.querySelector('[data-folder-id="videos"]').click();
  assert.match(w.document.querySelector('#files-list').textContent, /ยังไม่มีไฟล์/);
  w.authorizedFetch = () => new Promise(resolve => { resolveLate = resolve; });
  w.document.querySelector('#files-refresh').click(); await tick();
  w.OS.state.user = { sub:'guest:changed', roles:['guest'] };
  w.dispatchEvent(new w.Event('panthorium:auth-changed')); await tick();
  resolveLate({ok:true,json:async()=>payload}); await tick();
  assert.doesNotMatch(w.document.querySelector('#files-list').textContent, /photo.png|report.xlsx/);
  dom.window.close();
  console.log('Cloud Files folders: navigation, empty folders and late-response account isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
