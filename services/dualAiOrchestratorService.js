'use strict';

const { Pool } = require('pg');
const { randomUUID } = require('crypto');

function nowIso() { return new Date().toISOString(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clampMode(mode) { return ['off', 'observe', 'autopilot'].includes(mode) ? mode : 'observe'; }
function clampInt(value, fallback, min, max) { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function clampMs(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(60000, parsed) : fallback; }

const AI_PROFILES = Object.freeze({
  sentinel_core: {
    id: 'sentinel_core',
    label: 'Sentinel Core',
    audience: 'administrator/back-office',
    mission: 'Operate Panthorium back office, observe production, govern learning loops, propose system improvements, and manage Sentinel through safe gates.',
    capabilities: ['system_governance', 'release_gate_supervision', 'training_orchestration', 'benchmark_repair', 'incident_runbook', 'provider_teacher_loop'],
    boundaries: ['no_auto_merge', 'no_auto_deploy', 'no_secret_exposure', 'no_gate_bypass', 'no_unapproved_external_mutation']
  },
  sentinel: {
    id: 'sentinel',
    label: 'Sentinel',
    audience: 'general users',
    mission: 'Serve public users with safe, clear, Thai-first answers and learned Panthorium knowledge that has reached active state.',
    capabilities: ['user_assistance', 'safe_qna', 'active_knowledge_retrieval', 'conversation_learning_capture'],
    boundaries: ['active_only_context', 'no_backoffice_access', 'no_settings_without_permission', 'no_unreviewed_knowledge']
  }
});

const FRONTIER_PATTERNS = Object.freeze([
  { id: 'agent_tools_handoffs_guardrails', label: 'Agent + Tools + Handoffs + Guardrails', appliedTo: ['sentinel_core'], implementation: 'Core can plan actions, delegate through existing agents/tools, and run guardrails before any execution.' },
  { id: 'tracing_and_evaluation', label: 'Tracing + Evaluation + Release Gates', appliedTo: ['sentinel_core', 'sentinel'], implementation: 'Every cycle stores telemetry, proposals, actions, benchmark evidence and governance snapshots.' },
  { id: 'tool_resource_boundary', label: 'Tool/Resource Boundary', appliedTo: ['sentinel_core'], implementation: 'Core uses existing RBAC routes and governance actions instead of direct hidden side effects.' },
  { id: 'grounded_tool_use', label: 'Grounded tool use and code/execution separation', appliedTo: ['sentinel_core', 'sentinel'], implementation: 'Sentinel answers from active learning context; Core never runs code/deploy/merge automatically.' },
  { id: 'self_improvement_loop', label: 'Self-improvement loop with shadow promotion', appliedTo: ['sentinel'], implementation: 'Provider drafts become training candidates, then auto review, quarantine, shadow, promote and monitor.' }
]);

function sentinelSummary(run, minScore = 80) {
  if (!run) return null;
  if (run.summary?.sentinel) return run.summary.sentinel;
  const leaderboard = safeArray(run.leaderboard);
  const index = leaderboard.findIndex((row) => String(row.name || '').toLowerCase().includes('sentinel'));
  if (index < 0) return null;
  const row = leaderboard[index];
  return { rank: index + 1, score: number(row.score), wins: number(row.wins), cases: number(row.cases), passed: number(row.score) >= minScore };
}

class DualAiOrchestratorService {
  constructor({
    core,
    training,
    learning,
    releaseGate,
    benchmark,
    activeLearning,
    governance,
    production,
    providers,
    audit,
    databaseUrl = '',
    databaseSslMode = 'disable',
    mode = process.env.PANTHORIUM_DUAL_AI_MODE || 'observe',
    intervalMs = process.env.PANTHORIUM_DUAL_AI_INTERVAL_MS || 300000,
    benchmarkScore = process.env.SENTINEL_RELEASE_GATE_MIN_BENCHMARK_SCORE || 80
  } = {}) {
    this.core = core;
    this.training = training;
    this.learning = learning || training?.learning || null;
    this.releaseGate = releaseGate;
    this.benchmark = benchmark;
    this.activeLearning = activeLearning;
    this.governance = governance;
    this.production = production;
    this.providers = providers || core?.providers;
    this.audit = audit;
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.mode = clampMode(mode);
    this.intervalMs = clampMs(intervalMs, 300000);
    this.timer = null;
    this.running = false;
    this.lastCycle = null;
    this.thresholds = { benchmarkScore: number(benchmarkScore, 80) };
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_dual_ai_cycles(
      cycle_id UUID PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      scope TEXT NOT NULL,
      core_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      sentinel_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      proposals JSONB NOT NULL DEFAULT '[]'::jsonb,
      executed JSONB NOT NULL DEFAULT '[]'::jsonb,
      report JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      error TEXT
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_dual_ai_cycles_started ON panthorium_dual_ai_cycles(started_at DESC)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_dual_ai_cycles_status ON panthorium_dual_ai_cycles(status)');
  }

  start() {
    if (this.mode === 'off' || this.timer) return;
    this.timer = setInterval(() => {
      this.cycle({ source: 'timer', persist: true, execute: this.mode === 'autopilot' }).catch((error) => this.audit?.record?.('dual_ai.cycle_failed', { error: error.message }));
    }, this.intervalMs);
    this.timer.unref?.();
    setTimeout(() => {
      this.cycle({ source: 'boot', persist: true, execute: this.mode === 'autopilot' }).catch(() => {});
    }, 3500).unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async setMode(mode, { userId = 'system', requestId } = {}) {
    const previous = this.mode;
    this.mode = clampMode(mode);
    if (this.mode === 'off') this.stop(); else this.start();
    this.audit?.record?.('dual_ai.mode_changed', { previous, next: this.mode, userId, requestId });
    return { ok: true, previous, mode: this.mode, intervalMs: this.intervalMs };
  }

  async status() {
    return {
      ok: true,
      mode: this.mode,
      running: Boolean(this.timer),
      processing: this.running,
      intervalMs: this.intervalMs,
      profiles: AI_PROFILES,
      architecturePatterns: FRONTIER_PATTERNS,
      boundaries: this.boundaries(),
      providers: this.providers?.available?.() || [],
      lastCycle: this.lastCycle,
      history: await this.history({ limit: 10 })
    };
  }

  boundaries() {
    return {
      sentinelCoreCan: ['observe_production', 'evaluate_release_gate', 'trigger_gated_benchmark_repair', 'stop_unsafe_learning', 'draft_training_candidates', 'run_auto_review_backlog'],
      sentinelCoreCannot: ['merge_pull_requests', 'deploy_render', 'bypass_rbac', 'bypass_quarantine_shadow_promote', 'read_or_expose_provider_secrets'],
      sentinelCan: ['answer_users', 'use_active_learning_context', 'capture_conversations_for_review'],
      sentinelCannot: ['admin_backoffice_actions', 'use_shadow_or_rolled_back_knowledge', 'promote_its_own_training_without_gates']
    };
  }

  async cycle({ execute = false, persist = false, source = 'api', scope = 'dual-ai-24h' } = {}) {
    if (this.running) return this.lastCycle || { ok: true, status: 'running', score: 0, proposals: [], executed: [] };
    this.running = true;
    const cycleId = randomUUID();
    const startedAt = nowIso();
    try {
      const telemetry = await this.collectTelemetry({ execute });
      const proposals = this.plan(telemetry);
      const executed = execute ? await this.execute(proposals, telemetry) : [];
      const report = this.buildReport({ cycleId, source, scope, telemetry, proposals, executed, startedAt });
      this.lastCycle = report;
      if (persist) await this.persist(report);
      this.audit?.record?.('dual_ai.cycle_completed', { cycleId, source, mode: this.mode, score: report.score, proposals: proposals.map((p) => p.id), executed: executed.map((e) => e.proposalId) });
      return report;
    } catch (error) {
      const failed = { ok: false, cycleId, mode: this.mode, status: 'failed', score: 0, source, scope, startedAt, completedAt: nowIso(), error: error.message, profiles: AI_PROFILES };
      this.lastCycle = failed;
      if (persist) await this.persist(failed).catch(() => {});
      this.audit?.record?.('dual_ai.cycle_failed', { cycleId, error: error.message });
      return failed;
    } finally {
      this.running = false;
    }
  }

  async collectTelemetry({ execute = false } = {}) {
    const [production, governance, releaseGate, benchmark, activeLearning, learningStatus, versions, training] = await Promise.all([
      this.safe(() => this.production?.overview?.(24, { persist: false }), null),
      this.safe(() => this.governance?.status?.({ execute: false, persist: false, source: 'dual-ai' }), null),
      this.safe(() => this.releaseGate?.status?.({ auto: execute, record: false }), null),
      this.safe(() => this.benchmark?.status?.(), null),
      this.safe(() => this.activeLearning?.status?.(), null),
      this.safe(() => this.learning?.status?.(), null),
      this.safe(() => this.learning?.repository?.list?.({ limit: 500 }), []),
      this.safe(() => this.training?.list?.({ limit: 5 }), null)
    ]);
    const benchmarkHistory = safeArray(benchmark?.history);
    const lastBenchmark = benchmark?.lastRun || benchmarkHistory[0] || null;
    return { production, governance, releaseGate, benchmark, benchmarkHistory, lastBenchmark, activeLearning, learningStatus, versions: safeArray(versions), training, providerCount: safeArray(benchmark?.availableProviders || this.providers?.available?.()).length };
  }

  async safe(fn, fallback) {
    try { if (typeof fn !== 'function') return fallback; const result = await fn(); return result == null ? fallback : result; }
    catch (error) { return { ok: false, error: error.message }; }
  }

  plan(t) {
    const proposals = [];
    const availableProviders = this.providers?.available?.() || [];
    const releaseBlocked = t.releaseGate?.ok && t.releaseGate.mergeAllowed === false;
    const sentinel = t.releaseGate?.evidence?.benchmark || sentinelSummary(t.lastBenchmark, this.thresholds.benchmarkScore);
    const benchmarkLow = sentinel && number(sentinel.score) < this.thresholds.benchmarkScore;
    const benchmarkMissing = !sentinel && safeArray(t.benchmarkHistory).length === 0;
    const activeRunning = Boolean(t.activeLearning?.running && t.activeLearning?.run);
    const activeStats = t.activeLearning?.run?.stats || {};
    const governanceSignals = safeArray(t.governance?.signals);
    const criticalGovernance = governanceSignals.some((s) => s.severity === 'critical');
    const pending = number(t.training?.stats?.pending, 0);

    if (criticalGovernance || number(activeStats.unsafeShadow) > 0 || number(activeStats.consecutiveFailures) >= 3) {
      proposals.push(this.proposal('core_guard_active_learning', 'sentinel_core', 'critical', 'Ask Governance to execute safe guardrails and stop unsafe learning loops if needed.'));
    }
    if (releaseBlocked || benchmarkMissing || benchmarkLow) {
      proposals.push(this.proposal('core_trigger_release_gate', 'sentinel_core', 'medium', 'Run Release Gate automation so benchmark evidence and repair loop stay current.'));
    }
    if (benchmarkLow && availableProviders.length) {
      proposals.push(this.proposal('sentinel_benchmark_repair_training', 'sentinel', 'medium', `Draft provider training candidates for weak benchmark areas. Latest Sentinel score ${number(sentinel.score)} / target ${this.thresholds.benchmarkScore}.`));
    }
    if (!activeRunning && availableProviders.length && !criticalGovernance && !(t.production?.status === 'critical')) {
      proposals.push(this.proposal('sentinel_24h_learning_runner', 'sentinel', 'medium', 'Maintain a bounded 24h provider learning run with manual activation and guardrails.'));
    }
    if (pending >= 10) proposals.push(this.proposal('core_training_review_backlog', 'sentinel_core', 'low', `Process pending training backlog through existing auto-review gates. Pending ${pending}.`));
    if (!proposals.length) proposals.push(this.proposal('dual_ai_observe', 'sentinel_core', 'none', 'Both Sentinel Core and Sentinel are inside guardrails; keep observing.'));
    return proposals;
  }

  proposal(id, target, risk, reason) {
    return { id, target, risk, reason, executable: id !== 'dual_ai_observe', createdAt: nowIso() };
  }

  async execute(proposals, telemetry) {
    const executed = [];
    for (const proposal of proposals) {
      if (!proposal.executable) continue;
      try {
        let result = null;
        if (proposal.id === 'core_guard_active_learning') {
          result = await this.governance?.status?.({ execute: true, persist: true, source: 'dual-ai-core-guard' });
        } else if (proposal.id === 'core_trigger_release_gate') {
          result = await this.releaseGate?.status?.({ auto: true, record: true });
        } else if (proposal.id === 'sentinel_benchmark_repair_training') {
          result = await this.draftSentinelRepairTraining(telemetry);
        } else if (proposal.id === 'sentinel_24h_learning_runner') {
          result = await this.activeLearning?.start?.({ durationHours: 24, intervalMinutes: 5, batchSize: 1, topics: ['Panthorium OS', 'Sentinel AI', 'least privilege', 'autonomous learning', 'release gate'], userId: 'dual-ai:sentinel-core', requestId: 'phase14-dual-ai' });
        } else if (proposal.id === 'core_training_review_backlog') {
          result = await this.training?.autoProcessPending?.({ limit: 10 });
        }
        executed.push({ proposalId: proposal.id, ok: result ? result.ok !== false : false, result: this.compactResult(result), executedAt: nowIso() });
      } catch (error) {
        executed.push({ proposalId: proposal.id, ok: false, error: error.message, executedAt: nowIso() });
      }
    }
    return executed;
  }

  async draftSentinelRepairTraining(t) {
    const providers = this.providers?.available?.() || [];
    if (!providers.length) return { ok: false, error: 'no_teacher_provider' };
    const sentinel = t.releaseGate?.evidence?.benchmark || sentinelSummary(t.lastBenchmark, this.thresholds.benchmarkScore) || { score: 0 };
    const prompt = [
      'สร้าง training answer ภาษาไทยสำหรับ Sentinel ผู้ใช้งานทั่วไปของ Panthorium OS',
      'เป้าหมาย: ให้คำตอบถูกต้อง ชัดเจน ปลอดภัย ใช้ได้กับผู้ใช้ทั่วไป ไม่กล่าวอ้างเกินจริง',
      `บริบท benchmark ล่าสุด: Sentinel score ${number(sentinel.score)} จาก target ${this.thresholds.benchmarkScore}`,
      'หัวข้อที่ต้องครอบคลุม: Panthorium OS, Sentinel AI, least privilege, autonomous learning loop, rollback, recovery, release gate, benchmark evidence',
      'ห้ามเปิดเผย secret, ห้ามอ้างว่าสามารถ deploy/merge เอง, ห้าม bypass approval gate'
    ].join('\n');
    return this.training?.draftWithTeachers?.({ prompt, providerNames: providers.slice(0, 3), tags: ['phase14', 'dual-ai', 'sentinel', 'benchmark-repair'], user: { sub: 'dual-ai:sentinel-core' }, requestId: 'phase14-dual-ai' });
  }

  compactResult(result) {
    if (!result) return null;
    return {
      ok: result.ok !== false,
      error: result.error || null,
      status: result.status || null,
      score: result.score || result.evidence?.benchmark?.score || result.telemetry?.releaseGate?.score || null,
      candidates: safeArray(result.candidates).length,
      failures: safeArray(result.failures).length,
      running: result.running || null,
      mergeAllowed: result.mergeAllowed ?? null,
      runId: result.run?.runId || result.runId || null
    };
  }

  buildReport({ cycleId, source, scope, telemetry, proposals, executed, startedAt }) {
    const critical = proposals.some((p) => p.risk === 'critical');
    const medium = proposals.some((p) => p.risk === 'medium');
    const score = Math.max(0, 100 - proposals.reduce((sum, p) => sum + (p.risk === 'critical' ? 30 : p.risk === 'medium' ? 12 : p.risk === 'low' ? 5 : 0), 0));
    return {
      ok: !critical,
      cycleId,
      phase: 'Phase 14 Dual AI Control Plane',
      source,
      scope,
      mode: this.mode,
      status: critical ? 'critical' : medium ? 'improving' : 'healthy',
      score,
      startedAt,
      completedAt: nowIso(),
      profiles: AI_PROFILES,
      architecturePatterns: FRONTIER_PATTERNS,
      coreState: this.coreState(telemetry),
      sentinelState: this.sentinelState(telemetry),
      proposals,
      executed,
      telemetry: this.telemetrySummary(telemetry),
      safety: this.boundaries()
    };
  }

  coreState(t) {
    return { productionStatus: t.production?.status || null, governanceStatus: t.governance?.status || null, releaseGateMergeAllowed: t.releaseGate?.mergeAllowed ?? null, providerCount: t.providerCount };
  }

  sentinelState(t) {
    const sentinel = t.releaseGate?.evidence?.benchmark || sentinelSummary(t.lastBenchmark, this.thresholds.benchmarkScore);
    return { benchmark: sentinel || null, activeLearningRunning: Boolean(t.activeLearning?.running), learningVersions: safeArray(t.versions).length, activeVersions: safeArray(t.versions).filter((v) => v.state === 'active').length };
  }

  telemetrySummary(t) {
    return { production: { status: t.production?.status, score: t.production?.score }, governance: { status: t.governance?.status, score: t.governance?.score, signals: safeArray(t.governance?.signals).map((s) => s.code) }, releaseGate: { mergeAllowed: t.releaseGate?.mergeAllowed, score: t.releaseGate?.score, blockers: safeArray(t.releaseGate?.blockers).map((b) => b.id) }, activeLearning: { running: Boolean(t.activeLearning?.running), status: t.activeLearning?.run?.status || null }, benchmark: this.sentinelState(t).benchmark };
  }

  async persist(report) {
    if (!this.pool) return;
    await this.pool.query(
      'INSERT INTO panthorium_dual_ai_cycles(cycle_id,mode,status,score,scope,core_state,sentinel_state,proposals,executed,report,started_at,completed_at,error) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13)',
      [report.cycleId, report.mode, report.status, report.score, report.scope, JSON.stringify(report.coreState || {}), JSON.stringify(report.sentinelState || {}), JSON.stringify(report.proposals || []), JSON.stringify(report.executed || []), JSON.stringify(report), report.startedAt, report.completedAt || nowIso(), report.error || null]
    ).catch((error) => this.audit?.record?.('dual_ai.snapshot_failed', { error: error.message }));
  }

  async history({ limit = 20 } = {}) {
    const safeLimit = clampInt(limit, 20, 1, 100);
    if (!this.pool) return this.lastCycle ? [this.lastCycle] : [];
    const result = await this.pool.query('SELECT cycle_id AS "cycleId", mode, status, score, scope, core_state AS "coreState", sentinel_state AS "sentinelState", proposals, executed, started_at AS "startedAt", completed_at AS "completedAt", error FROM panthorium_dual_ai_cycles ORDER BY started_at DESC LIMIT $1', [safeLimit]);
    return result.rows;
  }
}

module.exports = { DualAiOrchestratorService, AI_PROFILES, FRONTIER_PATTERNS, clampMode };
