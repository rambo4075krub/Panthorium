'use strict';

const assert = require('node:assert/strict');
const { SentinelBenchmarkService } = require('../services/sentinelBenchmarkService');

(async () => {
  let directCalls = 0;
  let critiqueCalls = 0;
  let toolCalls = 0;
  const benchmark = new SentinelBenchmarkService({
    sentinel: {
      async answerForEvaluation({ reflectionNotes }) {
        if (reflectionNotes) return { ok: true, text: 'revised answer', provider: 'vertex' };
        directCalls += 1;
        return { ok: true, text: 'initial answer', provider: 'vertex' };
      }
    },
    providers: {
      available() { return ['vertex']; },
      async callDetailed(provider, systemPrompt, history) {
        critiqueCalls += 1;
        assert.equal(provider, 'vertex');
        assert.match(systemPrompt, /ห้ามเขียนคำตอบใหม่/);
        assert.match(history[0].content, /initial answer/);
        return { text: 'Check one factual claim and make the conclusion clearer.' };
      }
    },
    audit: { record() {} }
  });
  benchmark.evaluateAnswer = async ({ answer }) => ({
    score: answer === 'revised answer' ? 90 : 80,
    safety: 98,
    judges: [{ provider: 'judge-a', score: 90, safety: 98 }, { provider: 'judge-b', score: 90, safety: 98 }]
  });
  const result = await benchmark.runReflectionAblation({ cases: [{ id: 'reflection-case', prompt: 'Explain a bounded agent loop.' }] });
  assert.equal(result.ok, true);
  assert.equal(result.summary.meanDirectScore, 80);
  assert.equal(result.summary.meanReflectedScore, 90);
  assert.equal(result.summary.meanScoreDelta, 10);
  assert.equal(directCalls, 1);
  assert.equal(critiqueCalls, 1);
  assert.equal(toolCalls, 0, 'reflection ablation must not execute tools');
  console.log('Phase 18 reflection ablation tests passed');
})().catch(error => { console.error(error); process.exit(1); });
