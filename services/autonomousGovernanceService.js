'use strict';

const { Pool } = require('pg');

function nowIso() { return new Date().toISOString(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function ratio(part, total) {
  const t = number(total);
  return t > 0 ? number(part) / t : 0;
}
function rank(severity) {
  return severity === 'critical' ? 3 : severity === 'degraded' ? 2 : severity === 'warning' ? 1 : 0;
}
function clampMode(mode) {
  return ['off', 'observe', 'autopilot'].includes(mode) ? mode : 'observe';
}
function ms(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(60000, parsed) : fallback;
}

class AutonomousGovernanceService {
  constructor({
    production,
    releaseGate,
    benchmark,
    activeLearning,
    learning,
    training,
    audit,
    databaseUrl = '',
    databaseSslMode = 'disable',
    mode = process.env.PANTHORIUM_GOVERNANCE_MODE || 'observe',
    intervalMs = process.env.PANTHORIUM_GOVERNANCE_INTERVAL_MS || 300000,
    thresholds = {}
  } = {}) {
    this.production = production;
    this.releaseGate = releaseGate;
    this.benchmark = benchmark;
    this.activeLearning = activeLearning;
    this.learning = learning || training?.learning || null;
    this.training = training;
    this.audit = audit;
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.mode = clampMode(mode);
    this.intervalMs = ms(intervalMs, 300000);
    this.timer = null;
    this.running = false;
    this.lastReport = null;
    this.thresholds = {
      productionScoreWarning: number(thresholds.productionScoreWarning ?? process.env.GOVERNANCE_PRODUCTION_SCORE_WARNING, 80),
      productionScoreCritical: number(thresholds.productionScoreCritical ?? process.env.GOVERNANCE_PRODUCTION_SCORE_CRITICAL, 60),
      benchmarkScore: number(thresholds.benchmarkScore ?? process.env.SENTINEL_RELEASE_GATE_MIN_BENCHMARK_SCORE, 80),
      benchmarkCritical: number(thresholds.benchmarkCritical ?? process.env.GOVERNANCE_BENCHMARK_CRITICAL, 60),
      maxSloBurnWarning: number(thresholds.maxSloBurnWarning ?? process.env.GOVERNANCE_SLO_BURN_WARNING, 0.7),
      maxSloBurnCritical: number(thresholds.maxSloBurnCritical ?? process.env.GOVERNANCE_SLO_BURN_CRITICAL, 1.5),
      maxActiveFailures: number(thresholds.maxActiveFailures ?? process.env.GOVERNANCE_ACTIVE_FAILURES, 8),
      maxConsecutiveFailures: number(thresholds.maxConsecutiveFailures ?? process.env.GOVERNANCE_CONSECUTIVE_FAILURES, 3),
      maxUnsafeShadow: number(thresholds.maxUnsafeShadow ?? process.env.GOVERNANCE_UNSAFE_SHADOW, 0),
      maxRolledBackVersions: number(thresholds.maxRolledBackVersions ?? process.env.GOVERNANCE_ROLLBACK_PRESSURE, 3),
      maxPendingTraining: number(thresholds.maxPendingTraining ?? process.env.GOVERNANCE_PENDING_TRAINING, 25)
    };
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_governance_snapshots(
      snapshot_id BIGSERIAL PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      signals JSONB NOT NULL DEFAULT '[]'::jsonb,
      actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      executed JSONB NOT NULL DEFAULT '[]'::jsonb,
      report JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_governance_snapshots_time ON panthorium_governance_snapshots(created_at DESC)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_governance_snapshots_status ON panthorium_governance_snapshots(status)');
  }

  start() {
    if (this.mode === 'off' || this.timer) return;
    this.timer = setInterval(() => {
      this.evaluate({ source: 'timer', persist: true, execute: this.mode === 'autopilot' }).catch((error) => {
        this.audit?.record?.('governance.cycle_failed', { error: error.message });
      });
    }, this.intervalMs);
    this.timer.unref?.();
    setTimeout(() => {
      this.evaluate({ source: 'boot', persist: true, execute: this.mode === 'autopilot' }).catch(() => {});
    }, 2500).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async setMode(mode, { userId = 'system', requestId } = {}) {
    const next = clampMode(mode);
    const previous = this.mode;
    this.mode = next;
    if (next === 'off') this.stop();
    else this.start();
    this.audit?.record?.('governance.mode_changed', { previous, next, userId, requestId });
    return { ok: true, previous, mode: this.mode, intervalMs: this.intervalMs };
  }

  async status({ execute = false, persist = false, source = 'api' } = {}) {
    return this.evaluate({ execute: execute || this.mode === 'autopilot', persist, source });
  }

  async evaluate({ execute = false, persist = false, source = 'api' } = {}) {
    if (this.running) {
      return this.lastReport || { ok: true, status: 'running', score: 0, mode: this.mode, generatedAt: nowIso(), signals: [], actions: [], executed: [] };
    }
    this.running = true;
    try {
      const telemetry = await this.collectTelemetry({ execute });
      const signals = this.detectSignals(telemetry);
      const actions = this.planActions(signals, telemetry);
      const executed = execute ? await this.executeActions(actions, telemetry) : [];
      const score = this.score(signals);
      const status = this.statusFromSignals(signals);
      const report = {
        ok: status !== 'critical',
        generatedAt: nowIso(),
        phase: 'Phase 13 Production Monitoring & Autonomous Governance',
        source,
        mode: this.mode,
        autopilot: this.mode === 'autopilot',
        intervalMs: this.intervalMs,
        status,
        score,
        signals,
        actions,
        executed,
        telemetry,
        recommendations: this.recommendations(signals, actions),
        controls: {
          manualActivationRequired: true,
          destructiveActionsBlocked: true,
          autopilotStopsUnsafeLoopsOnly: true
        }
      };
      this.lastReport = report;
      if (persist) await this.persist(report);
      this.audit?.record?.('governance.evaluated', { status, score, signals: signals.map((s) => s.code), actions: actions.map((a) => a.id), executed: executed.map((e) => e.actionId), source, mode: this.mode });
      return report;
    } finally {
      this.running = false;
    }
  }

  async collectTelemetry({ execute = false } = {}) {
    const [production, releaseGate, benchmark, activeLearning, learningStatus, versions, training] = await Promise.all([
      this.safe(() => this.production?.overview?.(24, { persist: false }), null),
      this.safe(() => this.releaseGate?.status?.({ auto: execute, record: false }), null),
      this.safe(() => this.benchmark?.status?.(), null),
      this.safe(() => this.activeLearning?.status?.(), null),
      this.safe(() => this.learning?.status?.(), null),
      this.safe(() => this.learning?.repository?.list?.({ limit: 500 }), []),
      this.safe(() => this.training?.list?.({ limit: 1 }), null)
    ]);
    const benchmarkHistory = safeArray(benchmark?.history);
    const lastBenchmark = benchmark?.lastRun || benchmarkHistory[0] || null;
    return {
      production,
      releaseGate,
      benchmark,
      benchmarkHistory,
      lastBenchmark,
      activeLearning,
      learningStatus,
      versions: safeArray(versions),
      training,
      providerCount: safeArray(benchmark?.availableProviders).length
    };
  }

  async safe(fn, fallback) {
    try {
      if (typeof fn !== 'function') return fallback;
      const result = await fn();
      return result == null ? fallback : result;
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  detectSignals(t) {
    const signals = [];
    const p = t.production || {};
    if (p.status === 'critical' || number(p.score, 100) < this.thresholds.productionScoreCritical) signals.push(this.signal('PRODUCTION_CRITICAL', 'critical', `Production score ${number(p.score)} status ${p.status || 'unknown'}`));
    else if (['degraded', 'warning'].includes(p.status) || number(p.score, 100) < this.thresholds.productionScoreWarning) signals.push(this.signal('PRODUCTION_DEGRADED', 'degraded', `Production score ${number(p.score)} status ${p.status || 'unknown'}`));

    const burn = number(p.slo?.burnRate, 0);
    if (burn >= this.thresholds.maxSloBurnCritical) signals.push(this.signal('SLO_BURN_CRITICAL', 'critical', `SLO burn rate ${burn.toFixed(2)}x`));
    else if (burn >= this.thresholds.maxSloBurnWarning) signals.push(this.signal('SLO_BURN_WARNING', 'warning', `SLO burn rate ${burn.toFixed(2)}x`));

    if (t.providerCount === 0) signals.push(this.signal('PROVIDER_UNAVAILABLE', 'critical', 'No enabled benchmark/provider backends are available'));

    const gate = t.releaseGate || {};
    if (gate.ok && gate.mergeAllowed === false) {
      const blockerIds = safeArray(gate.blockers).map((b) => b.id);
      const severity = blockerIds.length === 1 && blockerIds[0] === 'benchmark_evidence' ? 'warning' : 'degraded';
      signals.push(this.signal('RELEASE_GATE_BLOCKED', severity, `Release gate blockers: ${blockerIds.join(', ') || 'unknown'}`, { blockers: blockerIds }));
    }

    const sentinel = gate.evidence?.benchmark || this.sentinelSummary(t.lastBenchmark);
    if (sentinel) {
      const score = number(sentinel.score);
      if (score < this.thresholds.benchmarkCritical) signals.push(this.signal('BENCHMARK_CRITICAL', 'critical', `Sentinel benchmark score ${score} is below ${this.thresholds.benchmarkCritical}`, { score }));
      else if (score < this.thresholds.benchmarkScore) signals.push(this.signal('BENCHMARK_BELOW_GATE', 'degraded', `Sentinel benchmark score ${score} is below release gate ${this.thresholds.benchmarkScore}`, { score }));
      const drift = this.benchmarkDrift(t.benchmarkHistory);
      if (drift.drop >= 12) signals.push(this.signal('BENCHMARK_DRIFT', drift.drop >= 25 ? 'critical' : 'degraded', `Benchmark score dropped ${drift.drop} points`, drift));
    } else if (safeArray(t.benchmarkHistory).length === 0) {
      signals.push(this.signal('BENCHMARK_MISSING', 'warning', 'No benchmark evidence has been recorded yet'));
    }

    const active = t.activeLearning || {};
    const run = active.run || null;
    const stats = run?.stats || {};
    const running = Boolean(active.running);
    if (running && number(stats.unsafeShadow) > this.thresholds.maxUnsafeShadow) signals.push(this.signal('ACTIVE_LEARNING_UNSAFE_SHADOW', 'critical', `Unsafe shadow samples ${number(stats.unsafeShadow)}`, { runId: run?.runId }));
    if (running && number(stats.consecutiveFailures) >= this.thresholds.maxConsecutiveFailures) signals.push(this.signal('ACTIVE_LEARNING_FAILURE_STREAK', 'critical', `Active learning consecutive failures ${number(stats.consecutiveFailures)}`, { runId: run?.runId }));
    if (running && number(stats.failures) >= this.thresholds.maxActiveFailures) signals.push(this.signal('ACTIVE_LEARNING_FAILURE_RATE', 'degraded', `Active learning failures ${number(stats.failures)}`, { runId: run?.runId }));
    if (active.ok && !run && safeArray(active.history).length === 0) signals.push(this.signal('ACTIVE_LEARNING_NO_HISTORY', 'warning', 'Active learning has no run history yet'));

    const versions = safeArray(t.versions);
    const rolledBack = versions.filter((v) => v.state === 'rolled_back').length;
    if (rolledBack >= this.thresholds.maxRolledBackVersions) signals.push(this.signal('ROLLBACK_PRESSURE', rolledBack >= this.thresholds.maxRolledBackVersions * 2 ? 'critical' : 'degraded', `${rolledBack} rolled back learning versions`, { rolledBack }));

    const pending = number(t.training?.stats?.pending, 0);
    if (pending >= this.thresholds.maxPendingTraining) signals.push(this.signal('TRAINING_REVIEW_BACKLOG', 'warning', `${pending} pending training examples`, { pending }));

    return signals.sort((a, b) => rank(b.severity) - rank(a.severity));
  }

  signal(code, severity, message, evidence = {}) {
    return { code, severity, message, evidence, detectedAt: nowIso() };
  }

  benchmarkDrift(history) {
    const scores = safeArray(history).slice(0, 5).map((run) => number(this.sentinelSummary(run)?.score, NaN)).filter(Number.isFinite);
    if (scores.length < 2) return { latest: scores[0] || null, previousBest: null, drop: 0 };
    const latest = scores[0];
    const previousBest = Math.max(...scores.slice(1));
    return { latest, previousBest, drop: Math.max(0, previousBest - latest) };
  }

  sentinelSummary(run) {
    if (!run) return null;
    if (run.summary?.sentinel) return run.summary.sentinel;
    const leaderboard = safeArray(run.leaderboard);
    const index = leaderboard.findIndex((row) => String(row.name || '').toLowerCase().includes('sentinel'));
    if (index < 0) return null;
    const row = leaderboard[index];
    return { rank: index + 1, score: number(row.score), wins: number(row.wins), cases: number(row.cases), passed: number(row.score) >= this.thresholds.benchmarkScore };
  }

  planActions(signals, t) {
    const codes = new Set(signals.map((s) => s.code));
    const actions = [];
    const activeRunning = Boolean(t.activeLearning?.running && t.activeLearning?.run);
    if (activeRunning && (codes.has('PRODUCTION_CRITICAL') || codes.has('SLO_BURN_CRITICAL') || codes.has('ACTIVE_LEARNING_UNSAFE_SHADOW') || codes.has('ACTIVE_LEARNING_FAILURE_STREAK'))) {
      actions.push(this.action('stop_active_learning', 'Stop Active Learning runner', 'critical', 'Pause provider training while production or learning safety is degraded'));
    }
    if (codes.has('RELEASE_GATE_BLOCKED') || codes.has('BENCHMARK_MISSING') || codes.has('BENCHMARK_BELOW_GATE') || codes.has('BENCHMARK_CRITICAL')) {
      const jobRunning = t.releaseGate?.releaseBenchmarkJob?.status === 'running';
      actions.push(this.action(jobRunning ? 'watch_release_gate_benchmark' : 'trigger_release_gate_benchmark', jobRunning ? 'Watch release gate benchmark' : 'Trigger release gate benchmark/repair', 'medium', 'Let Release Gate create benchmark evidence and auto-repair weak cases'));
    }
    if (codes.has('TRAINING_REVIEW_BACKLOG')) actions.push(this.action('run_auto_training_review', 'Run auto training review', 'low', 'Process pending training examples through existing auto-review gates'));
    if (!actions.length) actions.push(this.action('observe', 'Observe only', 'none', 'No autonomous intervention is required'));
    return actions;
  }

  action(id, label, risk, reason) {
    return { id, label, risk, reason, executable: !['observe', 'watch_release_gate_benchmark'].includes(id), plannedAt: nowIso() };
  }

  async executeActions(actions) {
    const executed = [];
    for (const action of actions) {
      if (!action.executable) continue;
      try {
        if (action.id === 'stop_active_learning') {
          const result = await this.activeLearning?.stop?.({ reason: 'governance_guardrail', userId: 'governance:autopilot', requestId: 'phase13-governance' });
          executed.push({ actionId: action.id, ok: Boolean(result?.ok), result: result || null, executedAt: nowIso() });
        } else if (action.id === 'trigger_release_gate_benchmark') {
          const result = await this.releaseGate?.status?.({ auto: true, record: true });
          executed.push({ actionId: action.id, ok: Boolean(result?.ok), mergeAllowed: result?.mergeAllowed, job: result?.releaseBenchmarkJob || null, executedAt: nowIso() });
        } else if (action.id === 'run_auto_training_review') {
          const result = await this.training?.autoProcessPending?.({ limit: 10 });
          executed.push({ actionId: action.id, ok: Boolean(result?.ok), processed: result?.processed || 0, executedAt: nowIso() });
        }
      } catch (error) {
        executed.push({ actionId: action.id, ok: false, error: error.message, executedAt: nowIso() });
      }
    }
    return executed;
  }

  score(signals) {
    const penalty = signals.reduce((sum, s) => sum + (s.severity === 'critical' ? 35 : s.severity === 'degraded' ? 18 : 8), 0);
    return Math.max(0, 100 - penalty);
  }

  statusFromSignals(signals) {
    const highest = signals.reduce((max, s) => Math.max(max, rank(s.severity)), 0);
    return highest >= 3 ? 'critical' : highest >= 2 ? 'degraded' : highest >= 1 ? 'warning' : 'healthy';
  }

  recommendations(signals, actions) {
    const out = [];
    const codes = new Set(signals.map((s) => s.code));
    if (codes.has('PRODUCTION_CRITICAL') || codes.has('SLO_BURN_CRITICAL')) out.push('Hold Production changes and inspect 5xx/SLO burn before enabling high-volume learning workloads.');
    if (codes.has('BENCHMARK_BELOW_GATE') || codes.has('BENCHMARK_CRITICAL')) out.push('Keep Release Gate active and allow the benchmark repair loop to generate and promote only gated learning candidates.');
    if (codes.has('ACTIVE_LEARNING_UNSAFE_SHADOW') || codes.has('ACTIVE_LEARNING_FAILURE_STREAK')) out.push('Stop Active Learning, inspect provider outputs, and resume only after unsafe/failure counters stabilize.');
    if (codes.has('ROLLBACK_PRESSURE')) out.push('Review rolled back learning versions; repeated rollbacks indicate unstable training data or evaluator drift.');
    if (!out.length && actions.some((a) => a.id === 'observe')) out.push('System is inside governance guardrails. Continue monitoring and keep Release Gate evidence current.');
    return out;
  }

  async persist(report) {
    if (!this.pool) return;
    await this.pool.query(
      'INSERT INTO panthorium_governance_snapshots(mode,status,score,signals,actions,executed,report) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)',
      [report.mode, report.status, report.score, JSON.stringify(report.signals), JSON.stringify(report.actions), JSON.stringify(report.executed), JSON.stringify(report)]
    ).catch((error) => this.audit?.record?.('governance.snapshot_failed', { error: error.message }));
  }

  async history({ limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    if (!this.pool) return [];
    const result = await this.pool.query('SELECT snapshot_id AS "snapshotId", mode, status, score, signals, actions, executed, created_at AS "createdAt" FROM panthorium_governance_snapshots ORDER BY created_at DESC LIMIT $1', [safeLimit]);
    return result.rows;
  }

  summary() {
    return {
      ok: true,
      mode: this.mode,
      running: Boolean(this.timer),
      intervalMs: this.intervalMs,
      lastReport: this.lastReport,
      thresholds: this.thresholds
    };
  }
}

module.exports = { AutonomousGovernanceService, clampMode };
