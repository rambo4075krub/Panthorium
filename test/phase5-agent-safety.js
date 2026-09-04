const assert = require('assert');
const { AgentPolicyService } = require('../services/agentPolicyService');
const { AgentService } = require('../services/agentService');

(async () => {
  const policy = new AgentPolicyService();
  const low = { id: 'read', permission: 'chat', risk: 'low', mutates: false, run: async () => 'ok' };
  const high = { id: 'delete', permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true, run: async () => 'deleted' };
  const critical = { id: 'security.block_ip', permission: 'core:command', risk: 'critical', mutates: true, requiresConfirmation: true, run: async () => 'blocked' };
  const map = new Map([['read', low], ['delete', high], ['security.block_ip', critical]]);
  const tools = { get: id => map.get(id) || null, catalog: () => [...map.values()].map(({ run, ...tool }) => tool) };
  const events = [];
  const agent = new AgentService({ tools, policy, audit: { record: (event, data) => events.push({ event, data }) } });

  const chatUser = { sub: 'u1', permissions: ['chat'] };
  const admin = { sub: 'admin', permissions: ['chat', 'core:command'] };
  assert.equal((await agent.execute({ user: chatUser, toolId: 'read' })).ok, true);
  assert.equal((await agent.execute({ user: chatUser, toolId: 'delete' })).error, 'confirmation_required');
  assert.equal((await agent.execute({ user: chatUser, toolId: 'delete', confirmed: true })).ok, true);
  assert.equal((await agent.execute({ user: chatUser, toolId: 'security.block_ip', confirmed: true })).error, 'tool_permission_denied');
  assert.equal(agent.catalogFor(chatUser).some(t => t.id === 'security.block_ip'), false);
  assert.equal((await agent.execute({ user: admin, toolId: 'security.block_ip' })).error, 'confirmation_required');
  const blocked = await agent.execute({ user: admin, toolId: 'security.block_ip', confirmed: true });
  assert.equal(blocked.ok, true); assert.equal(blocked.risk, 'critical');
  assert(events.some(e => e.event === 'agent.tool_completed' && e.data.risk === 'critical'));
  console.log('Phase 5 agent safety tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
