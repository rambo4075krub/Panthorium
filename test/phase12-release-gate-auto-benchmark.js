'use strict';

const assert = require('assert');
const { SentinelReleaseGateService } = require('../services/sentinelReleaseGateService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shadowVersion = {
  versionId: 'shadow-ready',
  state: 'shadow',
  shadowSamples: 3,
  shadowScore: 94,
  metadata: { acceptanceScenario: true }
};
const rolledVersion = {
  versionId: 'rolled-ready',
  state: 'rolled_back',
  shadowSamples: 3,
  shadowScore: 94,
  metadata: { acceptanceScenario: true, rollbackReason: 'baseline_regression' }
};
const recoveryVersion = {
  versionId: 'recovery-ready',
  state: 'shadow',
  shadowSamples: 3,
  shadowScore: 93,
  metadata: { recoveryOf: 'rolled-ready' }
};

(async () => {
  let lastRun = null;
  let runCount = 0;
  const learning = {
    async status() {
      return {
        ok: true,
        metrics: { shadowAverageScore: 94, activeAverageScore: 0, averageConsensus: 100 },
        policy: { promotionScore: 90, shadowMinSamples: 3, shadowScore: 90, rollbackScore: 82, maxRegressionPct: 5 },
        events: [
          { event: 'production_monitor' },
          { event: 'rolled_back' },
          { event: 'recovery_candidates_created' }
        ]
      };
    },
    repository: { async list() { return [shadowVersion, rolledVersion, recoveryVersion]; } }
  };
  const benchmark = {
    status() { return { ok: true, availableProviders: ['groq'], history: lastRun ? [lastRun] : [], lastRun }; },
    async run({ cases }) {
      runCount += 1;
      lastRun = {
        ok: true,
        runId: 'auto-bench-1',
        durationMs: 7,
        providers: ['groq'],
        cases: cases.map((item) => ({ caseId: item.id, competitors: [] })),
        leaderboard: [{ name: 'Sentinel AI', score: 91, wins: 3, cases: cases.length }],
        summary: { sentinel: { rank: 1, score: 91, wins: 3, cases: cases.length, passed: true } }
      };
      return lastRun;
    }
  };
  const gate = new SentinelReleaseGateService({
    training: {
      async list() { return { ok: true, examples: [{ exampleId: 'example-1' }], stats: { total: 2, approved: 2, pending: 0, rejected: 0, autoApproved: 2 } }; },
      learning
    },
    learning,
    benchmark,
    activeLearning: {
      async status() {
        return { ok: true, running: false, run: null, history: [{ runId: 'run-1', status: 'activated', options: { durationHours: 24, manualActivationRequired: true } }] };
      }
    },
    minBenchmarkScore: 80,
    autoBenchmarkCooldownMs: 30000
  });

  const first = await gate.status({ record: true });
  assert.equal(first.mergeAllowed, false);
  assert.equal(first.automation.state, 'benchmark_started');
  assert.equal(first.releaseBenchmarkJob.status, 'running');

  await sleep(25);
  const second = await gate.status({ record: true });
  assert.equal(runCount, 1);
  assert.equal(second.mergeAllowed, true);
  assert.equal(second.score, 100);
  assert.equal(second.evidence.benchmark.score, 91);
  assert.equal(second.automation.state, 'merge_ready');
  assert.equal(second.releaseBenchmarkJob.status, 'completed');

  console.log('Phase 12 automatic Release Gate benchmark tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
