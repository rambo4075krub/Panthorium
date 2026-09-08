'use strict';

const assert = require('assert');
const { FrontierArchitectureService, FRONTIER_ARCHITECTURE_PATTERNS, LEARNING_CHANNELS } = require('../services/frontierArchitectureService');
const { SentinelOrchestratorService, AI_PROFILES, FRONTIER_PATTERNS } = require('../services/sentinelOrchestratorService');

function fakeTelemetry({ benchmarkScore = 91, providers = ['groq', 'openai'], governance = 'healthy', active = true } = {}) {
  return {
    production: { status: 'healthy', score: 96 },
    governance: { status: governance, score: governance === 'critical' ? 42 : 95, signals: governance === 'critical' ? [{ code: 'PRODUCTION_CRITICAL', severity: 'critical' }] : [] },
    releaseGate: { ok: true, mergeAllowed: benchmarkScore >= 80, score: benchmarkScore >= 80 ? 100 : 80, evidence: { benchmark: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } },
    benchmark: { ok: true, availableProviders: providers, lastRun: { summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }, history: [] },
    activeLearning: { ok: true, running: active, run: active ? { runId: 'al-1', status: 'running', stats: {}, options: { manualActivationRequired: true } } : null },
    versions: [{ versionId: 'v1', state: 'active' }]
  };
}

(async () => {
  const frontier = new FrontierArchitectureService({ benchmarkScore: 80 });
  const healthy = frontier.status({ telemetry: fakeTelemetry() });
  assert.equal(healthy.ok, true);
  assert(healthy.patterns.some((p) => p.id === 'agent_tools_handoffs_guardrails'));
  assert(healthy.patterns.some((p) => p.id === 'mcp_tool_resource_boundary'));
  assert(healthy.patterns.some((p) => p.id === 'grounded_tool_context_circulation'));
  assert(healthy.patterns.some((p) => p.id === 'durable_execution_human_gate'));
  assert(healthy.maturity.score >= 80);
  assert.equal(healthy.safetyBoundary.noGateBypass, true);
  assert(LEARNING_CHANNELS.sentinel.some((c) => c.type === 'external'));
  assert(LEARNING_CHANNELS.sentinel.some((c) => c.id === 'active_learning_versions'));

  const weak = frontier.status({ telemetry: fakeTelemetry({ benchmarkScore: 53, providers: ['groq'], governance: 'critical', active: false }) });
  assert(weak.recommendations.some((r) => r.id === 'expand_benchmark_repair'));
  assert(weak.recommendations.some((r) => r.id === 'stabilize_governance_first'));
  assert(weak.maturity.score < healthy.maturity.score);

  const sentinelControl = new SentinelOrchestratorService({
    providers: { available: () => ['groq', 'openai'] },
    production: { async overview() { return fakeTelemetry().production; } },
    governance: { async status() { return fakeTelemetry().governance; } },
    releaseGate: { async status() { return fakeTelemetry().releaseGate; } },
    benchmark: { status() { return fakeTelemetry().benchmark; } },
    activeLearning: { async status() { return fakeTelemetry().activeLearning; }, async start() { return { ok: true, running: true }; } },
    learning: { async status() { return { ok: true }; }, repository: { async list() { return [{ versionId: 'v1', state: 'active' }]; } } },
    training: { async list() { return { ok: true, stats: { pending: 0 } }; }, async draftWithTeachers() { return { ok: true, candidates: [] }; } },
    frontierArchitecture: frontier,
    audit: { record() {} }
  });
  const status = await sentinelControl.status();
  assert(status.frontier.patterns.length >= FRONTIER_ARCHITECTURE_PATTERNS.length);
  assert.equal(status.boundaries.neverAllowed.includes('bypass_rbac'), true);
  assert.deepEqual(Object.keys(AI_PROFILES), ['sentinel']);
  assert(AI_PROFILES.sentinel.learningChannels.includes('frontier_pattern_catalog'));
  assert(FRONTIER_PATTERNS.some((p) => p.id === 'continuous_24h_learning_without_gate_bypass'));

  const report = await sentinelControl.cycle({ execute: false });
  assert(report.frontier.maturity.score >= 80);
  assert(report.learningPlan.loop.includes('promote only if gates pass'));
  assert.equal(report.sentinelState.runtimeKnowledge, 'active_only');

  console.log('Phase 14 frontier architecture tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
