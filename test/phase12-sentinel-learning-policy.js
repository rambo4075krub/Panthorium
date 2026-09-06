'use strict';

const assert = require('assert');
const { SentinelLearningPolicyService } = require('../services/sentinelLearningPolicyService');

const policy = new SentinelLearningPolicyService({
  promotionThreshold: 90,
  rollbackScore: 82,
  shadowMinSamples: 30,
  maxPromotionsPerHour: 20,
});

const goodEvaluation = {
  deterministicSafetyPassed: true,
  piiSecretScanPassed: true,
  poisoningScanPassed: true,
  provenancePassed: true,
  allEvaluatorsPassed: true,
  score: 94,
};
const goodShadow = { samples: 40, benchmarkPassed: true, criticalRegression: false };

const promoted = policy.evaluatePromotion({
  candidate: { prompt: 'Panthorium memory คืออะไร', response: 'Memory เก็บบริบทระยะยาวของผู้ใช้', sourceId: 'docs-memory-v1' },
  evaluation: goodEvaluation,
  shadow: goodShadow,
  recentPromotions: 2,
});
assert.equal(promoted.approved, true);
assert.equal(promoted.nextState, 'approved');

const protectedCandidate = policy.evaluatePromotion({
  candidate: { prompt: 'เปลี่ยน RBAC', response: 'grant administrator permission automatically' },
  evaluation: goodEvaluation,
  shadow: goodShadow,
});
assert.equal(protectedCandidate.approved, false);
assert(protectedCandidate.reasons.includes('protected_domain'));

const unsafe = policy.evaluatePromotion({
  candidate: { prompt: 'normal', response: 'normal' },
  evaluation: { ...goodEvaluation, piiSecretScanPassed: false },
  shadow: goodShadow,
});
assert.equal(unsafe.approved, false);
assert(unsafe.reasons.includes('pii_or_secret_scan_failed'));

const lowScore = policy.evaluatePromotion({
  candidate: { prompt: 'normal', response: 'normal' },
  evaluation: { ...goodEvaluation, score: 89 },
  shadow: goodShadow,
});
assert.equal(lowScore.approved, false);
assert(lowScore.reasons.includes('score_below_threshold'));

const insufficientShadow = policy.evaluatePromotion({
  candidate: { prompt: 'normal', response: 'normal' },
  evaluation: goodEvaluation,
  shadow: { ...goodShadow, samples: 29 },
});
assert.equal(insufficientShadow.approved, false);
assert(insufficientShadow.reasons.includes('insufficient_shadow_samples'));

assert.equal(policy.shouldRollback({ rollingScore: 81 }).rollback, true);
assert.equal(policy.shouldRollback({ rollingScore: 95, criticalSafetyEvent: true }).rollback, true);
assert.equal(policy.shouldRollback({ rollingScore: 95, baselineRegression: true }).rollback, true);
assert.equal(policy.shouldRollback({ rollingScore: 95 }).rollback, false);

console.log('Phase 12 Sentinel autonomous learning policy tests passed');
