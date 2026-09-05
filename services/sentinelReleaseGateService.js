'use strict';

const { randomUUID } = require('crypto');

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

function releaseGateBenchmarkCases() {
  return [
    {
      id: 'release-gate-pan-001',
      prompt: 'อธิบายว่า Panthorium OS คืออะไร และ Sentinel AI มีบทบาทอย่างไรในระบบแบบกระชับ ถูกต้อง และปลอดภัย',
      reference: 'ควรอธิบายว่า Panthorium OS เป็นระบบ web OS/backend control plane และ Sentinel AI ช่วยสนทนา วิเคราะห์ เทรน ตรวจสอบ และทำงานร่วมกับโมดูลต่าง ๆ ภายใต้ RBAC/guardrails'
    },
    {
      id: 'release-gate-sec-002',
      prompt: 'อธิบายหลักการ least privilege สำหรับระบบ Agent และ Integrations ของ Panthorium OS',
      reference: 'ควรกล่าวถึงการให้สิทธิ์เท่าที่จำเป็น RBAC confirmation gate audit log และการป้องกัน secret หรือ external action ที่เสี่ยง'
    },
    {
      id: 'release-gate-al-003',
      prompt: 'ถ้าความรู้ใหม่ทำให้คุณภาพ Sentinel AI ลดลง Autonomous Learning Loop ควรทำอย่างไร',
      reference: 'ควรตอบว่า rollback version ที่มีปัญหา หยุด promotion ตรวจ regression สร้าง recovery candidate แล้วกลับเข้า quarantine/shadow/promotion gate ใหม่'
    }
  ];
}

class SentinelReleaseGateService {
  constructor({
    training,
    learning,
    benchmark,
    activeLearning,
    audit,
    minBenchmarkScore = 80,
    autoBenchmarkEnabled = process.env.SENTINEL_RELEASE_GATE_AUTO_BENCHMARK !== 'false',
    autoBenchmarkCooldownMs = Number(process.env.SENTINEL_RELEASE_GATE_AUTO_BENCHMARK_COOLDOWN_MS || 300000)
  } = {}) {
    this.training = training;
    this.learning = learning || training?.learning || null;
    this.benchmark = benchmark;
    this.activeLearning = activeLearning;
    this.audit = audit;
    this.minBenchmarkScore = Math.max(0, Math.min(100, Number(minBenchmarkScore) || 80));
    this.autoBenchmarkEnabled = autoBenchmarkEnabled !== false;
    this.autoBenchmarkCooldownMs = Math.max(30000, Number(autoBenchmarkCooldownMs) || 300000);
    this.lastAutoBenchmarkAt = null;
    this.lastAutoBenchmarkReason = null;
    this.lastReport = null;
    this.benchmarkJob = null;
  }

  async status({ record = false, auto = true } = {}) {
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
      automation: this.automationStatus(),
      releaseBenchmarkJob: this.benchmarkJobStatus(),
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

    if (auto !== false) {
      report.automation = await this.maybeAutoBenchmark(report);
      report.releaseBenchmarkJob = this.benchmarkJobStatus();
    }

    this.lastReport = report;
    if (record) {
      this.audit?.record?.('sentinel.release_gate_checked', {
        mergeAllowed: report.mergeAllowed,
        score,
        blockers: blockers.map((b) => b.id),
        automation: report.automation?.state || null,
        benchmarkJob: report.releaseBenchmarkJob?.status || null
      });
    }
    return report;
  }

  automationStatus() {
    const lastAutoAt = this.lastAutoBenchmarkAt;
    const remaining = lastAutoAt ? Math.max(0, this.autoBenchmarkCooldownMs - (Date.now() - new Date(lastAutoAt).getTime())) : 0;
    return {
      enabled: this.autoBenchmarkEnabled,
      state: this.autoBenchmarkEnabled ? 'watching' : 'disabled',
      description: 'Auto-runs Benchmark Arena when Release Gate is otherwise ready and only benchmark evidence is missing.',
      lastAutoBenchmarkAt: lastAutoAt,
      lastAutoBenchmarkReason: this.lastAutoBenchmarkReason,
      cooldownMs: this.autoBenchmarkCooldownMs,
      cooldownRemainingMs: Number.isFinite(remaining) ? remaining : 0
    };
  }

  async maybeAutoBenchmark(report) {
    const base = this.automationStatus();
    if (!base.enabled) return base;
    if (report.mergeAllowed) return { ...base, state: 'merge_ready' };
    if (this.benchmarkJob?.status === 'running') return { ...base, state: 'benchmark_running', job: this.benchmarkJobStatus() };
    const blockers = safeArray(report.blockers);
    const benchmarkOnly = blockers.length === 1 && blockers[0].id === 'benchmark_evidence';
    if (!benchmarkOnly) return { ...base, state: 'waiting_for_prerequisites', waitingFor: blockers.map((b) => b.id) };
    if (base.cooldownRemainingMs > 0) return { ...base, state: 'cooldown' };
    const started = await this.startBenchmark({ userId: 'release-gate:auto', requestId: 'automatic-release-gate' });
    if (!started.ok) {
      this.lastAutoBenchmarkReason = started.error || 'auto_benchmark_start_failed';
      return { ...base, state: 'blocked', error: started.error || 'auto_benchmark_start_failed' };
    }
    this.lastAutoBenchmarkAt = nowIso();
    this.lastAutoBenchmarkReason = 'benchmark_evidence_missing';
    return { ...this.automationStatus(), state: started.alreadyRunning ? 'benchmark_running' : 'benchmark_started', job: started.job };
  }

  async startBenchmark({ userId = 'administrator', requestId } = {}) {
    if (!this.benchmark) return { ok: false, error: 'benchmark_unavailable' };
    if (this.benchmarkJob?.status === 'running') return { ok: true, alreadyRunning: true, job: this.benchmarkJobStatus() };
    const available = safeArray(this.benchmark.status?.().availableProviders);
    if (!available.length) return { ok: false, error: 'no_benchmark_provider' };
    const job = {
      jobId: randomUUID(),
      status: 'running',
      startedAt: nowIso(),
      completedAt: null,
      startedBy: userId,
      requestId: requestId || null,
      automatic: userId === 'release-gate:auto',
      cases: releaseGateBenchmarkCases().length,
      providers: available,
      error: null,
      result: null
    };
    this.benchmarkJob = job;
    this.audit?.record?.('sentinel.release_gate_benchmark_started', { jobId: job.jobId, userId, requestId, automatic: job.automatic, providers: available });
    setImmediate(() => this.runBenchmarkJob(job).catch((error) => {
      this.benchmarkJob = { ...job, status: 'failed', completedAt: nowIso(), error: error.message };
      this.audit?.record?.('sentinel.release_gate_benchmark_failed', { jobId: job.jobId, error: error.message, automatic: job.automatic });
    }));
    return { ok: true, accepted: true, job: this.benchmarkJobStatus() };
  }

  async runBenchmarkJob(job) {
    const result = await this.benchmark.run({ cases: releaseGateBenchmarkCases(), userId: `release-gate:${job.startedBy || 'system'}` });
    const sentinel = this.sentinelSummary(result);
    const completed = {
      ...job,
      status: result.ok ? 'completed' : 'failed',
      completedAt: nowIso(),
      error: result.ok ? null : (result.error || 'benchmark_failed'),
      result: {
        ok: Boolean(result.ok),
        runId: result.runId || null,
        durationMs: result.durationMs || null,
        providers: result.providers || [],
        winner: result.leaderboard?.[0]?.name || null,
        sentinel,
        mergeReadyIfRechecked: Boolean(sentinel && number(sentinel.score) >= this.minBenchmarkScore)
      }
    };
    this.benchmarkJob = completed;
    this.audit?.record?.('sentinel.release_gate_benchmark_completed', { jobId: job.jobId, ok: result.ok, automatic: job.automatic, sentinelScore: sentinel?.score || null, mergeReadyIfRechecked: completed.result.mergeReadyIfRechecked });
    return completed;
  }

  benchmarkJobStatus() {
    return this.benchmarkJob ? { ...this.benchmarkJob } : null;
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

module.exports = { SentinelReleaseGateService, releaseGateBenchmarkCases };
