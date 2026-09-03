const assert = require('assert');
const { AiGateway } = require('../services/aiGateway');
const { ConversationRepository } = require('../services/conversationRepository');
(async () => {
  const events = []; const audit = { record: (event, data) => events.push({ event, data }) };
  const providers = { available: () => ['primary','backup'], catalog: () => [{ provider:'primary', configured:true }], callDetailed: async (p) => { if (p === 'primary') throw new Error('down'); return { text:'fallback-ok', model:'test-model', usage:{ totalTokens:3 } }; } };
  const gateway = new AiGateway({ providers, audit });
  assert.equal(gateway.catalog()[0].provider, 'primary');
  const result = await gateway.complete({ systemPrompt:'x', history:[], userId:'u1', sessionId:'s1' });
  assert.equal(result.ok, true); assert.equal(result.provider, 'backup'); assert.equal(result.fallbackCount, 1); assert.equal(result.usage.totalTokens, 3);
  const repo = new ConversationRepository(); await repo.init(); await repo.append({ userId:'u1', sessionId:'s1', role:'user', content:'hello' }); await repo.append({ userId:'u1', sessionId:'s1', role:'assistant', content:'hi' });
  assert.equal((await repo.history('u1','s1')).length, 2); assert.equal((await repo.listSessions('u1')).length, 1); await repo.clear('u1','s1'); assert.equal((await repo.history('u1','s1')).length, 0);
  assert(events.some(e => e.event === 'ai.gateway.provider_failed')); assert(events.some(e => e.event === 'ai.gateway.complete'));
  console.log('Phase 4 AI tests passed');
})().catch(e => { console.error(e); process.exit(1); });
