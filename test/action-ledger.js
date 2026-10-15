'use strict';
const assert = require('node:assert/strict');
const { AgentService } = require('../services/agentService');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { AgentFunctionCallingService } = require('../services/agentFunctionCallingService');

async function main() {
  let now = Date.now();
  const ledger = new ActionLedgerRepository({ allowMemory: true, now: () => now, approvalTtlMs: 1000, staleAfterMs: 2000 });
  await ledger.init();
  let effects = 0;
  let received;
  let complete;
  let shouldWait = false;
  let throwAfterEffect = false;
  let throwBeforeEffect = false;
  const tool = { id: 'notes.write', description: 'Save the exact note', permission: 'chat', mutates: true, risk: 'medium', run: async input => {
    if (throwBeforeEffect) { const error = new Error('local_validation_failed'); error.sideEffectNotApplied = true; throw error; }
    received = input; effects++;
    if (shouldWait) await new Promise(resolve => { complete = resolve; });
    if (throwAfterEffect) throw new Error('remote_connection_lost');
    return { saved: input.args.title, effect: effects };
  } };
  const tools = { get: id => id === tool.id ? tool : null, catalog: () => [tool] };
  const service = new AgentService({ tools, ledger });
  const user = { sub: 'owner', permissions: ['chat'] };
  const other = { sub: 'other', permissions: ['chat'] };
  const propose = (requestId, args = { action: 'create', title: 'A' }) => service.execute({ user, toolId: tool.id, args, requestId, confirmed: true });
  const approve = proposal => service.confirmAction({ user, actionId: proposal.actionId, approvalHash: proposal.approvalHash });
  let proposal = await propose('request-1');
  assert.equal(proposal.error, 'confirmation_required', 'model confirmed flag cannot approve');
  assert.equal(effects, 0);
  assert.equal((await propose('request-1', { title: 'A', action: 'create' })).actionId, proposal.actionId, 'argument order does not change identity');
  assert.equal((await propose('request-1', { action: 'create', title: 'B' })).error, 'action_request_conflict');
  assert.equal((await service.confirmAction({ user: other, actionId: proposal.actionId, approvalHash: proposal.approvalHash })).error, 'action_not_found');
  assert.equal((await service.getAction({ user: other, actionId: proposal.actionId })).error, 'action_not_found');
  assert.equal((await service.confirmAction({ user, actionId: proposal.actionId, approvalHash: 'wrong' })).error, 'action_approval_invalid');
  assert.equal((await service.cancelAction({ user: other, actionId: proposal.actionId })).error, 'action_not_found');
  assert.equal(effects, 0);

  const results = await Promise.all(Array.from({ length: 12 }, () => approve(proposal)));
  assert.equal(effects, 1, 'concurrent confirmations execute a single effect');
  assert(results.every(result => result.ok && result.actionState === 'succeeded' && result.runId === proposal.actionId));
  assert.equal(received.requestId, 'request-1');
  assert.equal(received.actionId, proposal.actionId);
  const replay = await propose('request-1');
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.output, results[0].output);
  assert.equal(effects, 1);
  const denied = await service.confirmAction({ user: { ...user, permissions: [] }, actionId: proposal.actionId, approvalHash: proposal.approvalHash });
  assert.equal(denied.error, 'tool_permission_denied', 'current permissions are rechecked even on confirmation');
  const cancelledComplete = await service.cancelAction({ user, actionId: proposal.actionId });
  assert.equal(cancelledComplete.actionState, 'succeeded');
  assert.equal(cancelledComplete.cancellationEffective, false, 'completed effects cannot be rolled back by cancellation');

  const immutableArgs = { action: 'create', title: 'frozen' };
  proposal = await propose('immutable', immutableArgs);
  immutableArgs.title = 'changed-after-proposal';
  assert.equal((await approve(proposal)).output.saved, 'frozen');
  proposal = await propose('expired');
  now += 1001;
  assert.equal((await approve(proposal)).error, 'action_confirmation_expired');
  assert.equal((await propose('expired')).approvalHash, proposal.approvalHash, 'replay cannot extend or change approval');

  proposal = await propose('cancel-before');
  const cancelled = await service.cancelAction({ user, actionId: proposal.actionId });
  assert.equal(cancelled.cancellationEffective, true);
  assert.equal((await approve(proposal)).error, 'action_cancelled');

  shouldWait = true;
  proposal = await propose('cancel-running');
  const inFlight = approve(proposal);
  while (!complete) await new Promise(resolve => setImmediate(resolve));
  const during = await service.cancelAction({ user, actionId: proposal.actionId });
  assert.equal(during.actionState, 'cancel_requested');
  assert.equal(during.cancellationEffective, false);
  complete();
  assert.equal((await inFlight).actionState, 'succeeded', 'eventual successful effect remains success after barge-in');
  shouldWait = false;

  proposal = await propose('lost-worker');
  await ledger.claim(user.sub, proposal.actionId, proposal.approvalHash);
  now += 2001;
  assert.equal((await approve(proposal)).actionState, 'unknown', 'stale running receipt is not re-executed');
  const beforeUnknown = effects;
  assert.equal((await propose('lost-worker')).actionState, 'unknown');
  assert.equal(effects, beforeUnknown);
  throwAfterEffect = true;
  proposal = await propose('lost-effect-response');
  assert.equal((await approve(proposal)).actionState, 'unknown');
  const afterUnknown = effects;
  assert.equal((await approve(proposal)).actionState, 'unknown');
  assert.equal(effects, afterUnknown, 'ambiguous external failure never auto-retries');
  throwAfterEffect = false;

  const normalFinish = ledger.finish.bind(ledger);
  ledger.finish = async () => { throw new Error('database disconnected after side effect'); };
  proposal = await propose('lost-commit');
  assert.equal((await approve(proposal)).actionState, 'unknown');
  const afterLostCommit = effects;
  ledger.finish = normalFinish;
  assert.equal((await approve(proposal)).actionState, 'unknown');
  assert.equal(effects, afterLostCommit);

  ledger.finish = async (...args) => { await normalFinish(...args); throw new Error('commit acknowledgement lost'); };
  proposal = await propose('lost-commit-ack');
  assert.equal((await approve(proposal)).actionState, 'succeeded', 'durable receipt resolves a lost commit acknowledgement');
  ledger.finish = normalFinish;
  throwBeforeEffect = true;
  proposal = await propose('known-no-effect');
  assert.equal((await approve(proposal)).actionState, 'failed');
  assert.equal((await approve(proposal)).error, 'local_validation_failed');
  throwBeforeEffect = false;

  const functionCalling = new AgentFunctionCallingService({ agentService: service });
  const call = { id: 'voice-call', name: 'panthorium_notes_write', args: { action: 'create', title: 'voice' } };
  const pending = await functionCalling.execute({ user, call, requestId: 'session:voice-call', source: 'gemini-live', confirmed: true });
  assert(pending.confirmation.actionId);
  const altered = await functionCalling.confirm({ user, call: { ...call, args: { action: 'create', title: 'altered' } }, ...pending.confirmation });
  assert.equal(altered.error, 'action_request_conflict');
  const confirmed = await functionCalling.confirm({ user, call, ...pending.confirmation });
  assert.equal(confirmed.actionState, 'succeeded');
  assert.equal(confirmed.functionResponse.response.actionState, 'succeeded');
  const cancelProposal = await functionCalling.execute({ user, call: { ...call, id: 'cancel-control' }, requestId: 'session:cancel-control', source: 'gemini-live' });
  assert.equal((await functionCalling.cancel({ user: other, actionId: cancelProposal.actionId })).error, 'action_not_found');
  const cancelledControl = await functionCalling.cancel({ user, actionId: cancelProposal.actionId });
  assert.equal(cancelledControl.actionState, 'cancel_requested');
  assert.equal(cancelledControl.cancellationEffective, true);
  assert.equal((await functionCalling.confirm({ user, call, ...cancelProposal.confirmation })).error, 'action_cancelled');
  assert.equal((await functionCalling.getOutcome({ user: other, actionId: cancelProposal.actionId })).error, 'action_not_found');
  const outcome = await functionCalling.getOutcome({ user, actionId: confirmed.actionId });
  assert.equal(outcome.actionState, 'succeeded');
  assert.equal(outcome.result.output.saved, 'voice');
  assert.equal(Object.prototype.hasOwnProperty.call(outcome, 'approvalHash'), false);
  assert.equal((await functionCalling.cancel({ user, actionId: confirmed.actionId })).cancellationEffective, false);
  assert(!functionCalling.declarationsFor(user, { surface: 'gemini-live' }).some(item => /cancel_action|get_outcome|confirm_action/.test(item.name)));
  assert.equal((await functionCalling.execute({ user, call: { ...call, id: 'x'.repeat(129) }, source: 'gemini-live' })).error, 'invalid_function_call_id');
  assert.equal((await propose('x'.repeat(257))).error, 'invalid_request_id');
  assert.equal((await service.execute({ user, toolId: tool.id, args: {} })).error, 'action_request_id_required');

  const unavailable = new ActionLedgerRepository({ required: true, allowMemory: true });
  await assert.rejects(() => unavailable.init(), /action_ledger_unavailable/);
  const unavailableService = new AgentService({ tools, ledger: unavailable });
  assert.equal((await unavailableService.execute({ user, toolId: tool.id, args: {}, requestId: 'safe' })).error, 'action_ledger_unavailable');
  assert.equal(effects, afterLostCommit + 2, 'only the lost-ack and confirmed voice actions ran');
  console.log('Action ledger tests passed (concurrency, isolation, immutable approval, expiry, cancellation, ambiguous outcome, fail-closed)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
