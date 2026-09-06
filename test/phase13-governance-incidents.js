'use strict';

const assert = require('assert');
const { AutonomousGovernanceService } = require('../services/autonomousGovernanceService');

function buildService({ benchmarkScore = 50, activeRunning = false, mode = 'observe' } = {}) {
  const calls = { audit: [] };
  const service = new AutonomousGovernanceService({
    mode,
    production: {
      async overview() {
        return { ok: true, status: 'healthy', score: 95, slo: { burnRate: 0.1 }, aggregate: { audit: { total: 10, httpErrors: 0 } } };
      }
    },
    releaseGate: {
      async status() {
        return {
          ok: true,
          mergeAllowed: benchmarkScore >= 80,
          score: benchmarkScore >= 80 ? 100 : 80,
          blockers: benchmarkScore >= 80 ? [] : [{ id: 'benchmark_evidence', label: 'Benchmark Arena evidence' }],
          evidence: { benchmark: { rank: 2, score: benchmarkScore, wins: 0, cases: 3, passed: benchmarkScore >= 80 } },
          releaseBenchmarkJob: null
        };
      }
    },
    benchmark: {
      status() {
        return { ok: true, availableProviders: ['groq'], history: [{ runId: 'bench-1', summary: { sentinel: { rank: 2, score: benchmarkScore, wins: 0, cases: 3, passed: benchmarkScore >= 80 } } }] };
      }
    },
    activeLearning: {
      async status() { return { ok: true, running: activeRunning, run: activeRunning ? { runId: 'active-1', stats: { failures: 0, consecutiveFailures: 0, unsafeShadow: 0 } } : null, history: [{ runId: 'old', status: 'stopped' }] }; },
      async stop() { return { ok: true }; }
    },
    learning: { async status() { return { ok: true, events: [] }; }, repository: { async list() { return []; } } },
    training: { async list() { return { ok: true, stats: { pending: 0 } }; } },
    audit: { record(event, payload) { calls.audit.push({ event, payload }); } }
  });
  return { service, calls };
}

(async () => {
  const low = buildService({ benchmarkScore: 50 });
  const first = await low.service.evaluate({ persist: true, execute: false, source: 'incident-test-low' });
  assert(first.incidents.length >= 1);
  assert(first.incidents.some((incident) => incident.code === 'BENCHMARK_CRITICAL'));
  const incident = first.incidents.find((item) => item.code === 'BENCHMARK_CRITICAL');
  assert(incident.runbook.steps.length >= 2);

  const second = await low.service.evaluate({ persist: true, execute: false, source: 'incident-test-low-repeat' });
  const repeated = second.incidents.find((item) => item.code === 'BENCHMARK_CRITICAL');
  assert(repeated.occurrences >= 2);

  const resolved = await low.service.resolveIncident(incident.incidentId, { userId: 'tester' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.incident.status, 'resolved');

  const recovered = buildService({ benchmarkScore: 90 });
  await recovered.service.evaluate({ persist: true, execute: false, source: 'incident-test-healthy' });
  assert.equal((await recovered.service.incidents({ status: 'open' })).length, 0);

  console.log('Phase 13 Governance incident ledger tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
