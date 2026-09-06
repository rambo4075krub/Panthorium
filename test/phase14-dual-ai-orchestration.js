'use strict';

const assert = require('assert');
const { DualAiOrchestratorService, AI_PROFILES, FRONTIER_PATTERNS, clampMode } = require('../services/dualAiOrchestratorService');

function buildDualAi({ benchmarkScore = 92, releaseAllowed = true, activeRunning = false, governanceCritical = false, pending = 0, providers = ['groq', 'openai'] } = {}) {
  const calls = { releaseGate: 0, training: 0, activeStart: 0, governanceExecute: 0, audit: [] };
  const service = new DualAiOrchestratorService({
    providers: { available: () => providers },
    production: { async overview() { return { ok: true, status: governanceCritical ? 'critical' : 'healthy', score: governanceCritical ? 42 : 96 }; } },
    governance: { async status(args = {}) { if (args.execute) calls.governanceExecute += 1; return { ok: true, status: governanceCritical ? 'critical' : 'healthy', score: governanceCritical ? 50 : 100, signals: governanceCritical ? [{ code: 'PRODUCTION_CRITICAL', severity: 'critical' }] : [] }; } },
    releaseGate: { async status(args = {}) { if (args.auto) calls.releaseGate += 1; return { ok: true, mergeAllowed: releaseAllowed && benchmarkScore >= 80, score: releaseAllowed && benchmarkScore >= 80 ? 100 : 80, blockers: benchmarkScore >= 80 ? [] : [{ id: 'benchmark_evidence' }], evidence: { benchmark: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }; } },
    benchmark: { status() { return { ok: true, availableProviders: providers, lastRun: { runId: 'bench-1', summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }, history: [{ runId: 'bench-1', summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }] }; } },
    activeLearning: { async status() { return { ok: true, running: activeRunning, run: activeRunning ? { runId: 'al-1', status: 'running', stats: governanceCritical ? { consecutiveFailures: 4, unsafeShadow: 1 } : {}, options: { manualActivationRequired: true } } : null, history: [] }; }, async start() { calls.activeStart += 1; return { ok: true, running: true, run: { runId: 'al-new' } }; } },
    learning: { async status() { return { ok: true, policy: {}, events: [] }; }, repository: { async list() { return [{ versionId: 'v1', state: 'active' }]; } } },
    training: { async list() { return { ok: true, stats: { pending } }; }, async draftWithTeachers() { calls.training += 1; return { ok: true, candidates: [{ provider: 'groq' }] }; }, async autoProcessPending() { return { ok: true, processed: 1 }; } },
    audit: { record(event, payload) { calls.audit.push({ event, payload }); } }
  });
  return { service, calls };
}

(async () => {
  assert.equal(clampMode('autopilot'), 'autopilot');
  assert.equal(clampMode('bad'), 'observe');
  assert(AI_PROFILES.sentinel_core.boundaries.includes('no_auto_deploy'));
  assert(AI_PROFILES.sentinel.boundaries.includes('active_only_context'));
  assert(FRONTIER_PATTERNS.some((p) => p.id === 'agent_tools_handoffs_guardrails'));

  const healthy = await buildDualAi({ activeRunning: true }).service.cycle({ execute: false });
  assert.equal(healthy.status, 'healthy');
  assert(healthy.proposals.some((p) => p.id === 'dual_ai_observe'));

  const low = buildDualAi({ benchmarkScore: 53, releaseAllowed: false, activeRunning: false });
  const lowReport = await low.service.cycle({ execute: true });
  assert(lowReport.proposals.some((p) => p.id === 'core_trigger_release_gate'));
  assert(lowReport.proposals.some((p) => p.id === 'sentinel_benchmark_repair_training'));
  assert(lowReport.proposals.some((p) => p.id === 'sentinel_24h_learning_runner'));
  assert(low.calls.releaseGate >= 1);
  assert.equal(low.calls.training, 1);
  assert.equal(low.calls.activeStart, 1);

  const unsafe = buildDualAi({ governanceCritical: true, activeRunning: true, benchmarkScore: 90 });
  const unsafeReport = await unsafe.service.cycle({ execute: true });
  assert(unsafeReport.proposals.some((p) => p.id === 'core_guard_active_learning'));
  assert(unsafe.calls.governanceExecute >= 1);
  assert.equal(unsafe.calls.activeStart, 0);

  const modeResult = await low.service.setMode('off', { userId: 'tester' });
  assert.equal(modeResult.mode, 'off');

  console.log('Phase 14 Dual AI orchestration tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
