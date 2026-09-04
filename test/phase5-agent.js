const assert = require('assert');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');

(async () => {
  const events = [];
  const audit = { record: (event, data) => events.push({ event, data }) };
  const sentinelCore = {
    status: () => ({ name: 'Sentinel Core', version: 'test' }),
    providerCatalog: () => [{ provider: 'mock', configured: true }],
    async clearConversation(userId, sessionId) { events.push({ event: 'cleared', userId, sessionId }); }
  };
  const conversations = {
    async listSessions(userId) { return [{ sessionId: `${userId}-s1` }]; },
    async history(userId, sessionId) { return [{ role: 'user', content: `${userId}:${sessionId}` }]; }
  };
  const tools = new ToolRegistry({ sentinelCore, conversations });
  const agent = new AgentService({ tools, audit });
  const user = { sub: 'u1', permissions: ['chat', 'system:read'] };

  const catalog = agent.catalogFor(user);
  assert(catalog.some(t => t.id === 'system.status'));
  assert(catalog.some(t => t.id === 'conversation.clear' && t.requiresConfirmation));
  const status = await agent.execute({ user, toolId: 'system.status' });
  assert.equal(status.ok, true); assert.equal(status.output.name, 'Sentinel Core');
  const denied = await agent.execute({ user: { sub: 'u2', permissions: [] }, toolId: 'system.status' });
  assert.equal(denied.error, 'tool_permission_denied');
  const confirm = await agent.execute({ user, toolId: 'conversation.clear', args: { sessionId: 's1' } });
  assert.equal(confirm.error, 'confirmation_required');
  const cleared = await agent.execute({ user, toolId: 'conversation.clear', args: { sessionId: 's1' }, confirmed: true });
  assert.equal(cleared.ok, true);
  assert(events.some(e => e.event === 'agent.tool_completed'));
  assert(events.some(e => e.event === 'cleared' && e.userId === 'u1'));
  console.log('Phase 5 agent tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
