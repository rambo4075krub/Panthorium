'use strict';
const { getDatabasePool } = require('./databasePool');
function failure(code, status = 400) { const error = new Error(code); error.code = code; error.status = status; return error; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
class CloudAppRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', pool, allowMemory = false, required = false, clock = Date.now } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.required = required === true;
    this.allowMemory = allowMemory === true && !this.required;
    this.clock = clock;
    this.ready = false;
    this.sessions = new Map();
    this.runs = new Map();
  }
  async init() {
    if (!this.pool) { if (this.required) throw failure('cloud_apps_database_required',503); this.ready = this.allowMemory; return; }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_cloud_app_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, scope TEXT NOT NULL,
      pack_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_cloud_app_sessions_owner ON panthorium_cloud_app_sessions(user_id, expires_at);
      CREATE TABLE IF NOT EXISTS panthorium_cloud_app_runs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, scope TEXT NOT NULL,
      pack_id TEXT NOT NULL, feature_id TEXT NOT NULL, session_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
      data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE(user_id,idempotency_key));
      CREATE INDEX IF NOT EXISTS idx_cloud_app_runs_owner ON panthorium_cloud_app_runs(user_id,created_at DESC);`);
    this.ready = true;
  }
  requireReady() { if (!this.ready) throw failure('cloud_apps_storage_unavailable', 503); }
  async createSession(session) {
    this.requireReady();
    if (this.pool) await this.pool.query('INSERT INTO panthorium_cloud_app_sessions(id,user_id,scope,pack_id,expires_at,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [session.id, session.userId, session.scope, session.packId, session.expiresAt, JSON.stringify(session)]);
    else this.sessions.set(session.id, clone(session));
    return clone(session);
  }
  async getSession(userId, id) {
    this.requireReady();
    if (this.pool) { const result = await this.pool.query('SELECT data FROM panthorium_cloud_app_sessions WHERE id=$1 AND user_id=$2', [id, userId]); return clone(result.rows[0]?.data || null); }
    const session = this.sessions.get(id); return session?.userId === userId ? clone(session) : null;
  }
  async reserve(run, limits) {
    this.requireReady();
    const staleBefore = new Date(this.clock() - limits.timeoutMs - 30000).toISOString();
    const minuteBefore = new Date(this.clock() - 60000).toISOString();
    const dayBefore = new Date(this.clock() - 86400000).toISOString();
    if (!this.pool) {
      const previous = [...this.runs.values()].find(item => item.userId === run.userId && item.idempotencyKey === run.idempotencyKey);
      if (previous) { if (previous.fingerprint !== run.fingerprint) throw failure('cloud_apps_idempotency_conflict', 409); return { created: false, run: clone(previous) }; }
      const own = [...this.runs.values()].filter(item => item.userId === run.userId);
      for (const item of own) if (item.status === 'running' && item.createdAt < staleBefore) { item.status = 'failed'; item.error = 'execution_interrupted'; item.updatedAt = new Date(this.clock()).toISOString(); }
      this.checkLimits(own, minuteBefore, dayBefore, limits);
      this.runs.set(run.id, clone(run)); return { created: true, run: clone(run) };
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cloud-apps:' + run.userId]);
      const previous = await client.query('SELECT data FROM panthorium_cloud_app_runs WHERE user_id=$1 AND idempotency_key=$2', [run.userId, run.idempotencyKey]);
      if (previous.rows[0]) {
        const item = previous.rows[0].data;
        if (item.fingerprint !== run.fingerprint) throw failure('cloud_apps_idempotency_conflict', 409);
        await client.query('COMMIT'); return { created: false, run: clone(item) };
      }
      const stalePatch = {status:'failed',error:'execution_interrupted',updatedAt:new Date(this.clock()).toISOString()};
      const stale = await client.query("SELECT data FROM panthorium_cloud_app_runs WHERE user_id=$1 AND status='running' AND created_at<$2", [run.userId,staleBefore]);
      for (const row of stale.rows) await client.query("UPDATE panthorium_cloud_app_runs SET status='failed',updated_at=$3,data=$4::jsonb WHERE id=$1 AND user_id=$2 AND status='running'", [row.data.id,run.userId,stalePatch.updatedAt,JSON.stringify({...row.data,...stalePatch})]);
      const recent = await client.query('SELECT data FROM panthorium_cloud_app_runs WHERE user_id=$1 AND (created_at>=$2 OR status=$3)', [run.userId, dayBefore, 'running']);
      this.checkLimits(recent.rows.map(row => row.data), minuteBefore, dayBefore, limits);
      await client.query('INSERT INTO panthorium_cloud_app_runs(id,user_id,scope,pack_id,feature_id,session_id,idempotency_key,fingerprint,status,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)', [run.id,run.userId,run.scope,run.packId,run.featureId,run.sessionId,run.idempotencyKey,run.fingerprint,run.status,JSON.stringify(run),run.createdAt,run.updatedAt]);
      await client.query('COMMIT'); return { created: true, run: clone(run) };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  checkLimits(runs, minuteBefore, dayBefore, limits) {
    if (runs.some(item => item.status === 'running')) throw failure('cloud_apps_run_in_progress', 409);
    if (runs.filter(item => item.createdAt >= minuteBefore).length >= limits.maxRunsPerMinute || runs.filter(item => item.createdAt >= dayBefore).length >= limits.maxRunsPerDay) throw failure('cloud_apps_rate_limit', 429);
  }
  async get(userId, id) {
    this.requireReady();
    if (this.pool) { const result = await this.pool.query('SELECT data FROM panthorium_cloud_app_runs WHERE id=$1 AND user_id=$2', [id,userId]); return clone(result.rows[0]?.data || null); }
    const run = this.runs.get(id); return run?.userId === userId ? clone(run) : null;
  }
  async finish(userId, id, patch) {
    this.requireReady();
    // Single conditional update prevents a late provider response from overwriting cancellation.
    const update = { ...clone(patch), updatedAt: new Date(this.clock()).toISOString() };
    if (this.pool) {
      const current = await this.get(userId,id);
      if (!current || current.status !== 'running') return current;
      const result = await this.pool.query(`UPDATE panthorium_cloud_app_runs SET status=$3,updated_at=$4,data=$5::jsonb WHERE id=$1 AND user_id=$2 AND status='running' RETURNING data`, [id,userId,update.status,update.updatedAt,JSON.stringify({...current,...update})]);
      return clone(result.rows[0]?.data || await this.get(userId,id));
    }
    const run = this.runs.get(id);
    if (run?.userId !== userId) return null;
    if (run.status === 'running') Object.assign(run, update);
    return clone(run);
  }
  async list(userId, { limit = 30, packId = '', idempotencyKey = '', scope = 'personal' } = {}) {
    this.requireReady();
    const count = Math.max(1, Math.min(Number(limit) || 30, 100));
    if (this.pool) {
      const result = await this.pool.query('SELECT data FROM panthorium_cloud_app_runs WHERE user_id=$1 AND ($2=\'\' OR pack_id=$2) AND ($3=\'\' OR idempotency_key=$3) AND scope=$4 ORDER BY created_at DESC LIMIT $5', [userId,packId,idempotencyKey,scope,count]);
      return result.rows.map(row => clone(row.data));
    }
    return [...this.runs.values()].filter(item => item.userId === userId && item.scope === scope && (!packId || item.packId === packId) && (!idempotencyKey || item.idempotencyKey === idempotencyKey)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,count).map(clone);
  }
}
module.exports = { CloudAppRepository, failure };
