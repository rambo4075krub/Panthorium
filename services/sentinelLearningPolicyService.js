'use strict';

const PROTECTED_PATTERNS = [
  /\b(password|passwd|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\b/i,
  /\b(rbac|administrator permission|admin permission|grant permission|role escalation)\b/i,
  /\b(security policy|guardrail|risk threshold|disable safety|bypass confirmation)\b/i,
  /\b(integration allowlist|allowed hosts?|production deployment|deploy config)\b/i,
  /\b(financial authorization|legal authorization|destructive authorization)\b/i,
];

class SentinelLearningPolicyService {
  constructor(options = {}) {
    this.promotionThreshold = clampInt(options.promotionThreshold ?? process.env.SENTINEL_AUTONOMOUS_PROMOTION_THRESHOLD, 90, 60, 100);
    this.rollbackScore = clampInt(options.rollbackScore ?? process.env.SENTINEL_AUTONOMOUS_ROLLBACK_SCORE, 82, 0, 100);
    this.shadowMinSamples = clampInt(options.shadowMinSamples ?? process.env.SENTINEL_AUTONOMOUS_SHADOW_MIN_SAMPLES, 30, 1, 10000);
    this.maxPromotionsPerHour = clampInt(options.maxPromotionsPerHour ?? process.env.SENTINEL_AUTONOMOUS_MAX_PROMOTIONS_PER_HOUR, 20, 1, 1000);
  }

  classifyRisk(candidate = {}) {
    const text = `${candidate.prompt || ''}\n${candidate.response || ''}\n${candidate.content || ''}`;
    const protectedDomain = PROTECTED_PATTERNS.some((pattern) => pattern.test(text));
    return {
      tier: protectedDomain ? 'protected' : 'knowledge',
      protectedDomain,
      autonomousPromotionAllowed: !protectedDomain,
    };
  }

  evaluatePromotion({ candidate = {}, evaluation = {}, shadow = {}, recentPromotions = 0 } = {}) {
    const risk = this.classifyRisk(candidate);
    const reasons = [];

    if (risk.protectedDomain) reasons.push('protected_domain');
    if (!evaluation.deterministicSafetyPassed) reasons.push('deterministic_safety_failed');
    if (!evaluation.piiSecretScanPassed) reasons.push('pii_or_secret_scan_failed');
    if (!evaluation.poisoningScanPassed) reasons.push('poisoning_scan_failed');
    if (!evaluation.provenancePassed) reasons.push('provenance_missing');
    if (!evaluation.allEvaluatorsPassed) reasons.push('evaluator_gate_failed');
    if (Number(evaluation.score || 0) < this.promotionThreshold) reasons.push('score_below_threshold');
    if (Number(shadow.samples || 0) < this.shadowMinSamples) reasons.push('insufficient_shadow_samples');
    if (shadow.criticalRegression) reasons.push('critical_shadow_regression');
    if (shadow.benchmarkPassed !== true) reasons.push('benchmark_gate_failed');
    if (recentPromotions >= this.maxPromotionsPerHour) reasons.push('promotion_rate_limited');

    return {
      approved: reasons.length === 0,
      nextState: reasons.length === 0 ? 'approved' : 'quarantined',
      reasons,
      risk,
      thresholds: {
        promotionScore: this.promotionThreshold,
        shadowMinSamples: this.shadowMinSamples,
        maxPromotionsPerHour: this.maxPromotionsPerHour,
      },
    };
  }

  shouldRollback({ rollingScore, criticalSafetyEvent = false, baselineRegression = false } = {}) {
    const score = Number(rollingScore);
    return {
      rollback: criticalSafetyEvent || baselineRegression || (Number.isFinite(score) && score < this.rollbackScore),
      reason: criticalSafetyEvent
        ? 'critical_safety_event'
        : baselineRegression
          ? 'baseline_regression'
          : (Number.isFinite(score) && score < this.rollbackScore ? 'rolling_score_below_threshold' : null),
    };
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

module.exports = { SentinelLearningPolicyService, PROTECTED_PATTERNS };
