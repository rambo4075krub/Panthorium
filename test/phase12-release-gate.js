'use strict';

const assert = require('assert');
const { SentinelReleaseGateService } = require('../services/sentinelReleaseGateService');

const shadowVersion = {
  versionId: 'shadow-ready',
  exampleId: 'example-1',
  state: 'shadow',
  score: 94,
  shadowSamples: 3,
  shadowScore: 94,
  metadata: { acceptanceScenario: true }
};
const rolledVersion = {
  versionId: 'rolled-1',
  exampleId: 'example-1',
  state: 'rolled_back',
  score: 94,
  shadowSamples: 3,
  shadowScore: 94,
  metadata: { acceptanceScenario: true, rollbackReason: 'baseline_regression' }
};
const recoveryVersion = {
  versionId: 'recovery-shadow',
  exampleId: 'example-2',
  state: 'shadow',
  score: 93,
  shadowSamples: 3,
  shadowScore: 93,
  metadata: { recoveryOf: 'rolled-1' }
};

function buildGate({ benchmarkScore = 91, activeRun = true } = {}) {
  const learning = {
    async status() {
      return {
        ok: true,
        counts: { shadow: 2, rolled_back: 1 },
        metrics: { shadowAverageScore: 94, averageConsensus: 100 },
        policy: { promotionScore: 90, shadowMinSamples: 3, shadowScore: 90, rollbackScore: 82, maxRegressionPct: 5 },
        events: [
          { event: 'production_monitor', versionId: 'rolled-1' },
          { event: 'rolled_back', versionId: 'rolled-1' },
          { event: 'recovery_candidates_created', versionId: 'rolled-1' }
        ]
      };
    },
    repository: {
      async list() { return [shadowVersion, rolledVersion, recoveryVersion]; }
    }
  };
  return new SentinelReleaseGateService({
    training: {
      async list() {
        return { ok: true, examples: [{ exampleId: 'example-1' }], stats: { total: 4, approved: 3, pending: 0, rejected: 1, autoApproved: 2 } };
      },
      learning
    },
    learning,
    benchmark: {
      status() {
        return {
          ok: true,
          availableProviders: ['groq', 'openai'],
          history: [{ runId: 'bench-1' }],
          lastRun: { runId: 'bench-1', summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }
        };
      }
    },
    activeLearning: {
      async status() {
        return {
          ok: true,
          running: activeRun,
          run: activeRun ? { runId: 'active-1', status: 'running', options: { durationHours: 24, manualActivationRequired: true, maxPrompts: 288, maxCandidates: 864, maxFailures: 12, maxConsecutiveFailures: 4, maxUnsafeShadow: 1 } } : null,
          history: activeRun ? [] : [{ runId: 'active-old', status: 'stopped', options: { durationHours: 24, manualActivationRequired: true } }]
        };
      }
    },
    minBenchmarkScore: 80
  });
}

(async () => {
  const ready = await buildGate().status({ record: true });
  assert.equal(ready.ok, true);
  assert.equal(ready.mergeAllowed, true);
  assert.equal(ready.score, 100);
  assert.equal(ready.checks.length, 5);
  assert(ready.checks.every((check) => check.pass));
  assert.equal(ready.evidence.benchmark.score, 91);

  const withHistoryOnly = await buildGate({ activeRun: false }).status();
  assert.equal(withHistoryOnly.mergeAllowed, true);
  assert(withHistoryOnly.warnings.some((warning) => warning.id === 'active_learning_runner'));

  const blocked = await buildGate({ benchmarkScore: 60 }).status();
  assert.equal(blocked.mergeAllowed, false);
  assert(blocked.blockers.some((blocker) => blocker.id === 'benchmark_evidence'));

  console.log('Phase 12 Release Gate tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
