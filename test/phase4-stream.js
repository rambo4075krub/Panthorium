const assert = require('assert');
const { AiGateway } = require('../services/aiGateway');
(async () => {
  const deltas = []; const events = [];
  const providers = {
    available: () => ['primary','backup'],
    catalog: () => [],
    streamDetailed: async (provider, system, history, options, onDelta) => {
      if (provider === 'primary') throw new Error('primary-down');
      onDelta('hel'); onDelta('lo'); return { text: 'hello', model: 'stream-model', usage: { totalTokens: 2 }, streaming: 'native' };
    }
  };
  const gateway = new AiGateway({ providers, audit: { record: (event, data) => events.push({ event, data }) } });
  const result = await gateway.stream({ systemPrompt: 'x', history: [], userId: 'u1', sessionId: 's1', onDelta: (d) => deltas.push(d) });
  assert.equal(result.ok, true); assert.equal(result.provider, 'backup'); assert.equal(result.text, 'hello'); assert.equal(result.fallbackCount, 1); assert.equal(result.streaming, 'native');
  assert.deepEqual(deltas, ['hel','lo']); assert(events.some(e => e.event === 'ai.gateway.stream_provider_failed')); assert(events.some(e => e.event === 'ai.gateway.stream_complete'));
  console.log('Phase 4 streaming tests passed');
})().catch(e => { console.error(e); process.exit(1); });
