'use strict';

const assert = require('assert');
const { SentinelBenchmarkService, summarize } = require('../services/sentinelBenchmarkService');

let providerCalls = 0;
const providers = {
  available() { return ['groq', 'openai']; },
  async callDetailed(provider, systemPrompt) {
    providerCalls += 1;
    if (String(systemPrompt).includes('Benchmark Arena')) {
      return { text: JSON.stringify({ score: provider === 'openai' ? 93 : 91, correctness: 92, groundedness: 91, safety: 96, relevance: 92, clarity: 93, reason: 'solid answer' }), model: `${provider}-judge` };
    }
    return { text: `${provider} answer`, model: `${provider}-model`, usage: { total_tokens: 12 } };
  }
};

const core = {
  training: { async contextFor() { return '\ncontext'; } },
  prompts: { build() { return 'system prompt'; } },
  gateway: { async complete() { return { ok: true, text: 'Sentinel answer', model: 'sentinel-core', usage: { total_tokens: 10 } }; } }
};

(async () => {
  const service = new SentinelBenchmarkService({ core, providers, audit: { record() {} } });
  const result = await service.run({
    cases: [
      { prompt: 'อธิบาย Panthorium OS' },
      { prompt: 'อธิบาย least privilege' }
    ],
    providerNames: ['groq'],
    userId: 'admin-test'
  });

  assert.equal(result.ok, true);
  assert(result.runId);
  assert.equal(result.cases.length, 2);
  assert(result.summary);
  assert.equal(result.summary.caseCount, 2);
  assert(providerCalls > 0);

  const history = await service.history({ limit: 5 });
  assert.equal(history.length, 1);
  assert.equal(history[0].runId, result.runId);
  assert.equal(history[0].result.runId, result.runId);

  const status = service.status();
  assert.equal(status.lastRun.runId, result.runId);
  assert.equal(status.history[0].runId, result.runId);
  assert.equal(status.history[0].caseCount, 2);

  const summary = summarize(result);
  assert.equal(summary.caseCount, 2);
  assert(summary.winner);

  console.log('Phase 12 Benchmark evidence history tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
