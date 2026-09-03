const assert = require('assert');
const { AiOperationsService } = require('../services/aiOperationsService');
(async () => {
  const entries = [
    { event:'sentinel.chat_stream', userId:'u1' },
    { event:'ai.gateway.stream_complete', provider:'groq', latencyMs:100, fallbackCount:0, streaming:'native', usage:{ inputTokens:10, outputTokens:20, totalTokens:30 } },
    { event:'sentinel.chat', userId:'u1' },
    { event:'ai.gateway.complete', provider:'openai', latencyMs:300, fallbackCount:1, usage:{ inputTokens:5, outputTokens:15, totalTokens:20 } },
    { event:'ai.gateway.provider_failed', provider:'groq' }
  ];
  const audit = { listRecent: async () => entries };
  const conversations = { pool:null, listSessions: async () => [{sessionId:'a'},{sessionId:'b'}], history: async () => [{role:'user'},{role:'assistant'}] };
  const service = new AiOperationsService({ audit, conversations });
  const m = await service.overview('u1', 24);
  assert.equal(m.requests, 2); assert.equal(m.successful, 2); assert.equal(m.successRate, 100);
  assert.equal(m.totalTokens, 50); assert.equal(m.inputTokens, 15); assert.equal(m.outputTokens, 35);
  assert.equal(m.avgLatencyMs, 200); assert.equal(m.p95LatencyMs, 300); assert.equal(m.fallbacks, 1);
  assert.equal(m.streams, 1); assert.equal(m.nativeStreams, 1); assert.equal(m.conversations, 2); assert.equal(m.messages, 4);
  const groq = m.providers.find(p => p.provider === 'groq'); assert.equal(groq.requests, 1); assert.equal(groq.failures, 1); assert.equal(groq.health, 'degraded');
  console.log('Phase 4 AI operations tests passed');
})().catch(e => { console.error(e); process.exit(1); });
