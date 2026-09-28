'use strict';

const assert = require('node:assert/strict');
const { ensureAcceptanceActive } = require('../routes/training');
const { SentinelShadowEvaluator } = require('../services/sentinelShadowEvaluator');

async function fixture(withEvaluator = true) {
  const examples = [];
  const versions = [];
  const policy = { shadowMinSamples: 3, shadowScore: 90, maxRegressionPct: 5 };
  const repository = {
    async list() { return versions; },
    async get(id) { return versions.find((item) => item.versionId === id) || null; },
    async update(id, patch) {
      const version = await this.get(id);
      if (!version) return null;
      Object.assign(version, patch);
      if (patch.metadata) version.metadata = { ...(version.metadata || {}), ...patch.metadata };
      return version;
    }
  };
  const trainingRepository = {
    async findByFingerprint() { return null; },
    async create(data) {
      const example = { ...data, exampleId: 'example-1', status: 'pending', qualityScore: 0 };
      examples.push(example);
      return example;
    },
    async review(id, status, reviewer, result) {
      const example = examples.find((item) => item.exampleId === id);
      Object.assign(example, { status, reviewer, ...result });
      return example;
    }
  };
  const learning = {
    policy,
    repository,
    async init() {},
    async quarantine(example) {
      const version = { versionId: 'version-1', exampleId: example.exampleId, state: 'quarantined', score: example.qualityScore, shadowSamples: 0, shadowScore: 0, metadata: {} };
      versions.push(version);
      return version;
    },
    async evaluateForShadow(version) {
      version.state = 'shadow';
      version.baselineScore = 95;
      return version;
    },
    async promoteIfReady(id) {
      const version = await repository.get(id);
      const evidence = version.metadata.measuredShadow;
      if (version.shadowSamples < 3 || evidence?.sampleCount < 3 || evidence?.comparisons?.length !== 3 || evidence?.worstRegression > 5) {
        return { ok: true, promoted: false, decision: { reasons: ['measured_shadow_evidence_required'] }, version };
      }
      version.state = 'active';
      return { ok: true, promoted: true, version };
    }
  };
  const training = {
    repository: trainingRepository,
    learning,
    async init() {},
    audit: { record() {} }
  };
  const shadowEvaluator = withEvaluator ? {
    async evaluate(version) {
      const latest = await repository.get(version.versionId);
      const count = Number(latest.metadata.measuredShadow?.sampleCount || 0) + 3;
      const measuredShadow = { schema: 1, sampleCount: count, worstRegression: 0, comparisons: [{}, {}, {}] };
      latest.shadowSamples += 3;
      latest.shadowScore = 96;
      latest.metadata.measuredShadow = measuredShadow;
      return { safe: true, evidence: measuredShadow };
    }
  } : null;
  return { training, shadowEvaluator, versions };
}

(async () => {
  const { training, shadowEvaluator, versions } = await fixture();
  const result = await ensureAcceptanceActive(training, { shadowEvaluator, requestId: 'test-request' });
  assert.equal(result.ok, true);
  assert.equal(result.promoted, true);
  assert.equal(result.version.state, 'active');
  assert.equal(result.version.shadowSamples, 3);
  assert.equal(result.version.metadata.measuredShadow.sampleCount, 3);
  assert.equal(versions.length, 1);

  const withoutEvaluator = await fixture(false);
  const blocked = await ensureAcceptanceActive(withoutEvaluator.training, { shadowEvaluator: null });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'real_shadow_evaluator_unavailable');
  assert.equal(withoutEvaluator.versions[0].shadowSamples, 0, 'must not invent synthetic shadow samples');

  let sampleCount = 0;
  const measuredVersion = { versionId: 'measured-version', state: 'shadow', shadowSamples: 0, shadowScore: 0, baselineScore: null, metadata: { measuredShadow: { schema: 1, prompts: ['test one', 'test two', 'test three'], sampleCount: 0 } } };
  const measuredRepository = {
    async get() { return measuredVersion; },
    async update(id, patch) { Object.assign(measuredVersion, patch); measuredVersion.metadata = { ...measuredVersion.metadata, ...(patch.metadata || {}) }; return measuredVersion; }
  };
  const measuredLearning = {
    repository: measuredRepository,
    policy: { maxRegressionPct: 5 },
    async recordShadow(id, { score }) {
      sampleCount++;
      measuredVersion.shadowSamples++;
      measuredVersion.shadowScore = Math.round(((measuredVersion.shadowScore * (sampleCount - 1)) + score) / sampleCount);
      return { ok: true, version: measuredVersion };
    }
  };
  const evaluator = new SentinelShadowEvaluator({
    sentinel: { async answerForEvaluation({ prompt, shadowExample }) { return { ok: true, text: `${shadowExample ? 'candidate' : 'baseline'} ${prompt}`, provider: 'vertex' }; } },
    benchmark: { async evaluateAnswer() { return { score: 95, judges: [{ provider: 'one', score: 95, safety: 100 }, { provider: 'two', score: 95, safety: 100 }] }; } },
    providers: { available() { return ['vertex', 'groq']; } },
    learning: measuredLearning
  });
  const measured = await evaluator.evaluate(measuredVersion, { exampleId: 'example-1', prompt: 'example prompt' });
  assert.equal(measured.samples, 3, 'three independently judged held-out prompts are three measured samples');
  assert.equal(measured.evidence.sampleCount, 3);
  assert.equal(measuredVersion.shadowSamples, 3);
  assert.equal(measuredVersion.shadowScore, 95);

  console.log('Phase 17 measured-shadow acceptance tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
