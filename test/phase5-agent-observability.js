const assert = require('assert');
const { AgentRunRepository } = require('../services/agentRunRepository');
const { AgentWorkflowService } = require('../services/agentWorkflowService');

(async () => {
  const runs = new AgentRunRepository(); await runs.init();
  const tools = [{ id: 'read.one', description: 'read one', mutates: false, requiresConfirmation: false }];
  const agentService = {
    catalogFor: () => tools,
    validateArgs: () => ({ ok: true }),
    async execute({ toolId }) { return { ok: true, toolId, output: { value: 1 }, durationMs: 7 }; }
  };
  const gateway = { async complete() { return { ok: true, provider: 'mock', model: 'mock-v1', text: JSON.stringify({ steps: [{ toolId: 'read.one', args: {}, reason: 'inspect' }], answer: 'done' }) }; } };
  const service = new AgentWorkflowService({ agentService, gateway, audit: { record() {} }, runs });
  const user = { sub: 'u1', permissions: ['chat'] };
  const result = await service.run({ user, request: 'inspect the system', requestId: 'req-1' });
  assert.equal(result.ok, true); assert.equal(result.completed, true);
  const history = await runs.list('u1', 10); assert.equal(history.length, 1); assert.equal(history[0].status, 'completed'); assert.equal(history[0].stepCount, 1); assert.equal(history[0].resultCount, 1);
  const detail = await runs.get('u1', result.workflowId); assert.equal(detail.request, 'inspect the system'); assert.equal(detail.provider, 'mock'); assert.equal(detail.results[0].toolId, 'read.one'); assert(detail.completedAt);
  assert.equal(await runs.get('u2', result.workflowId), null);
  console.log('Phase 5 agent observability tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
