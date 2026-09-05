'use strict';

class AutonomousLearningPolicy {
  constructor(options = {}) {
    this.promotionScore = clampInt(options.promotionScore ?? process.env.SENTINEL_AUTONOMOUS_PROMOTION_THRESHOLD, 90, 60, 100);
    this.shadowMinSamples = clampInt(options.shadowMinSamples ?? process.env.SENTINEL_AUTONOMOUS_SHADOW_MIN_SAMPLES, 30, 1, 10000);
    this.shadowScore = clampInt(options.shadowScore ?? process.env.SENTINEL_AUTONOMOUS_SHADOW_SCORE, 90, 0, 100);
    this.maxRegressionPct = clampNumber(options.maxRegressionPct ?? process.env.SENTINEL_AUTONOMOUS_MAX_REGRESSION_PCT, 5, 0, 100);
    this.rollbackScore = clampInt(options.rollbackScore ?? process.env.SENTINEL_AUTONOMOUS_ROLLBACK_SCORE, 82, 0, 100);
    this.minReviewers = clampInt(options.minReviewers ?? process.env.SENTINEL_AUTONOMOUS_MIN_REVIEWERS, 2, 1, 8);
    this.protectedDomains = [
      'rbac',
      'administrator_permission',
      'admin_permission',
      'role_escalation',
      'security_policy',
      'guardrail',
      'risk_threshold',
      'disable_safety',
      'bypass_confirmation',
      'password',
      'api_key',
      'secret',
      'access_token',
      'refresh_token',
      'integration_allowlist',
      'allowed_hosts',
      'production_deployment',
      'deploy_config',
      'financial_authorization',
      'legal_authorization',
      'destructive_authorization'
    ];
  }

  promotionDecision({ score, safe, reviewers = [], risk = 'normal', shadowSamples = 0, shadowScore = null, regressionPct = 0 } = {}) {
    const reasons = [];
    const uniqueReviewers = new Set((reviewers || []).filter(Boolean));

    if (risk === 'protected') reasons.push('protected_domain');
    if (safe !== true) reasons.push('unsafe_evaluation');
    if (Number(score) < this.promotionScore) reasons.push('score_below_threshold');
    if (uniqueReviewers.size < this.minReviewers) reasons.push('insufficient_reviewers');
    if (Number(shadowSamples) < this.shadowMinSamples) reasons.push('insufficient_shadow_samples');
    if (shadowScore == null || Number(shadowScore) < this.shadowScore) reasons.push('shadow_score_below_threshold');
    if (Number(regressionPct) > this.maxRegressionPct) reasons.push('shadow_regression_exceeded');

    return {
      ok: reasons.length === 0,
      reasons,
      thresholds: {
        promotionScore: this.promotionScore,
        minReviewers: this.minReviewers,
        shadowMinSamples: this.shadowMinSamples,
        shadowScore: this.shadowScore,
        maxRegressionPct: this.maxRegressionPct
      }
    };
  }

  rollbackDecision({ rollingScore, baselineScore, criticalSafetyEvent = false } = {}) {
    if (criticalSafetyEvent) return { rollback: true, reason: 'critical_safety_event' };
    const rolling = Number(rollingScore);
    const baseline = Number(baselineScore);
    if (Number.isFinite(rolling) && rolling < this.rollbackScore) return { rollback: true, reason: 'rolling_score_below_threshold' };
    if (Number.isFinite(rolling) && Number.isFinite(baseline) && baseline - rolling > this.maxRegressionPct) return { rollback: true, reason: 'baseline_regression' };
    return { rollback: false, reason: null };
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

module.exports = { AutonomousLearningPolicy };
