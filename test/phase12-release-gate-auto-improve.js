'use strict';

const assert = require('assert');
const { SentinelReleaseGateService } = require('../services/sentinelReleaseGateService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(40);
  }
  throw new Error('timeout_waiting_for_condition');
}

const versions = new Map();
let sequence = 0;
let benchmarkRuns = 0;
let repairsCreated = 0;

const learning = {
  policy: { shadowMinSamples: 3, shadowScore: 90 },
  async init() {},
  repository: {
    async list() { return [...versions.values()]; },
    async get(versionId) { return versions.get(versionId); }
  },
  async status() {
    return {
      ok: true,
      metrics: {},
      policy: { promotionScore: 90, shadowMinSamples: 3, shadowScore: 90, rollbackScore: 82, maxRegressionPct: 5 },
      events: [{ event: 'recovery_candidates_created' }]
    };
  },
  async recordShadow(versionId, { score }) {
    const current = versions.get(versionId);
    const next = { ...current, shadowSamples: Number(current.shadowSamples || 0) + 1, shadowScore: score };
    versions.set(versionId, next);
    return { ok: true, version: next };
  },
  async promoteIfReady(versionId) {
    const current = versions.get(versionId);
    const ready = Number(current.shadowSamples || 0) >= 3 && Number(current.shadowScore || 0) >= 90;
    const next = ready ? { ...current, state: 'active' } : current;
    versions.set(versionId, next);
    return { ok: true, promoted: ready, version: next, decision: { ready } };
  }
};

const training = {
  learning,
  async init() {},
  async list() { return { ok: true, examples: [{ exampleId: 'seed' }], stats: { total: 1, approved: 1 } }; },
  async addExample({ prompt, answer }) {
    repairsCreated += 1;
    const versionId = `repair-${++sequence}`;
    const version = { versionId, exampleId: versionId, state: 'shadow', score: 95, shadowSamples: 0, shadowScore: 0, metadata: { source: 'test-repair', prompt, answer } };
    versions.set(versionId, version);
    return { ok: true, example: { exampleId: versionId, status: 'approved', qualityScore: 95 }, evaluation: { status: 'approved', score: 95 }, learning: version };
  }
};

const benchmark = {
  providers: {
    async callDetailed() { return { text: 'คำตอบปรับปรุงสำหรับ Benchmark Release Gate ที่ชัดเจน ปลอดภัย และตรงเกณฑ์ Panthorium OS', model: 'mock-teacher' }; }
  },
  status() { return { ok: true, availableProviders: ['mock-provider'], history: [] }; },
  async run() {
    benchmarkRuns += 1;
    const score = benchmarkRuns === 1 ? 53 : 88;
    return {
      ok: true,
      runId: `bench-${benchmarkRuns}`,
      durationMs: 1,
      providers: ['mock-provider'],
      leaderboard: [{ name: 'Sentinel AI', provider: 'sentinel', score, wins: score >= 80 ? 3 : 0, cases: 3 }],
      cases: [{
        caseId: 'case-1',
        prompt: 'อธิบาย Panthorium OS',
        reference: 'ควรอธิบาย Panthorium OS และ Sentinel AI',
        competitors: [{ provider: 'sentinel', name: 'Sentinel AI', score, answer: 'คำตอบเดิมยังไม่พอ', judges: [{ provider: 'judge', score, correctness: 50, groundedness: 50, safety: 90, reason: 'ยังไม่ครบเกณฑ์' }] }]
      }]
    };
  }
};

(async () => {
  const gate = new SentinelReleaseGateService({
    training,
    learning,
    benchmark,
    activeLearning: { async status() { return { ok: true, run: { runId: 'active', options: { manualActivationRequired: true } }, history: [] }; } },
    minBenchmarkScore: 80,
    autoImproveRetryDelayMs: 1000,
    autoImproveMaxRounds: 2,
    autoBenchmarkCooldownMs: 30000
  });

  const started = await gate.startBenchmark({ userId: 'release-gate:auto', requestId: 'test-auto-improve' });
  assert.equal(started.ok, true);

  const waiting = await waitFor(() => gate.benchmarkJobStatus()?.status === 'waiting_retry' && gate.benchmarkJobStatus());
  assert.equal(waiting.improvement.promoted, 1);
  assert.equal(repairsCreated, 1);

  const finalJob = await waitFor(() => gate.benchmarkJobStatus()?.status === 'completed' && gate.benchmarkJobStatus()?.round === 1 && gate.benchmarkJobStatus());
  assert.equal(finalJob.result.sentinel.score, 88);
  assert.equal(finalJob.result.mergeReadyIfRechecked, true);
  assert.equal(benchmarkRuns, 2);

  console.log('Phase 12 Release Gate auto-improve tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
