'use strict';
const assert = require('node:assert/strict');
const { AgentService } = require('../services/agentService');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { AgentFunctionCallingService, TOOL_DEFINITIONS } = require('../services/agentFunctionCallingService');

// Synthetic effects only. Exercise the real proposal/confirmation/receipt path,
// without connecting to accounts, sending messages or modifying user data.
const ids = ['calendar.write', 'goals.write', 'notes.write', 'memory.write',
  'reminders.write', 'files.write', 'knowledge.write', 'social.write',
  'conversation.clear', 'media.video.plan_edit', 'media.video.ai_edit',
  'media.video.generate', 'media.video.transcribe', 'media.video.render'];
async function main() {
  let now = Date.now();
  const ledger = new ActionLedgerRepository({ allowMemory: true, now: () => now });
  await ledger.init();
  const effects = [];
  const entries = ids.map(id => ({ id, permission: 'chat', risk: 'high', mutates: true,
    requiresConfirmation: true, description: `Synthetic ${id}`,
    validateArgs: args => Object.keys(args).every(k => ['value', 'outcome'].includes(k)) &&
      typeof args.value === 'string' ? null : 'invalid_tool_args',
    async run({ user, args }) {
      effects.push({ id, owner: user.sub, args: structuredClone(args) });
      if (args.outcome === 'failed') return { ok: false, error: 'synthetic_failure', sideEffectNotApplied: true };
      if (args.outcome === 'unknown') throw new Error('synthetic_uncertain_effect');
      return { saved: args.value };
    }
  }));
  const registry = { catalog: () => entries, get: id => entries.find(t => t.id === id) };
  const agent = new AgentService({ tools: registry, ledger });
  const functions = new AgentFunctionCallingService({ agentService: agent });
  const owner = { sub: 'chat-owner', roles: [], permissions: ['chat'] };
  const other = { ...owner, sub: 'other-owner' };
  const revoked = { ...owner, permissions: [] };
  const names = new Map(TOOL_DEFINITIONS.map(t => [t.toolId, t.name]));
  let sequence = 0;
  const propose = (id, args = { value: 'exact synthetic payload' }) => functions.execute({
    user: owner, source: 'sentinel-chat', requestId: `chat-action-test-${++sequence}`,
    confirmed: true, // Even a model's forged true flag cannot skip the ledger.
    call: { id: `call-${sequence}`, name: names.get(id), args }
  });
  const approve = (pending, user = owner, approvalHash = pending.confirmation.approvalHash) =>
    agent.confirmAction({ user, actionId: pending.actionId, approvalHash });

  for (const id of ids) {
    assert(functions.declarationsFor(owner).some(t => t.name === names.get(id)), `${id} available with approval support`);
    const noLedger = new AgentFunctionCallingService({ agentService: new AgentService({ tools: registry }) });
    assert(!noLedger.declarationsFor(owner).some(t => t.name === names.get(id)), `${id} requires durable ledger`);
    assert(!functions.declarationsFor(revoked).some(t => t.name === names.get(id)), `${id} remains permission scoped`);
    assert(!functions.declarationsFor({ ...owner, sub: 'guest:test', roles: ['guest'] }).some(t => t.name === names.get(id)), `${id} requires an account`);
    const before = effects.length;
    const pending = await propose(id);
    assert.equal(pending.requiresConfirmation, true, id);
    assert.equal(pending.ok, false, id);
    assert.equal(effects.length, before, `${id} never runs before approval`);
    assert.equal(pending.confirmation.toolId, id);
    assert.deepEqual(pending.confirmation.args, { value: 'exact synthetic payload' });
    const result = await approve(pending);
    assert.equal(result.ok, true, id);
    assert.equal(result.actionState, 'succeeded');
    assert.equal(effects.length, before + 1);
    assert.equal(effects.at(-1).owner, owner.sub);
    assert.deepEqual(effects.at(-1).args, pending.confirmation.args);
    const replay = await approve(pending);
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(effects.length, before + 1, `${id} replay cannot duplicate effect`);
  }

  const pending = await propose('notes.write');
  const before = effects.length;
  assert.equal((await approve(pending, other)).error, 'action_not_found');
  assert.equal((await approve(pending, revoked)).error, 'tool_permission_denied');
  assert.equal((await approve(pending, owner, '0'.repeat(64))).error, 'action_approval_invalid');
  const altered = await functions.confirm({ user: owner, source: 'sentinel-chat',
    actionId: pending.actionId, approvalHash: pending.confirmation.approvalHash,
    call: { name: names.get('notes.write'), args: { value: 'tampered' } } });
  assert.equal(altered.error, 'action_request_conflict');
  assert.equal(effects.length, before, 'wrong owner, revoked permission and payload/hash tampering never execute');
  const cancelled = await agent.cancelAction({ user: owner, actionId: pending.actionId });
  assert.equal(cancelled.cancellationEffective, true);
  assert.equal((await approve(pending)).error, 'action_cancelled');
  assert.equal(effects.length, before);

  const expired = await propose('calendar.write');
  now += 6 * 60 * 1000;
  assert.equal((await approve(expired)).error, 'action_confirmation_expired');
  assert.equal(effects.length, before);

  const failed = await propose('files.write', { value: 'fixture', outcome: 'failed' });
  const failure = await approve(failed);
  assert.equal(failure.ok, false);
  assert.equal(failure.error, 'synthetic_failure');
  assert.equal(failure.actionState, 'failed');
  const afterFailure = effects.length;
  assert.equal((await approve(failed)).ok, false);
  assert.equal(effects.length, afterFailure, 'failed actions must not be retried by confirmation replay');
  const unknown = await propose('social.write', { value: 'fixture', outcome: 'unknown' });
  assert.equal((await approve(unknown)).actionState, 'unknown');
  const afterUnknown = effects.length;
  assert.equal((await approve(unknown)).reconciliationRequired, true);
  assert.equal(effects.length, afterUnknown, 'uncertain outcomes require reconciliation, not retry');
  // The chat orchestration must hand the frozen proposal to the UI and stop
  // before asking the model for a misleading completed-action response.
  let modelCalls = 0;
  const sentinel = new (require('../services/sentinel').Sentinel)({ gateway: { complete: async () => {
    modelCalls++;
    return { ok: true, provider: 'local', functionCalls: [{ id: 'note-ui', name: names.get('notes.write'), args: { value: 'review before saving' } }] };
  } } });
  const beforeChat = effects.length;
  const chat = await sentinel.completeWithFunctionCalls({ history: [], user: owner, requestId: 'chat-proposal', functionCalling: functions });
  assert.equal(modelCalls, 1);
  assert.equal(effects.length, beforeChat);
  assert.equal(chat.toolResults[0].requiresConfirmation, true);
  assert.equal(chat.toolResults[0].confirmation.args.value, 'review before saving');
  assert.equal(chat.toolResults[0].actionId, chat.toolResults[0].confirmation.actionId);
  console.log('PASS chat actions: account-scoped declarations, exact approval, cancellation, expiry, replay, revocation and failure receipts');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
