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
  metadata: { acceptanceScenario: true, measuredShadow: { schema: 1, sampleCount: 3, worstRegression: 0, comparisons: [{ candidateScore: 94 }, { candidateScore: 94 }, { candidateScore: 94 }] } }
};
const rolledVersion = {
  versionId: 'rolled-1',
  exampleId: 'example-1',
  state: 'rolled_back',
  score: 94,
  shadowSamples: 3,
  shadowScore: 94,
  metadata: { acceptanceScenario: true, rollbackReason: 'baseline_regression', measuredShadow: { schema: 1, sampleCount: 3, worstRegression: 0, comparisons: [{ candidateScore: 94 }, { candidateScore: 94 }, { candidateScore: 94 }] } }
};
const recoveryVersion = {
  versionId: 'recovery-shadow',
  exampleId: 'example-2',
  state: 'shadow',
  score: 93,
  shadowSamples: 3,
  shadowScore: 93,
  metadata: { recoveryOf: 'rolled-1', measuredShadow: { schema: 1, sampleCount: 3, worstRegression: 0, comparisons: [{ candidateScore: 93 }, { candidateScore: 93 }, { candidateScore: 93 }] } }
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

const gateForRecoveryChecks = new SentinelReleaseGateService();
const failedRecoveryOnly = gateForRecoveryChecks.checkRecovery({
  versionList: [
    { versionId: 'rolled-failed', state: 'rolled_back' },
    { versionId: 'recovery-failed', state: 'rolled_back', metadata: { recoveryOf: 'rolled-failed' } }
  ],
  events: [{ event: 'recovery_failed', versionId: 'rolled-failed', payload: { count: 0 } }]
});
assert.equal(failedRecoveryOnly.pass, false, 'failed recovery events and rolled-back recovery versions must not satisfy the recovery gate');

const successfulRecoveryEvent = gateForRecoveryChecks.checkRecovery({
  versionList: [{ versionId: 'rolled-success', state: 'rolled_back' }],
  events: [{ event: 'recovery_candidates_created', versionId: 'rolled-success', payload: { count: 1 } }]
});
assert.equal(successfulRecoveryEvent.pass, true, 'a linked successful recovery candidate event should satisfy the recovery gate');

const unmeasuredShadow = gateForRecoveryChecks.checkShadowGate({
  learningStatus: { policy: { shadowMinSamples: 3, shadowScore: 90, maxRegressionPct: 5 } },
  versionList: [{ versionId: 'raw-high-score', state: 'shadow', shadowSamples: 4, shadowScore: 98, metadata: {} }]
});
assert.equal(unmeasuredShadow.pass, false, 'high raw shadow scores without measured evidence must not satisfy the gate');

(async () => {
  const ready = await buildGate().status({ record: true });
  assert.equal(ready.ok, true);
  assert.equal(ready.mergeAllowed, true);
  assert.equal(ready.score, 100);
  assert.equal(ready.checks.length, 5);
  assert(ready.checks.every((check) => check.pass));
  assert.equal(ready.evidence.benchmark.score, 91);
  const readyShadow = ready.checks.find((check) => check.id === 'shadow_gate');
  assert.equal(readyShadow.evidence.evaluatedVersions[0].versionId, 'recovery-shadow');
  assert.equal(readyShadow.evidence.evaluatedVersions[0].candidateScore, undefined);

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
