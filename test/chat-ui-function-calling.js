'use strict';
const assert = require('node:assert/strict');
const { AgentService } = require('../services/agentService');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentFunctionCallingService } = require('../services/agentFunctionCallingService');
const { withChatUiActions } = require('../services/chatUiFunctionCalling');
const { Sentinel } = require('../services/sentinel');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const user = { sub: 'owner', sid: 'login-session', roles: [], permissions: ['chat'] };
  const base = new AgentFunctionCallingService({ agentService: new AgentService({ tools: new ToolRegistry() }) });
  const uiNames = ['panthorium_window_open', 'panthorium_screen_command'];
  assert(uiNames.every(name => !base.declarationsFor(user).some(d => d.name === name)), 'ordinary non-capable chat stays tool-free for UI effects');
  for (const principal of [{ ...user, sid: '' }, { ...user, sub: 'guest:x' }, { ...user, roles: ['guest'] }]) {
    assert.equal(withChatUiActions(base, { user: principal, broker: {}, send() {} }), base);
  }
  assert.equal(withChatUiActions(base, { user, broker: {}, send() {} }), base, 'missing dispatcher cannot enable tools');
  assert.equal(withChatUiActions(base, { user, broker: { dispatch() {} } }), base, 'missing transport cannot enable tools');
  let pending, submitted;
  const broker = { dispatch(input) { submitted = input; return new Promise(resolve => { pending = resolve; }); } };
  const send = () => {};
  const wrapped = withChatUiActions(base, { user, broker, send });
  assert(uiNames.every(name => wrapped.declarationsFor(user).some(d => d.name === name)));
  assert(!wrapped.declarationsFor({ ...user, permissions: [] }).some(d => d.name === 'panthorium_window_open'));
  const input = { user, source: 'sentinel-chat', requestId: 'synthetic-request', call: { id: 'call-1', name: 'panthorium_window_open', args: { appId: 'calculator' } } };
  let settled = false;
  const promise = wrapped.execute(input).then(result => { settled = true; return result; });
  await tick();
  assert.equal(settled, false, 'no model success before browser acknowledgment');
  assert.equal(submitted.action, 'open_calculator');
  assert.equal(submitted.user.sid, user.sid);
  pending({ ok: true, text: 'opened calculator', completed: true, dispatched: true });
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.output.completed, true);
  assert.equal(result.uiCompletion, 'opened calculator');
  assert(!JSON.stringify(result).includes('nonce'));
  assert(!JSON.stringify(result).includes('open_calculator'), 'raw action command is not presented as observed completion');

  const rejection = await wrapped.execute({ ...input, call: { ...input.call, args: { appId: 'security' } } });
  assert.equal(rejection.ok, false, 'catalog permission remains enforced');
  const screenInput = { ...input, call: { id: 'screen-1', name: 'panthorium_screen_command', args: { command: 'กดปุ่ม บันทึก' } } };
  const reviewPromise = wrapped.execute(screenInput); await tick();
  pending({ ok: true, text: 'review shown', confirmationRequired: true, completed: false, dispatched: false });
  const review = await reviewPromise;
  assert.equal(review.output.completed, false);
  assert.match(review.uiCompletion, /ยังไม่ดำเนินการ/);
  const failedPromise = wrapped.execute(input); await tick();
  pending({ ok: false, error: 'ui_action_outcome_unknown', reconciliationRequired: true });
  const failed = await failedPromise;
  assert.equal(failed.ok, false); assert.match(failed.uiCompletion, /ยังยืนยันผล.*ไม่ได้/);

  let rounds = 0;
  const sentinel = new Sentinel({ gateway: { async complete() {
    rounds++;
    return { ok: true, provider: 'local', functionCalls: [input.call, { ...input.call, id: 'must-not-run' }] };
  } } });
  const complete = sentinel.completeWithFunctionCalls({ history: [], user, userId: user.sub, functionCalling: wrapped, requestId: 'test-turn', systemPrompt: 'Sentinel' });
  await tick();
  assert.equal(rounds, 1);
  pending({ ok: true, text: 'verified browser result', completed: true, dispatched: true });
  const answer = await complete;
  assert.equal(rounds, 1, 'UI receipt terminates the turn without a new model/tool round');
  assert.equal(answer.text, 'verified browser result');
  assert.equal(answer.toolResults.length, 1, 'remaining model calls are not executed after UI completion');
  assert.equal(answer.toolResults[0].output.completed, true);
  console.log('PASS chat UI function wrapper: capability isolation, permissions, acknowledgment ordering, pending/unknown outcomes and bounded Sentinel termination');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
