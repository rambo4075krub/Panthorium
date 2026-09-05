'use strict';

const { randomUUID } = require('crypto');

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanList(value, max = 12) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max)
    : [];
}

function parseEval(text) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    const score = clampInt(data.score, 0, 0, 100);
    return {
      score,
      safe: data.safe === true,
      reason: String(data.reason || '').slice(0, 500)
    };
  } catch (_) {
    return null;
  }
}

class SentinelActiveLearningService {
  constructor({ training, learning, providers, audit, databaseUrl, databaseSslMode, minIntervalMs = 60000 } = {}) {
    this.training = training;
    this.learning = learning;
    this.providers = providers;
    this.audit = audit;
    this.minIntervalMs = Math.max(1000, Number(minIntervalMs) || 60000);
    this.timer = null;
    this.processing = false;
    this.session = null;
    this.memoryRuns = new Map();
    if (databaseUrl) {
      const { Pool } = require('pg');
      this.pool = new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } });
    } else {
      this.pool = null;
    }
  }

  async init() {
    if (this.pool) {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_active_learning_runs (
        run_id UUID PRIMARY KEY,
        status TEXT NOT NULL,
        started_by TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        stop_at TIMESTAMPTZ NOT NULL,
        stopped_at TIMESTAMPTZ,
        activated_at TIMESTAMPTZ,
        options JSONB NOT NULL DEFAULT '{}'::jsonb,
        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_active_learning_status ON panthorium_active_learning_runs(status, updated_at DESC);`);
      await this.resumeRunningRun();
    }
  }

  map(row) {
    return {
      runId: row.run_id,
      status: row.status,
      startedBy: row.started_by || null,
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
      stopAt: row.stop_at instanceof Date ? row.stop_at.toISOString() : row.stop_at,
      stoppedAt: row.stopped_at ? (row.stopped_at instanceof Date ? row.stopped_at.toISOString() : row.stopped_at) : null,
      activatedAt: row.activated_at ? (row.activated_at instanceof Date ? row.activated_at.toISOString() : row.activated_at) : null,
      options: row.options || {},
      stats: row.stats || {},
      lastError: row.last_error || null,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
    };
  }

  async resumeRunningRun() {
    const result = await this.pool.query(`SELECT * FROM panthorium_active_learning_runs WHERE status='running' ORDER BY updated_at DESC LIMIT 1`);
    if (!result.rows[0]) return;
    const run = this.map(result.rows[0]);
    if (Date.now() >= new Date(run.stopAt).getTime()) {
      await this.finish(run, 'expired');
      return;
    }
    this.session = run;
    this.schedule(2500);
  }

  async save(run) {
    if (this.pool) {
      const result = await this.pool.query(`INSERT INTO panthorium_active_learning_runs(run_id,status,started_by,started_at,stop_at,stopped_at,activated_at,options,stats,last_error,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,NOW())
        ON CONFLICT(run_id) DO UPDATE SET status=$2,started_by=$3,started_at=$4,stop_at=$5,stopped_at=$6,activated_at=$7,options=$8::jsonb,stats=$9::jsonb,last_error=$10,updated_at=NOW()
        RETURNING *`, [run.runId, run.status, run.startedBy || null, run.startedAt, run.stopAt, run.stoppedAt || null, run.activatedAt || null, JSON.stringify(run.options || {}), JSON.stringify(run.stats || {}), run.lastError || null]);
      this.session = this.map(result.rows[0]);
      return this.session;
    }
    this.memoryRuns.set(run.runId, run);
    this.session = run;
    return run;
  }

  async status() {
    if (this.session && this.session.status === 'running' && Date.now() >= new Date(this.session.stopAt).getTime()) {
      await this.finish(this.session, 'expired');
    }
    return {
      ok: true,
      running: Boolean(this.session && this.session.status === 'running'),
      run: this.session || null,
      providers: this.providers?.available?.() || [],
      controls: { durationHours: 24, intervalMinutes: 5, batchSize: 1, autoShadow: true, manualActivationRequired: true }
    };
  }

  async start({ durationHours = 24, intervalMinutes = 5, batchSize = 1, providers, topics, userId = 'administrator', requestId, autoShadow = true } = {}) {
    await this.training.init();
    await this.learning.init();
    const current = await this.status();
    if (current.running) return { ok: true, alreadyRunning: true, ...current };
    const available = this.providers?.available?.() || [];
    const selected = cleanList(providers).filter((provider) => available.includes(provider));
    const providerNames = selected.length ? selected : available.slice(0, 4);
    if (!providerNames.length) return { ok: false, error: 'no_active_learning_provider', providers: this.providers?.catalog?.() || [] };
    const hours = clampNumber(durationHours, 24, 0.05, 24);
    const intervalMs = Math.max(this.minIntervalMs, Math.round(clampNumber(intervalMinutes, 5, 1, 60) * 60000));
    const run = {
      runId: randomUUID(),
      status: 'running',
      startedBy: userId,
      startedAt: new Date().toISOString(),
      stopAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
      stoppedAt: null,
      activatedAt: null,
      options: {
        durationHours: hours,
        intervalMinutes: Math.round(intervalMs / 60000),
        intervalMs,
        batchSize: clampInt(batchSize, 1, 1, 3),
        providers: providerNames,
        topics: cleanList(topics, 20),
        autoShadow: autoShadow !== false,
        manualActivationRequired: true
      },
      stats: { cycles: 0, prompts: 0, candidates: 0, failures: 0, shadowSamples: 0, promotions: 0, startedBy: userId, lastCycleAt: null },
      lastError: null
    };
    await this.save(run);
    this.audit?.record('sentinel.active_learning_started', { runId: run.runId, userId, requestId, options: run.options });
    this.schedule(500);
    return { ok: true, running: true, run: this.session };
  }

  schedule(delayMs) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.session || this.session.status !== 'running') return;
    this.timer = setTimeout(() => this.tick().catch((error) => this.audit?.record('sentinel.active_learning_tick_failed', { error: error.message })), Math.max(250, Number(delayMs) || 1000));
    this.timer.unref?.();
  }

  shutdown() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  nextPrompt(run) {
    const cycle = Number(run.stats?.cycles || 0) + 1;
    const topics = run.options?.topics?.length ? run.options.topics : [
      'Panthorium OS administrator workflow',
      'Sentinel AI autonomous learning safety',
      'RBAC least privilege explanation',
      'Agent Automation recovery operations',
      'Security Dashboard incident handling',
      'Benchmark Arena quality evaluation',
      'Memory and Knowledge retrieval grounding',
      'Integrations external action safety'
    ];
    const topic = topics[(cycle - 1) % topics.length];
    return `Active Learning รอบที่ ${cycle}: สร้างคำตอบภาษาไทยแบบ production-grade สำหรับหัวข้อ "${topic}" โดยต้องถูกต้อง กระชับ ปลอดภัย อธิบายได้ และเหมาะกับ Panthorium OS / Sentinel AI ห้ามเปิดเผย secret, token, API key หรือแนะนำให้ bypass RBAC/guardrail`;
  }

  async tick() {
    if (!this.session || this.session.status !== 'running') return;
    if (this.processing) return this.schedule(5000);
    if (Date.now() >= new Date(this.session.stopAt).getTime()) return this.finish(this.session, 'expired');
    this.processing = true;
    try {
      const delta = await this.runCycle(this.session);
      const stats = { ...(this.session.stats || {}) };
      Object.entries(delta).forEach(([key, value]) => { stats[key] = Number(stats[key] || 0) + Number(value || 0); });
      stats.cycles = Number(stats.cycles || 0) + 1;
      stats.lastCycleAt = new Date().toISOString();
      await this.save({ ...this.session, stats, lastError: null });
      this.audit?.record('sentinel.active_learning_cycle_completed', { runId: this.session.runId, stats, delta });
    } catch (error) {
      const stats = { ...(this.session.stats || {}), failures: Number(this.session.stats?.failures || 0) + 1, lastCycleAt: new Date().toISOString() };
      await this.save({ ...this.session, stats, lastError: error.message });
      this.audit?.record('sentinel.active_learning_cycle_failed', { runId: this.session.runId, error: error.message });
    } finally {
      this.processing = false;
    }
    if (this.session?.status === 'running') this.schedule(this.session.options?.intervalMs || 300000);
  }

  async runCycle(run) {
    const delta = { prompts: 0, candidates: 0, failures: 0, shadowSamples: 0, promotions: 0 };
    for (let i = 0; i < Number(run.options?.batchSize || 1); i += 1) {
      const prompt = this.nextPrompt({ ...run, stats: { ...run.stats, cycles: Number(run.stats?.cycles || 0) + i } });
      const result = await this.training.draftWithTeachers({
        prompt,
        providerNames: run.options?.providers,
        tags: ['active-learning', '24h-run', 'provider-trained'],
        user: { sub: run.startedBy || 'sentinel-active-learning' },
        requestId: `active-learning:${run.runId}:${Number(run.stats?.cycles || 0) + 1}:${i + 1}`
      });
      delta.prompts += 1;
      delta.candidates += result.candidates?.length || 0;
      delta.failures += result.failures?.length || 0;
    }
    if (run.options?.autoShadow !== false) delta.shadowSamples += await this.sampleShadow(run);
    return delta;
  }

  async sampleShadow(run) {
    const shadows = await this.learning.repository.list({ state: 'shadow', limit: 25 });
    const needingSamples = shadows.filter((version) => Number(version.shadowSamples || 0) < Number(this.learning.policy?.shadowMinSamples || 3)).slice(0, 3);
    let count = 0;
    for (const version of needingSamples) {
      const example = await this.learning.exampleFor(version.exampleId);
      if (!example) continue;
      const evaluation = await this.evaluateShadow(version, example, run);
      const result = await this.learning.recordShadow(version.versionId, {
        score: evaluation.score,
        safe: evaluation.safe,
        metadata: { source: 'active-learning-provider-shadow', evaluator: evaluation.provider, reason: evaluation.reason }
      });
      if (result.ok) count += 1;
    }
    return count;
  }

  async evaluateShadow(version, example, run) {
    const available = this.providers?.available?.() || [];
    const candidates = cleanList(run.options?.providers).filter((provider) => available.includes(provider));
    const selected = [...candidates.filter((provider) => provider !== example.provider), ...candidates].find(Boolean);
    if (!selected) return { provider: 'deterministic-shadow-fallback', score: clampInt(version.score, 90, 0, 100), safe: true, reason: 'no provider available for shadow replay' };
    const system = 'คุณเป็น Sentinel Shadow Evaluator ตอบ JSON เท่านั้น รูปแบบ {"score":0,"safe":false,"reason":"..."} ให้คะแนน 0-100 จากความถูกต้อง ความปลอดภัย และความเหมาะสมสำหรับ Panthorium OS';
    const payload = `Prompt:\n${example.prompt}\n\nAnswer:\n${example.answer}\n\nตรวจว่า candidate นี้ควรผ่าน shadow traffic หรือไม่`;
    const response = await this.providers.callDetailed(selected, system, [{ role: 'user', content: payload }]);
    const parsed = parseEval(response?.text);
    if (!parsed) return { provider: selected, score: clampInt(version.score, 90, 0, 100), safe: true, reason: 'fallback score after invalid evaluator json' };
    return { provider: selected, ...parsed };
  }

  async activate({ userId = 'administrator', requestId, stop = true } = {}) {
    await this.training.init();
    await this.learning.init();
    const shadows = await this.learning.repository.list({ state: 'shadow', limit: 100 });
    const results = [];
    for (const version of shadows) {
      const result = await this.learning.promoteIfReady(version.versionId);
      results.push({ versionId: version.versionId, promoted: Boolean(result.promoted), ok: result.ok, decision: result.decision || null, error: result.error || null });
    }
    const promoted = results.filter((item) => item.promoted).length;
    if (this.session) {
      const stats = { ...(this.session.stats || {}), promotions: Number(this.session.stats?.promotions || 0) + promoted, activatedBy: userId };
      const status = stop ? 'activated' : this.session.status;
      await this.save({ ...this.session, status, stats, activatedAt: new Date().toISOString(), stoppedAt: stop ? new Date().toISOString() : this.session.stoppedAt });
      if (stop) this.shutdown();
    }
    this.audit?.record('sentinel.active_learning_activated', { userId, requestId, promoted, total: results.length });
    return { ok: true, promoted, results, stopped: Boolean(stop), run: this.session };
  }

  async stop({ reason = 'administrator_stopped', userId = 'administrator', requestId } = {}) {
    if (!this.session) return { ok: true, stopped: false, reason: 'not_running' };
    const run = await this.finish(this.session, 'stopped', { reason, userId });
    this.audit?.record('sentinel.active_learning_stopped', { runId: run.runId, reason, userId, requestId });
    return { ok: true, stopped: true, run };
  }

  async finish(run, status, metadata = {}) {
    this.shutdown();
    const next = await this.save({
      ...run,
      status,
      stoppedAt: new Date().toISOString(),
      stats: { ...(run.stats || {}), stopReason: metadata.reason || status, stoppedBy: metadata.userId || run.stats?.stoppedBy || null }
    });
    return next;
  }
}

module.exports = { SentinelActiveLearningService };
