const assert = require('assert');
const { AgentWorkflowService } = require('../services/agentWorkflowService');

(async () => {
  const events = [];
  const tools = [
    { id: 'read.one', description: 'read', mutates: false, requiresConfirmation: false },
    { id: 'write.one', description: 'write', mutates: true, requiresConfirmation: true }
  ];
  const agentService = {
    catalogFor: () => tools,
    async execute({ user, toolId, confirmed }) {
      if (toolId === 'write.one' && !confirmed) return { ok: false, error: 'confirmation_required' };
      return { ok: true, toolId, output: { user: user.sub, toolId }, durationMs: 1 };
    }
  };
  const gateway = {
    async complete() {
      return { ok: true, provider: 'mock', model: 'mock', text: JSON.stringify({ steps: [
        { toolId: 'read.one', args: {}, reason: 'first' },
        { toolId: 'write.one', args: { value: 1 }, reason: 'second' }
      ], answer: 'done' }) };
    }
  };
  const audit = { record: (event, data) => events.push({ event, data }) };
  const service = new AgentWorkflowService({ agentService, gateway, audit, ttlMs: 60000 });
  const user = { sub: 'u1', permissions: ['chat'] };

  const first = await service.run({ user, request: 'do two things', requestId: 'r1' });
  assert.equal(first.ok, true);
  assert.equal(first.confirmationRequired, true);
  assert.equal(first.results.length, 1);
  assert.equal(first.pendingStep.toolId, 'write.one');

  const denied = await service.confirm({ user: { sub: 'u2' }, workflowId: first.workflowId, requestId: 'r2' });
  assert.equal(denied.error, 'workflow_permission_denied');

  const resumed = await service.confirm({ user, workflowId: first.workflowId, requestId: 'r3' });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.completed, true);
  assert.equal(resumed.results.length, 2);
  assert.equal(resumed.answer, 'done');

  const replay = await service.confirm({ user, workflowId: first.workflowId, requestId: 'r4' });
  assert.equal(replay.error, 'workflow_not_found');

  const badGateway = { async complete() { return { ok: true, text: JSON.stringify({ steps: [{ toolId: 'invented', args: {} }] }) }; } };
  const invalid = new AgentWorkflowService({ agentService, gateway: badGateway, audit });
  const bad = await invalid.run({ user, request: 'invent something' });
  assert.equal(bad.error, 'invalid_workflow_tool');

  assert(events.some(e => e.event === 'agent.workflow_plan_completed'));
  assert(events.some(e => e.event === 'agent.workflow_completed'));
  console.log('Phase 5 agent workflow tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
