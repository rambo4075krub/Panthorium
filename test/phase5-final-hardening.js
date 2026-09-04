const assert = require('assert');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { AgentWorkflowService } = require('../services/agentWorkflowService');

(async () => {
  const events = [];
  const audit = { record: (event, data) => events.push({ event, data }) };
  const sentinelCore = { status: () => ({ ok: true }), providerCatalog: () => [], async clearConversation() {} };
  const conversations = { async listSessions() { return []; }, async history() { return []; } };
  const securityResponse = { async listBlocks() { return []; }, async blockIp(ip) { return { ip }; }, async unblockIp() { return true; } };
  const aiOperations = { async overview() { return { ok: true }; } };
  const tools = new ToolRegistry({ sentinelCore, conversations, securityResponse, aiOperations });
  const agent = new AgentService({ tools, audit });
  const admin = { sub: 'admin', permissions: ['chat', 'system:read', 'core:command'] };

  assert.equal(agent.validateArgs('conversation.history', { sessionId: '../bad' }).error, 'invalid_tool_args');
  assert.equal(agent.validateArgs('conversation.history', { sessionId: 'safe.session-1', limit: 20 }).ok, true);
  assert.equal(agent.validateArgs('security.block_ip', { ip: '999.1.1.1' }).error, 'invalid_ip');
  assert.equal(agent.validateArgs('security.block_ip', { ip: '1.2.3.4', durationMinutes: 0 }).error, 'invalid_duration');
  assert.equal(agent.validateArgs('security.block_ip', { ip: '1.2.3.4', extra: true }).error, 'invalid_tool_args');
  const rejected = await agent.execute({ user: admin, toolId: 'security.block_ip', args: { ip: 'bad' }, confirmed: true });
  assert.equal(rejected.error, 'invalid_ip');
  assert(events.some((e) => e.event === 'agent.tool_rejected' && e.data.error === 'invalid_ip'));

  const runUpdates = [];
  const runs = { async create() {}, async update(id, patch) { runUpdates.push({ id, patch }); } };
  const workflowAgent = {
    catalogFor: () => [{ id: 'write', description: 'write', argsSchema: {}, risk: 'high', mutates: true, requiresConfirmation: true }],
    validateArgs: () => ({ ok: true, tool: {} }),
    async execute() { return { ok: true, toolId: 'write', output: {}, durationMs: 1, risk: 'high' }; }
  };
  const gateway = { async complete() { return { ok: true, provider: 'mock', model: 'mock', text: JSON.stringify({ steps: [{ toolId: 'write', args: {}, reason: 'test' }], answer: null }) }; } };
  const workflow = new AgentWorkflowService({ agentService: workflowAgent, gateway, audit, runs, ttlMs: 5 });
  const waiting = await workflow.run({ user: admin, request: 'write', requestId: 'r1' });
  assert.equal(waiting.confirmationRequired, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const expired = await workflow.confirm({ user: admin, workflowId: waiting.workflowId, requestId: 'r2' });
  assert.equal(expired.error, 'workflow_not_found');
  assert(runUpdates.some((entry) => entry.id === waiting.workflowId && entry.patch.status === 'expired'));
  assert(events.some((e) => e.event === 'agent.workflow_expired' && e.data.workflowId === waiting.workflowId));

  console.log('Phase 5 final hardening tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
