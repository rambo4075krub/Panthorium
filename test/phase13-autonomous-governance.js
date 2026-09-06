'use strict';

const assert = require('assert');
const { AutonomousGovernanceService, clampMode } = require('../services/autonomousGovernanceService');

function buildGovernance({ productionScore = 92, productionStatus = 'healthy', benchmarkScore = 92, releaseMerge = true, activeFailures = 0, consecutiveFailures = 0, unsafeShadow = 0, mode = 'observe' } = {}) {
  const calls = { stop: 0, releaseGate: 0, autoReview: 0, audit: [] };
  const service = new AutonomousGovernanceService({
    mode,
    production: {
      async overview() {
        return {
          ok: productionStatus !== 'critical',
          status: productionStatus,
          score: productionScore,
          slo: { burnRate: productionStatus === 'critical' ? 2.1 : 0.2 },
          aggregate: { audit: { total: 100, httpErrors: productionStatus === 'critical' ? 20 : 1 } }
        };
      }
    },
    releaseGate: {
      async status(args = {}) {
        calls.releaseGate += args.auto ? 1 : 0;
        return {
          ok: true,
          mergeAllowed: releaseMerge && benchmarkScore >= 80,
          score: releaseMerge && benchmarkScore >= 80 ? 100 : 80,
          blockers: benchmarkScore >= 80 ? [] : [{ id: 'benchmark_evidence', label: 'Benchmark Arena evidence' }],
          releaseBenchmarkJob: null,
          evidence: { benchmark: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } }
        };
      }
    },
    benchmark: {
      status() {
        return {
          ok: true,
          availableProviders: ['groq', 'openai'],
          lastRun: { runId: 'bench-latest', summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } },
          history: [
            { runId: 'bench-latest', summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } },
            { runId: 'bench-prev', summary: { sentinel: { rank: 1, score: 90, wins: 3, cases: 3, passed: true } } }
          ]
        };
      }
    },
    activeLearning: {
      async status() {
        return {
          ok: true,
          running: true,
          run: {
            runId: 'active-1',
            status: 'running',
            stats: { failures: activeFailures, consecutiveFailures, unsafeShadow },
            options: { durationHours: 24, manualActivationRequired: true }
          },
          history: []
        };
      },
      async stop() {
        calls.stop += 1;
        return { ok: true, stopped: true };
      }
    },
    learning: {
      async status() { return { ok: true, policy: {}, events: [] }; },
      repository: { async list() { return [{ versionId: 'active-v1', state: 'active' }]; } }
    },
    training: {
      async list() { return { ok: true, stats: { pending: 0 } }; },
      async autoProcessPending() { calls.autoReview += 1; return { ok: true, processed: 0 }; }
    },
    audit: { record(event, payload) { calls.audit.push({ event, payload }); } }
  });
  return { service, calls };
}

(async () => {
  assert.equal(clampMode('autopilot'), 'autopilot');
  assert.equal(clampMode('bad'), 'observe');

  const healthy = await buildGovernance().service.evaluate({ execute: false });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.score, 100);
  assert(healthy.actions.some((action) => action.id === 'observe'));

  const lowBenchmark = buildGovernance({ benchmarkScore: 53, releaseMerge: false });
  const lowReport = await lowBenchmark.service.evaluate({ execute: true });
  assert(lowReport.signals.some((signal) => signal.code === 'BENCHMARK_CRITICAL'));
  assert(lowReport.actions.some((action) => action.id === 'trigger_release_gate_benchmark'));
  assert(lowBenchmark.calls.releaseGate >= 1);

  const unsafe = buildGovernance({ productionStatus: 'critical', productionScore: 42, activeFailures: 10, consecutiveFailures: 4, unsafeShadow: 1, mode: 'autopilot' });
  const unsafeReport = await unsafe.service.evaluate({ execute: true });
  assert.equal(unsafeReport.status, 'critical');
  assert(unsafeReport.actions.some((action) => action.id === 'stop_active_learning'));
  assert.equal(unsafe.calls.stop, 1);
  assert(unsafeReport.executed.some((action) => action.actionId === 'stop_active_learning' && action.ok));

  const modeResult = await unsafe.service.setMode('off', { userId: 'tester' });
  assert.equal(modeResult.mode, 'off');

  console.log('Phase 13 Autonomous Governance tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
