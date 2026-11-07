'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), { JSDOM } = require('jsdom');
const settle = async () => { for (let n = 0; n < 10; n++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const source = fs.readFileSync('user-mailbox-ui.js', 'utf8');
function fixture() {
  const dom = new JSDOM('<div id="sm-apps"></div>', { runScripts: 'outside-only', url: 'https://panthorium.example/', pretendToBeVisual: true }), w = dom.window;
  const requests = [], spoken = [], pendingLists = new Map(), pendingReads = new Map();
  let confirmResponse, delayedJson, profiles = [{ id: 'google:owner', provider: 'google', email: 'owner@workspace.example', purpose: 'standard' }];
  const mail = id => ({ id, subject: 'Mail ' + id, from: 'sender@example.com', replyTo: 'sender@example.com', text: 'body ' + id, date: '2026-11-07', folders: ['Label_work'], attachments: [{ id: 'a1', name: 'notes.txt', size: 5 }] });
  w.OS = { state: { user: { sub: 'owner', roles: ['user'], permissions: ['chat'] } }, config: { backendUrl: 'https://panthorium.example', accessToken: 'fixture' }, windows: new Map() };
  w.setInterval = () => 0;
  w.createWindow = (id, title, html) => { const node = w.document.createElement('div'); node.innerHTML = html; w.document.body.append(node); w.OS.windows.set(id, node); };
  w.closeWindow = id => { w.OS.windows.get(id)?.remove(); w.OS.windows.delete(id); };
  w.speechSynthesis = { cancel() {}, speak(u) { spoken.push(u.text); u.onend?.(); } };
  w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  w.fetch = async (input, options = {}) => {
    const url = new URL(input), body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path: url.pathname, query: url.searchParams, body });
    if (url.pathname.endsWith('/status')) return Response.json({ enabled: true, email: 'owner@workspace.example', providers: ['google', 'microsoft'], agentProviders: [], aiEnabled: false, connections: profiles, onboardingRequired: !profiles.length });
    if (url.pathname.endsWith('/prepare')) return Response.json({ proposalId: 'proposal', preview: { ...body, account: 'owner@workspace.example', subject: body.subject || body.expectedSubject, sourceFolder: 'Work', folder: 'Archive', from: 'sender@example.com', date: '2026-11-07', attachments: (body.attachments || []).map(a => ({ ...a, name: 'notes.txt', bytes: 5 })) } });
    if (url.pathname.endsWith('/confirm')) return confirmResponse ? confirmResponse.promise : Response.json({ status: 'accepted' });
    if (url.pathname.endsWith('/drafts')) return Response.json({ items: [{ subject: 'Saved draft', to: ['receiver@example.com'], cc: ['cc@example.com'], text: 'Draft body', attachments: [{ messageId: '1', attachmentId: 'a1', name: 'notes.txt', bytes: 5 }] }] });
    if (url.searchParams.get('action') === 'folders') return Response.json({ items: [{ id: 'INBOX', name: 'Inbox' }, { id: 'Label_work', name: 'Work' }, { id: 'Label_archive', name: 'Archive' }, { id: 'TRASH', name: 'Trash' }] });
    if (url.searchParams.get('action') === 'get') {
      const id = url.searchParams.get('messageId');
      if (delayedJson) return { ok: true, json: () => delayedJson.promise };
      return pendingReads.get(id)?.promise || Response.json({ message: mail(id) });
    }
    const query = url.searchParams.get('query');
    return pendingLists.get(query)?.promise || Response.json({ items: [mail('1'), mail('2')], complete: true });
  };
  const find = label => [...w.document.querySelectorAll('button')].find(b => b.textContent === label);
  const click = async label => { const b = find(label); assert(b, 'button exists: ' + label); b.click(); await settle(); return b; };
  const field = (name, value) => { const el = w.document.querySelector('[aria-label="' + name + '"]'); assert(el, name); el.value = value; return el; };
  w.eval(source);
  return { dom, w, requests, spoken, pendingLists, pendingReads, mail, find, click, field, setProfiles: value => { profiles = value; }, setConfirm: value => { confirmResponse = value; }, setJson: value => { delayedJson = value; } };
}
(async () => {
  let f = fixture();
  try {
    f.setProfiles([{ id: 'legacy', provider: 'microsoft', email: 'owner@workspace.example' }]);
    await f.w.PanthoriumUserMailbox.open();
    assert(f.w.document.body.textContent.includes('ผู้ที่ไม่มีกล่อง Gmail ไม่สามารถใช้ฟังก์ชันนี้ได้'));
    assert(f.find('เชื่อม Gmail / Google Workspace'));
    assert(!f.find('เขียนอีเมล'));
    assert(!f.w.document.body.textContent.includes('Outlook'));
  } finally { f.dom.window.close(); }

  f = fixture();
  try {
    await f.w.PanthoriumUserMailbox.open();
    await f.click('เขียนอีเมล');
    f.field('ถึง', 'receiver@example.com'); f.field('สำเนา (Cc)', 'copy@example.com'); f.field('สำเนาลับ (Bcc)', 'private@example.com');
    f.field('หัวข้อ', 'ทดสอบ <img src=x onerror=alert(1)>'); f.field('เนื้อหา', 'เนื้อหาที่ต้องตรวจ\nบรรทัดสอง');
    await f.click('ตรวจและส่ง');
    let detail = f.w.document.querySelector('[data-detail]');
    assert(detail.textContent.includes('owner@workspace.example'));
    for (const value of ['receiver@example.com', 'copy@example.com', 'private@example.com', 'เนื้อหาที่ต้องตรวจ']) assert(detail.textContent.includes(value));
    assert(!detail.querySelector('img')); assert(!detail.textContent.includes('"connectionId"')); assert(!detail.textContent.includes('"action"'));
    await f.click('อ่านรายละเอียดให้ฟัง'); assert(f.spoken.join('').includes('สำเนาลับ (Bcc): private@example.com'));
    await f.click('ยกเลิก'); assert.equal(f.requests.filter(r => r.path.endsWith('/confirm')).length, 0);

    // Draft recipients/body and source attachments survive reopening and re-review.
    await f.click('ฉบับร่าง'); await f.click('Saved draft');
    assert.equal(f.w.document.querySelector('input[type=checkbox]').checked, true);
    await f.click('ตรวจและส่ง');
    const prepared = f.requests.filter(r => r.path.endsWith('/prepare')).at(-1).body;
    assert.deepEqual(prepared.attachments, [{ messageId: '1', attachmentId: 'a1' }]);
    assert.equal(prepared.text, 'Draft body'); assert.deepEqual(prepared.cc, ['cc@example.com']);
    const pending = deferred(); f.setConfirm(pending);
    const confirm = f.find('ยืนยันส่งอีเมล'); confirm.click(); confirm.click(); await settle();
    assert.equal(f.requests.filter(r => r.path.endsWith('/confirm')).length, 1, 'double-click submits once');
    assert(confirm.disabled); assert(f.find('ยกเลิก').disabled);
    pending.resolve(Response.json({ status: 'accepted' })); await settle();
    assert(f.w.document.querySelector('[role=status]').textContent.includes('ยังไม่ได้ยืนยันว่าผู้รับได้รับ'));

    await f.click('Mail 1\nsender@example.com');
    assert.equal(f.w.document.querySelector('[aria-label="ป้ายต้นทาง"]').value, 'Label_work', 'source is actual message label, not guessed Inbox');
    f.field('โฟลเดอร์ปลายทาง', 'Label_archive'); await f.click('ย้าย');
    assert.equal(f.requests.filter(r => r.path.endsWith('/prepare')).at(-1).body.sourceFolderId, 'Label_work');
    assert(f.w.document.querySelector('[data-detail]').textContent.includes('ป้ายต้นทางWork'));
    assert(f.find('ยืนยันย้ายอีเมล'));
  } finally { f.dom.window.close(); }

  f = fixture();
  try {
    await f.w.PanthoriumUserMailbox.open();
    // Two searches return in reverse order; the latest query must win.
    const old = deferred(), newest = deferred(); f.pendingLists.set('old', old); f.pendingLists.set('new', newest);
    const search = f.field('ค้นหาอีเมล', 'old'); search.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter' }));
    search.value = 'new'; search.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter' }));
    newest.resolve(Response.json({ items: [{ ...f.mail('new'), subject: 'Latest result' }], complete: true })); await settle();
    old.resolve(Response.json({ items: [{ ...f.mail('old'), subject: 'Obsolete result' }], complete: true })); await settle();
    assert(f.w.document.querySelector('[data-list]').textContent.includes('Latest result'));
    assert(!f.w.document.querySelector('[data-list]').textContent.includes('Obsolete result'));

    await f.w.PanthoriumUserMailbox.refresh();
    const delayed = deferred(); f.pendingReads.set('1', delayed);
    f.find('Mail 1\nsender@example.com').click(); await settle();
    await f.click('Mail 2\nsender@example.com');
    delayed.resolve(Response.json({ message: f.mail('1') })); await settle();
    assert(f.w.document.querySelector('[data-detail]').textContent.includes('body 2'));
    assert(!f.w.document.querySelector('[data-detail]').textContent.includes('body 1'));

    // Switching accounts during body decoding must discard the old account's result too.
    const json = deferred(); f.setJson(json);
    f.find('Mail 2\nsender@example.com').click(); await settle();
    f.w.OS.state.user = { sub: 'guest:new', roles: ['guest'] }; await f.w.PanthoriumUserMailbox.authChanged();
    json.resolve({ message: { ...f.mail('2'), text: 'PRIVATE OLD ACCOUNT BODY' } }); await settle();
    assert(!f.w.document.body.textContent.includes('PRIVATE OLD ACCOUNT BODY'));
    assert(!f.w.document.querySelector('[data-user-mailbox]'));
  } finally { f.dom.window.close(); }

  f = fixture();
  try {
    await f.w.PanthoriumUserMailbox.open(); await f.click('ฉบับร่าง'); await f.click('Saved draft'); await f.click('ตรวจและส่ง');
    const pending = deferred(); f.setConfirm(pending); const confirm = f.find('ยืนยันส่งอีเมล'); confirm.click(); await settle();
    pending.reject(Error('network lost')); await settle();
    assert(f.w.document.querySelector('[role=status]').textContent.includes('ตรวจผลใน Gmail'));
    confirm.click(); await settle(); assert.equal(f.requests.filter(r => r.path.endsWith('/confirm')).length, 1, 'uncertain sends never retry automatically');
  } finally { f.dom.window.close(); }
  console.log('Mailbox UI stability: Gmail-only, readable exact review, speech/cancel/double-click, draft attachments, correct source labels, stale responses and account cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
