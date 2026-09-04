const assert = require('assert');
const { AgentWorkflowService } = require('../services/agentWorkflowService');
const { AgentPendingRepository } = require('../services/agentPendingRepository');

(async () => {
  const events = [];
  const pendingStore = new AgentPendingRepository();
  await pendingStore.init();

  const tools = [{ id: 'write.one', description: 'write', risk: 'high', mutates: true, requiresConfirmation: true, argsSchema: {} }];
  const agentService = {
    catalogFor: () => tools,
    validateArgs: () => ({ ok: true }),
    async execute({ user, toolId, confirmed }) {
      if (!confirmed) return { ok: false, error: 'confirmation_required' };
      return { ok: true, toolId, output: { userId: user.sub }, durationMs: 1, risk: 'high' };
    }
  };
  const gateway = {
    async complete() {
      return { ok: true, provider: 'mock', model: 'mock', text: JSON.stringify({ steps: [{ toolId: 'write.one', args: {}, reason: 'needs approval' }], answer: 'complete' }) };
    }
  };
  const audit = { record: (event, data) => events.push({ event, data }) };
  const user = { sub: 'u1', permissions: ['chat'] };

  const service1 = new AgentWorkflowService({ agentService, gateway, audit, pendingStore, ttlMs: 60000 });
  const first = await service1.run({ user, request: 'perform protected action', requestId: 'p1' });
  assert.equal(first.ok, true);
  assert.equal(first.confirmationRequired, true);
  assert(await pendingStore.get(first.workflowId));

  // New service instance simulates a process restart. Confirmation must be restored
  // from the repository instead of relying on the old in-memory Map.
  const service2 = new AgentWorkflowService({ agentService, gateway, audit, pendingStore, ttlMs: 60000 });
  const denied = await service2.confirm({ user: { sub: 'u2' }, workflowId: first.workflowId, requestId: 'p2' });
  assert.equal(denied.error, 'workflow_permission_denied');

  const resumed = await service2.confirm({ user, workflowId: first.workflowId, requestId: 'p3' });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.completed, true);
  assert.equal(resumed.results.length, 1);
  assert.equal(resumed.results[0].toolId, 'write.one');
  assert.equal(await pendingStore.get(first.workflowId), null);
  assert(events.some((entry) => entry.event === 'agent.workflow_restored'));

  const expiringStore = new AgentPendingRepository();
  await expiringStore.save({ workflowId: 'expired-1', userId: 'u1', state: { workflowId: 'expired-1', steps: [], index: 0, results: [] }, expiresAt: new Date(Date.now() - 1000).toISOString() });
  const expired = await expiringStore.removeExpired();
  assert.equal(expired.length, 1);
  assert.equal(expired[0].workflowId, 'expired-1');

  console.log('Phase 6 persistent workflow tests passed');
})().catch((error) => { console.error(error); process.exit(1); });