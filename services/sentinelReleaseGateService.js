'use strict';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

class SentinelReleaseGateService {
  constructor({ training, learning, benchmark, activeLearning, audit, minBenchmarkScore = 80 } = {}) {
    this.training = training;
    this.learning = learning || training?.learning || null;
    this.benchmark = benchmark;
    this.activeLearning = activeLearning;
    this.audit = audit;
    this.minBenchmarkScore = Math.max(0, Math.min(100, Number(minBenchmarkScore) || 80));
    this.lastReport = null;
  }

  async status({ record = false } = {}) {
    const [trainingStatus, learningStatus, versions, benchmarkStatus, activeStatus] = await Promise.all([
      this.safe(() => this.training?.list?.({ limit: 200 }), { ok: false, error: 'training_unavailable' }),
      this.safe(() => this.learning?.status?.(), { ok: false, error: 'learning_unavailable' }),
      this.safe(() => this.learning?.repository?.list?.({ limit: 500 }), []),
      this.safe(() => this.benchmark?.status?.(), { ok: false, error: 'benchmark_unavailable' }),
      this.safe(() => this.activeLearning?.status?.(), { ok: false, error: 'active_learning_unavailable' })
    ]);

    const versionList = safeArray(versions);
    const events = safeArray(learningStatus?.events);
    const examples = safeArray(trainingStatus?.examples);
    const stats = trainingStatus?.stats || {};
    const benchmarkHistory = safeArray(benchmarkStatus?.history);
    const lastBenchmark = benchmarkStatus?.lastRun || benchmarkHistory[0] || null;
    const sentinelSummary = this.sentinelSummary(lastBenchmark);
    const activeHistory = safeArray(activeStatus?.history);

    const checks = [
      this.checkTrainingDashboard({ trainingStatus, learningStatus, examples, stats, versionList }),
      this.checkShadowGate({ learningStatus, versionList }),
      this.checkRecovery({ versionList, events }),
      this.checkActiveLearning({ activeStatus, activeHistory }),
      this.checkBenchmark({ benchmarkStatus, lastBenchmark, sentinelSummary })
    ];

    const blockers = checks.flatMap((check) => check.pass ? [] : [{ id: check.id, label: check.label, reason: check.reason }]);
    const warnings = checks.flatMap((check) => safeArray(check.warnings).map((warning) => ({ id: check.id, label: check.label, warning })));
    const passed = checks.filter((check) => check.pass).length;
    const score = Math.round((passed / Math.max(1, checks.length)) * 100);
    const report = {
      ok: true,
      generatedAt: nowIso(),
      phase: 'Phase 12 Sentinel Autonomous Learning Loop',
      mergeAllowed: blockers.length === 0,
      score,
      checks,
      blockers,
      warnings,
      evidence: {
        examples: {
          total: number(stats.total, examples.length),
          pending: number(stats.pending),
          approved: number(stats.approved),
          rejected: number(stats.rejected),
          autoApproved: number(stats.autoApproved)
        },
        versions: {
          total: versionList.length,
          quarantined: versionList.filter((v) => v.state === 'quarantined').length,
          shadow: versionList.filter((v) => v.state === 'shadow').length,
          active: versionList.filter((v) => v.state === 'active').length,
          rolledBack: versionList.filter((v) => v.state === 'rolled_back').length,
          rejected: versionList.filter((v) => v.state === 'rejected').length
        },
        policy: learningStatus?.policy || {},
        benchmark: sentinelSummary,
        activeLearning: activeStatus?.run || null
      }
    };

    this.lastReport = report;
    if (record) this.audit?.record?.('sentinel.release_gate_checked', { mergeAllowed: report.mergeAllowed, score, blockers: blockers.map((b) => b.id) });
    return report;
  }

  async safe(fn, fallback) {
    try {
      if (typeof fn !== 'function') return fallback;
      const result = await fn();
      return result == null ? fallback : result;
    } catch (error) {
      return { ...fallback, ok: false, error: error.message };
    }
  }

  checkTrainingDashboard({ trainingStatus, learningStatus, examples, stats, versionList }) {
    const pass = Boolean(trainingStatus?.ok && learningStatus?.ok && learningStatus?.policy && learningStatus?.metrics && Number(stats.total || examples.length) >= 1 && versionList.length >= 1);
    return {
      id: 'training_dashboard',
      label: 'Training Lab / Dashboard',
      pass,
      reason: pass ? null : 'ต้องมี Training example อย่างน้อย 1 รายการ, learning status, policy/metrics และ learning version อย่างน้อย 1 รายการ',
      evidence: {
        trainingOk: Boolean(trainingStatus?.ok),
        learningOk: Boolean(learningStatus?.ok),
        examples: Number(stats.total || examples.length || 0),
        versions: versionList.length,
        hasPolicy: Boolean(learningStatus?.policy),
        hasMetrics: Boolean(learningStatus?.metrics)
      }
    };
  }

  checkShadowGate({ learningStatus, versionList }) {
    const policy = learningStatus?.policy || {};
    const minSamples = number(policy.shadowMinSamples, 3);
    const minScore = number(policy.shadowScore, 90);
    const ready = versionList.filter((v) => ['shadow', 'active', 'rolled_back'].includes(v.state) && number(v.shadowSamples) >= minSamples && number(v.shadowScore) >= minScore);
    const pass = ready.length > 0;
    return {
      id: 'shadow_gate',
      label: 'Shadow gate',
      pass,
      reason: pass ? null : `ต้องมี Shadow/Active/Rolled back version ที่ผ่าน shadow ≥ ${minSamples} samples และ score ≥ ${minScore}`,
      evidence: { minSamples, minScore, readyVersions: ready.map((v) => ({ versionId: v.versionId, state: v.state, shadowSamples: v.shadowSamples, shadowScore: v.shadowScore })) }
    };
  }

  checkRecovery({ versionList, events }) {
    const rolled = versionList.filter((v) => v.state === 'rolled_back');
    const recoveryVersions = versionList.filter((v) => v.metadata?.recoveryOf || String(v.metadata?.acceptanceStep || '').includes('recovery'));
    const recoveryEvents = events.filter((e) => /recovery/i.test(String(e.event || '')));
    const monitorEvents = events.filter((e) => /monitor|rolled_back/i.test(String(e.event || '')));
    const pass = rolled.length > 0 && (recoveryVersions.length > 0 || recoveryEvents.length > 0);
    return {
      id: 'rollback_recovery',
      label: 'Automatic Recovery หลัง rollback',
      pass,
      reason: pass ? null : 'ต้องมี rolled_back version และมี recovery candidate/event หลัง rollback',
      evidence: {
        rolledBackVersions: rolled.map((v) => v.versionId),
        recoveryVersions: recoveryVersions.map((v) => ({ versionId: v.versionId, state: v.state, recoveryOf: v.metadata?.recoveryOf || null })),
        recoveryEvents: recoveryEvents.slice(0, 5).map((e) => e.event),
        monitorEvents: monitorEvents.slice(0, 5).map((e) => e.event)
      }
    };
  }

  checkActiveLearning({ activeStatus, activeHistory }) {
    const run = activeStatus?.run || null;
    const historicalRun = activeHistory.find((item) => ['running', 'activated', 'stopped', 'expired', 'guarded'].includes(item.status));
    const currentOrPast = run || historicalRun || null;
    const pass = Boolean(activeStatus?.ok && currentOrPast && currentOrPast.options?.manualActivationRequired === true);
    return {
      id: 'active_learning_runner',
      label: 'Active Learning 24h Runner',
      pass,
      reason: pass ? null : 'ต้องมีสถานะหรือประวัติ Active Learning runner 24 ชั่วโมง พร้อม manual activation gate',
      warnings: activeStatus?.running ? [] : ['Runner ไม่ได้กำลังรันอยู่ตอนนี้ ตรวจ history ก่อน merge'],
      evidence: {
        running: Boolean(activeStatus?.running),
        runId: currentOrPast?.runId || null,
        status: currentOrPast?.status || null,
        durationHours: currentOrPast?.options?.durationHours || null,
        manualActivationRequired: currentOrPast?.options?.manualActivationRequired || false,
        guardrails: currentOrPast ? {
          maxPrompts: currentOrPast.options?.maxPrompts,
          maxCandidates: currentOrPast.options?.maxCandidates,
          maxFailures: currentOrPast.options?.maxFailures,
          maxConsecutiveFailures: currentOrPast.options?.maxConsecutiveFailures,
          maxUnsafeShadow: currentOrPast.options?.maxUnsafeShadow
        } : null
      }
    };
  }

  checkBenchmark({ benchmarkStatus, lastBenchmark, sentinelSummary }) {
    const pass = Boolean(benchmarkStatus?.ok && lastBenchmark && sentinelSummary && number(sentinelSummary.score) >= this.minBenchmarkScore);
    return {
      id: 'benchmark_evidence',
      label: 'Benchmark Arena evidence',
      pass,
      reason: pass ? null : `ต้องมี benchmark history และ Sentinel score ≥ ${this.minBenchmarkScore}`,
      evidence: {
        availableProviders: benchmarkStatus?.availableProviders || [],
        historyCount: safeArray(benchmarkStatus?.history).length,
        lastRunId: lastBenchmark?.runId || null,
        sentinel: sentinelSummary
      }
    };
  }

  sentinelSummary(run) {
    if (!run) return null;
    if (run.summary?.sentinel) return run.summary.sentinel;
    const leaderboard = safeArray(run.leaderboard);
    const index = leaderboard.findIndex((row) => String(row.name || '').toLowerCase().includes('sentinel'));
    if (index < 0) return null;
    const row = leaderboard[index];
    return { rank: index + 1, score: row.score || 0, wins: row.wins || 0, cases: row.cases || 0, passed: number(row.score) >= this.minBenchmarkScore };
  }
}

module.exports = { SentinelReleaseGateService };
