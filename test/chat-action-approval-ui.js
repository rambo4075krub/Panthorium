'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { await tick(); await tick(); };
const ids = ['calendar.write', 'goals.write', 'notes.write', 'memory.write', 'reminders.write',
  'files.write', 'knowledge.write', 'social.write', 'conversation.clear', 'media.video.plan_edit',
  'media.video.ai_edit', 'media.video.generate', 'media.video.transcribe', 'media.video.render'];
async function main() {
  const dom = new JSDOM('<div id="chat-messages"></div>', { url: 'https://panthorium.test', runScripts: 'outside-only' });
  const w = dom.window;
  const owner = { id: 'owner', roles: ['user'], permissions: ['chat'] };
  w.OS = { config: { backendUrl: '' }, state: { user: owner } };
  w.callAI = async () => ({});
  const calls = [], responses = [];
  w.authorizedFetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: true, json: async () => typeof next === 'function' ? next() : next };
  };
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'action-presentation.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'ai-stream-client.js'), 'utf8'));
  let counter = 1;
  const proposal = (toolId, args = { action: 'create', title: 'Synthetic item' }, overrides = {}) => ({
    toolId, ok: false, requiresConfirmation: true,
    confirmation: { toolId, actionId: '123e4567-e89b-42d3-a456-' + String(counter++).padStart(12, '0'),
      approvalHash: 'a'.repeat(64), approvalExpiresAt: new Date(Date.now() + 60000).toISOString(), args, ...overrides }
  });
  const show = (result, accountId = 'owner') => {
    w.dispatchEvent(new w.CustomEvent('panthorium:ai-done', { detail: { accountId, toolResults: [result] } }));
    return w.document.querySelector('[data-notification-approval="' + result.confirmation.actionId + '"]');
  };
  const button = (card, text) => [...card.querySelectorAll('button')].find(b => b.textContent === text);
  try {
    for (const id of ids) {
      const args = { action: 'create', title: 'Full synthetic title', content: 'x'.repeat(13000) + 'UNTRUNCATED-END', nested: { numbers: [1, 2], exact: '<img src=x onerror=alert(1)><script>bad()</script>' } };
      const request = proposal(id, args), count = calls.length;
      const card = show(request);
      assert(card, id + ' creates a review card');
      show(request);
      assert.equal(w.document.querySelectorAll('[data-notification-approval="' + request.confirmation.actionId + '"]').length, 1);
      assert.equal(calls.length, count, 'rendering must never execute');
      assert.equal(card.querySelector('pre').textContent, JSON.stringify(args, null, 2), id + ' displays every exact frozen field');
      assert(!card.querySelector('img,script'), 'untrusted payload is text, not HTML');
      assert(!card.textContent.includes('approvalHash'));
      responses.push({ ok: true, actionState: 'succeeded', output: id.startsWith('media.') ? { status: 'queued', jobId: 'synthetic-job' } : { saved: true } });
      const approve = button(card, 'ยืนยัน'); approve.click(); approve.click();
      await settle();
      assert.equal(calls.length, count + 1, 'double click executes only once');
      assert.deepEqual(calls.at(-1), { url: '/api/actions/' + request.confirmation.actionId + '/confirm', method: 'POST', body: { approvalHash: 'a'.repeat(64) } });
      assert(!card.querySelector('button'), 'finished proposal cannot be replayed');
      if (id.startsWith('media.')) {
        assert.match(card.textContent, /queued/);
        assert.match(card.textContent, /งานที่เข้าคิวยังไม่ถือว่าเสร็จ/);
      }
    }
    let request = proposal('notes.write'), card = show(request), before = calls.length;
    responses.push({ ok: true, cancellationEffective: true });
    button(card, 'ยกเลิก').click(); await settle();
    assert.deepEqual(calls.at(-1), { url: '/api/actions/' + request.confirmation.actionId + '/cancel', method: 'POST', body: {} });
    assert.match(card.textContent, /ยกเลิกคำขอแล้ว/);
    assert.equal(calls.length, before + 1);

    card = show(proposal('notes.write'));
    responses.push({ ok: true, cancellationEffective: false, actionState: 'running', result: null });
    button(card, 'ยกเลิก').click(); await settle();
    assert.match(card.textContent, /ยังยืนยันผลไม่ได้/);
    assert(!button(card, 'ตรวจผลการดำเนินการ').hidden, 'acknowledged cancellation is not proof that a running effect stopped');

    request = proposal('files.write'); card = show(request);
    responses.push({ ok: false, error: 'action_in_progress', actionState: 'running' });
    button(card, 'ยืนยัน').click(); await settle();
    assert.match(card.textContent, /ยังยืนยันผลไม่ได้/);
    assert(button(card, 'ยืนยัน').disabled);
    assert(!button(card, 'ตรวจผลการดำเนินการ').hidden);
    responses.push({ ok: true, action: { state: 'unknown', result: null } });
    button(card, 'ตรวจผลการดำเนินการ').click(); await settle();
    assert.equal(calls.at(-1).method, 'GET'); assert.equal(calls.at(-1).body, undefined);
    assert.match(card.textContent, /ยังยืนยันผลไม่ได้/);
    responses.push({ ok: true, action: { state: 'failed', result: { ok: false, error: 'synthetic_failure' } } });
    button(card, 'ตรวจผลการดำเนินการ').click(); await settle();
    assert.match(card.textContent, /ดำเนินการไม่สำเร็จ/);
    assert(!card.querySelector('button'));

    card = show(proposal('social.write'));
    responses.push(new Error('lost response'));
    button(card, 'ยืนยัน').click(); await settle();
    assert.match(card.textContent, /ยังยืนยันผลไม่ได้/); assert(button(card, 'ยืนยัน').disabled);
    responses.push({ ok: false, error: 'action_outcome_unknown', reconciliationRequired: true });
    button(card, 'ตรวจผลการดำเนินการ').click(); await settle();
    assert.match(card.textContent, /ยังยืนยันผลไม่ได้/);

    assert.equal(show(proposal('notes.write', { truncated: true, preview: 'missing fields' })), null, 'truncated approval fails closed');
    assert.equal(show(proposal('notes.write'), 'other'), null, 'foreign-account proposal is not rendered');
    assert.equal(show(proposal('window.open')), null, 'window actions remain outside this patch');
    card = show(proposal('notes.write', {}, { approvalExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    assert(button(card, 'ยืนยัน').disabled);
    const stale = show(proposal('notes.write')), staleApprove = button(stale, 'ยืนยัน');
    before = calls.length;
    w.OS.state.user = { ...owner, id: 'other' };
    staleApprove.click(); await settle();
    assert.equal(calls.length, before, 'account switch blocks stale click even before event');
    w.dispatchEvent(new w.Event('panthorium:auth-changed'));
    assert.equal(w.document.querySelectorAll('[data-notification-approval]').length, 0);
    assert.equal(show(proposal('notes.write'), 'owner'), null, 'late old-account response rejected');
    w.OS.state.user = owner;
    const inflight = show(proposal('notes.write'));
    let releaseResponse;
    responses.push(() => new Promise(resolve => { releaseResponse = resolve; }));
    button(inflight, 'ยืนยัน').click(); await settle();
    w.OS.state.user = { ...owner, id: 'other' };
    w.dispatchEvent(new w.Event('panthorium:auth-changed'));
    releaseResponse({ ok: true, output: { secret: 'OLD-ACCOUNT-RESULT' } });
    await settle();
    assert(!w.document.body.textContent.includes('OLD-ACCOUNT-RESULT'), 'late completion after auth change cannot leak prior-account output');
    w.OS.state.user = { ...owner, permissions: [] };
    assert.equal(show(proposal('notes.write')), null, 'revoked chat permission cannot render');
    w.OS.state.user = { ...owner, id: 'guest:test', roles: ['guest'] };
    assert.equal(show(proposal('notes.write'), 'guest:test'), null, 'guest cannot render account action');
  } finally { dom.window.close(); }
  console.log('PASS generic chat approval UI: all 14 tools, exact full payload, no implicit effects, replay guard, cancellation, outcomes, account isolation and XSS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
