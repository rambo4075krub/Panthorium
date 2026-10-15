'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { AgentService } = require('../services/agentService');
const { AgentWorkflowService } = require('../services/agentWorkflowService');
const { AgentPlannerService } = require('../services/agentPlannerService');
const { AgentRunRepository } = require('../services/agentRunRepository');
const { AgentPendingRepository } = require('../services/agentPendingRepository');
const { createApiRouter } = require('../routes/api');

async function main() {
  const ledger = new ActionLedgerRepository({ allowMemory: true }); await ledger.init();
  const effects = [];
  const tool = { id: 'notes.write', description: 'Write an exact note', permission: 'chat', mutates: true, risk: 'medium', run: async ({ args, requestId }) => { effects.push({ title: args.title, requestId }); return { title: args.title }; } };
  const agentService = new AgentService({ ledger, tools: { get: id => id === tool.id ? tool : null, catalog: () => [tool] } });
  const user = { sub: 'owner', roles: ['administrator'], permissions: ['chat'] };
  const runs = new AgentRunRepository(); const pendingStore = new AgentPendingRepository();
  let plans = 0;
  const gateway = { complete: async () => { plans++; return { ok: true, text: JSON.stringify({ steps: [{ toolId: tool.id, args: { title: 'First' } }, { toolId: tool.id, args: { title: 'Second' } }] }) }; } };
  const workflow = new AgentWorkflowService({ agentService, gateway, runs, pendingStore });
  const initial = await workflow.run({ user, request: 'save two', requestId: 'stable-workflow' });
  assert(initial.pendingStep.actionId);
  assert.equal(effects.length, 0);
  const replayInitial = await workflow.run({ user, request: 'save two', requestId: 'stable-workflow' });
  assert.equal(replayInitial.workflowId, initial.workflowId);
  assert.equal(replayInitial.pendingStep.actionId, initial.pendingStep.actionId);
  assert.equal(plans, 1, 'initial retry reuses the persisted plan');
  assert.equal((await workflow.run({ user, request: 'a different command', requestId: 'stable-workflow' })).error, 'action_request_conflict');
  assert.equal((await workflow.confirm({ user, workflowId: initial.workflowId })).error, 'action_approval_invalid');
  assert.equal((await workflow.confirm({ user: { ...user, sub: 'other' }, workflowId: initial.workflowId, ...initial.pendingStep })).error, 'workflow_permission_denied');

  const restored = new AgentWorkflowService({ agentService, gateway: { complete: async () => { throw new Error('must not replan'); } }, runs, pendingStore });
  const resumed = await Promise.all(Array.from({ length: 4 }, () => restored.confirm({ user, workflowId: initial.workflowId, actionId: initial.pendingStep.actionId, approvalHash: initial.pendingStep.approvalHash })));
  assert(resumed.every(result => result.confirmationRequired));
  assert.equal(effects.length, 1);
  assert.equal(effects[0].requestId, `${initial.workflowId}:0`);
  const next = resumed[0];
  assert.notEqual(next.pendingStep.actionId, initial.pendingStep.actionId);
  assert.equal((await restored.confirm({ user, workflowId: initial.workflowId, actionId: initial.pendingStep.actionId, approvalHash: initial.pendingStep.approvalHash })).error, 'action_approval_invalid', 'an old approval cannot authorize the next step');
  const done = await restored.confirm({ user, workflowId: initial.workflowId, actionId: next.pendingStep.actionId, approvalHash: next.pendingStep.approvalHash });
  assert.equal(done.completed, true);
  assert.deepEqual(effects.map(effect => effect.title), ['First','Second']);
  const replayDone = await restored.confirm({ user, workflowId: initial.workflowId, actionId: next.pendingStep.actionId, approvalHash: next.pendingStep.approvalHash });
  assert.equal(replayDone.replayed, true);
  assert.equal(effects.length, 2);

  const cancelled = await workflow.run({ user, request: 'cancel this', requestId: 'cancel-workflow' });
  const cancelResult = await workflow.cancel({ user, workflowId: cancelled.workflowId });
  assert.equal(cancelResult.cancelled, true);
  await workflow.confirm({ user, workflowId: cancelled.workflowId, actionId: cancelled.pendingStep.actionId, approvalHash: cancelled.pendingStep.approvalHash });
  assert.equal(effects.length, 2, 'cancelled pending workflow does not run its action');

  let plannerCalls = 0;
  let plannedTitle = 'Frozen planner note';
  const planner = new AgentPlannerService({ agentService, gateway: { complete: async () => { plannerCalls++; return { ok: true, text: JSON.stringify({ action: 'tool', toolId: tool.id, args: { title: plannedTitle } }) }; } } });
  const proposal = await planner.run({ user, request: 'save a note', requestId: 'stable-planner' });
  assert.equal(proposal.confirmationRequired, true);
  plannedTitle = 'Changed model response';
  const plannerRetry = await planner.run({ user, request: 'save a note', requestId: 'stable-planner' });
  assert.equal(plannerCalls, 1);
  assert.equal(plannerRetry.actionId, proposal.actionId);
  const confirmed = await planner.run({ user, actionId: proposal.actionId, approvalHash: proposal.confirmation.approvalHash });
  assert.equal(confirmed.execution.output.title, 'Frozen planner note');
  assert.equal(plannerCalls, 1, 'confirmation never calls the planner');

  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.requestId = 'server-generated'; next(); });
  const auth = { verifyAccessToken: token => token === 'other' ? { ...user, sub: 'other' } : user };
  app.use('/api', createApiRouter({}, auth, { record() {} }, {}, agentService, planner, workflow, runs, {}));
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const post = async (path, body, token = 'owner') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await post('/agent/execute', { toolId: tool.id, args: { title: 'HTTP' } })).body.error, 'action_request_id_required');
    assert.equal((await post('/agent/execute', { toolId: tool.id, args: {}, requestId: 'http-bypass', confirmed: true })).body.error, 'immutable_action_confirmation_required');
    const pending = await post('/agent/execute', { toolId: tool.id, args: { title: 'HTTP' }, requestId: 'http-action' });
    assert.equal(pending.status, 409);
    const approval = { actionId: pending.body.actionId, approvalHash: pending.body.approvalHash };
    assert.equal((await post('/agent/execute', { ...approval, args: { title: 'replacement' } })).status, 400);
    assert.equal((await post('/agent/execute', approval, 'other')).status, 404);
    assert.equal((await post('/agent/execute', approval)).status, 200);
    assert.equal((await post('/agent/execute', { toolId: tool.id, args: { title: 'HTTP' }, requestId: 'http-action' })).body.replayed, true);
    assert.equal(effects.filter(effect => effect.title === 'HTTP').length, 1);
    assert.equal((await post('/agent/workflow/run', { request: 'a workflow' })).body.error, 'action_request_id_required');
    const workflowHttp = await post('/agent/workflow/run', { request: 'a workflow', requestId: 'http-workflow' });
    assert.equal(workflowHttp.status, 409);
    const missing = await post(`/agent/workflow/${workflowHttp.body.workflowId}/confirm`, {});
    assert.equal(missing.body.error, 'action_approval_invalid');
    const step = workflowHttp.body.pendingStep;
    const stepHttp = await post(`/agent/workflow/${workflowHttp.body.workflowId}/confirm`, { actionId: step.actionId, approvalHash: step.approvalHash });
    assert.equal(stepHttp.status, 409);
    assert.equal(stepHttp.body.pendingStep.index, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('Durable workflow/planner/API confirmation tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
