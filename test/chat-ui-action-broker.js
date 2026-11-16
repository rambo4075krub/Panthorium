'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ChatUiActionBroker } = require('../services/chatUiActionBroker');
const user = { sub: 'owner', sid: 'auth-session', roles: [], permissions: ['chat'] };
function start(broker, overrides = {}) {
  let frame;
  const controller = new AbortController();
  const promise = broker.dispatch({ user, toolId: 'window.open', args: { appId: 'calculator' }, action: 'open_calculator',
    signal: controller.signal, send: value => { frame = value; }, ...overrides });
  return { promise, controller, get frame() { return frame; }, input(extra = {}) { return { user, id: frame.id, nonce: frame.nonce, ...extra }; } };
}
async function main() {
  const broker = new ChatUiActionBroker({ timeoutMs: 100, maxPending: 2 });
  let task = start(broker);
  assert.match(task.frame.nonce, /^[a-f0-9]{64}$/);
  assert.equal(broker.acknowledge(task.input({ result: { ok: true } })).error, 'ui_action_not_claimed');
  for (const override of [{ user: { ...user, sub: 'other' } }, { user: { ...user, sid: 'other-session' } }, { nonce: '0'.repeat(64) }, { nonce: 'x' }, { user: { ...user, permissions: [] } }]) {
    assert.equal(broker.claim(task.input(override)).ok, false);
  }
  assert.deepEqual(broker.claim(task.input()), { ok: true, action: 'open_calculator' });
  assert.equal(broker.claim(task.input()).error, 'ui_action_already_claimed');
  for (const result of [{ ok: 'true' }, { ok: true, secret: 'extra' }, { ok: true, text: 'x'.repeat(241) }, { ok: false, error: 'x'.repeat(121) }, { ok: true, dispatched: false }, { ok: true, confirmationRequired: true }]) {
    assert.equal(broker.acknowledge(task.input({ result })).error, 'invalid_ui_action_result');
  }
  assert.equal(broker.acknowledge(task.input({ user: { ...user, sid: 'wrong' }, result: { ok: true } })).ok, false);
  assert.equal(broker.acknowledge(task.input({ user: { ...user, permissions: [] }, result: { ok: true } })).error, 'ui_action_permission_denied');
  assert.deepEqual(broker.acknowledge(task.input({ result: { ok: true, text: 'opened' } })), { ok: true });
  assert.deepEqual(await task.promise, { ok: true, dispatched: true, text: 'opened', confirmationRequired: false, completed: true });
  assert.equal(broker.acknowledge(task.input({ result: { ok: true } })).error, 'ui_action_not_found');
  assert.equal(broker.pending.size, 0);

  const a = start(broker), b = start(broker);
  assert.notEqual(a.frame.nonce, b.frame.nonce);
  assert.equal(broker.claim(a.input({ nonce: b.frame.nonce })).ok, false, 'parallel streams cannot cross-claim');
  assert.equal((await start(broker).promise).error, 'ui_action_capacity_exceeded');
  a.controller.abort(); b.controller.abort();
  assert.deepEqual(await a.promise, { ok: false, error: 'ui_action_cancelled', dispatched: false });
  await b.promise;
  task = start(broker); broker.claim(task.input()); task.controller.abort();
  assert.deepEqual(await task.promise, { ok: false, error: 'ui_action_outcome_unknown', dispatched: true, reconciliationRequired: true });
  assert.equal(broker.claim(task.input()).ok, false);

  const fast = new ChatUiActionBroker({ timeoutMs: 5 });
  task = start(fast); assert.equal((await task.promise).error, 'ui_action_timeout');
  task = start(fast); fast.claim(task.input()); assert.equal((await task.promise).error, 'ui_action_outcome_unknown');
  assert.equal(fast.pending.size, 0);
  assert.equal((await start(broker, { send() { throw new Error('disconnect'); } }).promise).error, 'ui_action_transport_unavailable');
  assert.equal((await start(broker, { send: async () => { throw new Error('disconnect'); } }).promise).error, 'ui_action_transport_unavailable');
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await start(broker, { signal: aborted.signal }).promise).dispatched, false);

  for (const override of [{ user: { ...user, sid: '' } }, { user: { ...user, sub: 'guest:test' } }, { user: { ...user, roles: ['guest'] } },
    { toolId: 'studio.command' }, { args: { appId: 'security' }, action: 'open_security' }, { action: 'close_calculator' },
    { args: { appId: 'calculator', confirmed: true } }, { args: { appId: 'notes' } }]) {
    assert.equal((await start(broker, override).promise).error, 'ui_action_permission_denied');
  }
  const screen = command => ({ toolId: 'screen.command', args: { command }, action: 'screen_command:' + encodeURIComponent(command) + '#' + randomUUID() });
  assert.equal((await start(broker, screen('ยืนยัน')).promise).ok, false, 'model cannot confirm screen effects');
  task = start(broker, screen('กดปุ่ม บันทึก')); broker.claim(task.input());
  broker.acknowledge(task.input({ result: { ok: true, text: 'review required', confirmationRequired: true, dispatched: false } }));
  const review = await task.promise;
  assert.equal(review.dispatched, false); assert.equal(review.completed, false); assert.equal(review.confirmationRequired, true);
  assert(!JSON.stringify(review).includes(task.frame.nonce), 'model result must not contain acknowledgment credentials');
  task = start(broker, screen('กดปุ่ม บันทึก')); broker.claim(task.input());
  broker.acknowledge(task.input({ result: { ok: true, text: 'click submitted', dispatched: true } }));
  assert.equal((await task.promise).completed, false, 'submitted click cannot certify the underlying business operation');
  task = start(broker, screen('อ่านหน้านี้')); broker.claim(task.input());
  assert.equal(broker.acknowledge(task.input({ result: { ok: true, text: 'x'.repeat(6001) } })).ok, false);
  broker.acknowledge(task.input({ result: { ok: true, text: 'x'.repeat(6000) } }));
  assert.equal((await task.promise).text.length, 6000);
  assert.equal(broker.pending.size, 0);
  console.log('PASS UI action broker: bound principal/nonces, single claim/ack, permissions, strict outcomes, cancellation, timeout, capacity and screen review');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
