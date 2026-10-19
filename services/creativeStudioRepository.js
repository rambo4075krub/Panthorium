'use strict';

const crypto = require('node:crypto');
const { getDatabasePool } = require('./databasePool');
const copy = value => JSON.parse(JSON.stringify(value));
const date = value => value?.toISOString?.() || value;
const LIMITS = Object.freeze({ dailyJobs: 30, dailyMediaSteps: 10, activeJobs: 2 });
const dayStart = () => new Date(new Date(Date.now() + 7*3600000).toISOString().slice(0,10)+'T00:00:00+07:00');
class CreativeStudioRepositoryError extends Error {
  constructor(code) { super(code); this.name='CreativeStudioRepositoryError'; this.code=code; this.status=429; this.sideEffectNotApplied=true; }
}
function checkLimits(rows, proposed) {
  if (rows.filter(row=>['queued','running'].includes(row.status)).length >= LIMITS.activeJobs) throw new CreativeStudioRepositoryError('studio_active_limit');
  const today=rows.filter(row=>new Date(row.createdAt).getTime()>=dayStart().getTime());
  const media=steps=>(steps||[]).filter(step=>['image','video'].includes(step.pluginId)).length;
  if (today.length >= LIMITS.dailyJobs || today.reduce((sum,row)=>sum+media(row.steps),0)+media(proposed.steps)>LIMITS.dailyMediaSteps) throw new CreativeStudioRepositoryError('studio_daily_limit');
}

// The ledger, including provider operation handles, survives request/instance shutdown.
// An expired lease does not grant permission to repeat an uncertain provider submission.
class PostgresCreativeStudioRepository {
  constructor({ pool, databaseUrl, databaseSslMode = 'require' } = {}) {
    this.pool = pool || getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } });
    this.durable = true;
    this.available = Boolean(this.pool);
  }
  async init() {
    if (!this.available) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_studio_jobs (
        id UUID PRIMARY KEY, owner_id UUID NOT NULL, idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL, status TEXT NOT NULL, data JSONB NOT NULL,
        lease_token UUID, lease_until TIMESTAMPTZ, next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(owner_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_studio_jobs_due ON panthorium_studio_jobs(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_studio_jobs_owner ON panthorium_studio_jobs(owner_id, created_at);
      CREATE TABLE IF NOT EXISTS panthorium_office_drafts (
        owner_id UUID NOT NULL, file_id UUID NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        data JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(owner_id,file_id)
      );
      CREATE TABLE IF NOT EXISTS panthorium_studio_modes (
        owner_id UUID NOT NULL, plugin_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('auto','never')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(owner_id,plugin_id)
      );
    `);
  }
  async getDraft(ownerId,fileId) {
    const row=(await this.pool.query('SELECT version,data,updated_at FROM panthorium_office_drafts WHERE owner_id=$1 AND file_id=$2',[ownerId,fileId])).rows[0];
    return row?{version:row.version,data:row.data,updatedAt:date(row.updated_at)}:{version:0,data:null};
  }
  async saveDraft(ownerId,fileId,version,data) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['office-draft:'+ownerId]);
      const row=(await client.query('SELECT version,data FROM panthorium_office_drafts WHERE owner_id=$1 AND file_id=$2',[ownerId,fileId])).rows[0];
      if((row?.version||0)!==version)throw Object.assign(Error('editor_draft_conflict'),{status:409,code:'editor_draft_conflict'});
      if(data&&!row?.data){const count=(await client.query("SELECT COUNT(*)::int AS n FROM panthorium_office_drafts WHERE owner_id=$1 AND data IS NOT NULL AND data <> 'null'::jsonb",[ownerId])).rows[0].n;if(count>=100)throw Object.assign(Error('editor_draft_limit'),{status:429,code:'editor_draft_limit'});}
      const result=await client.query(`INSERT INTO panthorium_office_drafts(owner_id,file_id,version,data) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(owner_id,file_id) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data,updated_at=NOW() RETURNING version,data,updated_at`,[ownerId,fileId,version+1,JSON.stringify(data)]);
      await client.query('COMMIT');const saved=result.rows[0];return {version:saved.version,data:saved.data,updatedAt:date(saved.updated_at)};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  map(row) {
    return row ? { ...row.data, id: row.id, ownerId: row.owner_id, fingerprint: row.fingerprint, status: row.status, createdAt: date(row.created_at), updatedAt: date(row.updated_at), leaseToken: row.lease_token || null } : null;
  }
  async create(job) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['studio:'+job.ownerId]);
      const existing = await client.query('SELECT * FROM panthorium_studio_jobs WHERE owner_id=$1 AND idempotency_key=$2', [job.ownerId, job.idempotencyKey]);
      if (existing.rows[0]) { await client.query('COMMIT'); return {job:this.map(existing.rows[0]),created:false}; }
      const rows=await client.query("SELECT * FROM panthorium_studio_jobs WHERE owner_id=$1 AND (created_at >= $2 OR status IN ('queued','running'))",[job.ownerId,dayStart()]);
      checkLimits(rows.rows.map(row=>this.map(row)),job);
      const result = await client.query(`INSERT INTO panthorium_studio_jobs(id,owner_id,idempotency_key,fingerprint,status,data)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
      [job.id, job.ownerId, job.idempotencyKey, job.fingerprint, job.status, JSON.stringify(job)]);
      await client.query('COMMIT');return {job:this.map(result.rows[0]),created:true};
    } catch(error) { await client.query('ROLLBACK');throw error; }
    finally { client.release(); }
  }
  async get(ownerId, id) { return this.map((await this.pool.query('SELECT * FROM panthorium_studio_jobs WHERE owner_id=$1 AND id=$2', [ownerId, id])).rows[0]); }
  async list(ownerId) { return (await this.pool.query('SELECT * FROM panthorium_studio_jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50', [ownerId])).rows.map(row => this.map(row)); }
  async modes(ownerId) { return Object.fromEntries((await this.pool.query('SELECT plugin_id,mode FROM panthorium_studio_modes WHERE owner_id=$1', [ownerId])).rows.map(row => [row.plugin_id, row.mode])); }
  async setMode(ownerId, pluginId, mode) { await this.pool.query(`INSERT INTO panthorium_studio_modes(owner_id,plugin_id,mode) VALUES($1,$2,$3)
    ON CONFLICT(owner_id,plugin_id) DO UPDATE SET mode=EXCLUDED.mode,updated_at=NOW()`, [ownerId, pluginId, mode]); }
  async claim(ownerId, id) {
    const leaseToken = crypto.randomUUID();
    return this.map((await this.pool.query(`UPDATE panthorium_studio_jobs SET lease_token=$3,lease_until=NOW()+INTERVAL '10 minutes'
      WHERE owner_id=$1 AND id=$2 AND status IN ('queued','running') AND next_run_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW()) RETURNING *`, [ownerId, id, leaseToken])).rows[0]);
  }
  async save(job, { release = false, delayMs = 0 } = {}) {
    const result = await this.pool.query(`UPDATE panthorium_studio_jobs SET status=$4,data=$5::jsonb,updated_at=NOW(),
      next_run_at=NOW()+$6::interval, lease_token=CASE WHEN $7 THEN NULL ELSE lease_token END,
      lease_until=CASE WHEN $7 THEN NULL ELSE lease_until END WHERE owner_id=$1 AND id=$2 AND lease_token=$3 RETURNING *`,
    [job.ownerId, job.id, job.leaseToken, job.status, JSON.stringify(job), `${Math.min(300000, Math.max(0, Number(delayMs) || 0))} milliseconds`, release]);
    if (!result.rows[0]) throw Object.assign(new Error('studio_lease_lost'), { code: 'studio_lease_lost', status: 409 });
    return this.map(result.rows[0]);
  }
  async due(limit = 4) { return (await this.pool.query(`SELECT owner_id,id FROM panthorium_studio_jobs WHERE status IN ('queued','running')
    AND next_run_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW()) ORDER BY next_run_at ASC LIMIT $1`, [Math.min(4, Math.max(1, Number(limit) || 1))])).rows.map(row => ({ ownerId: row.owner_id, id: row.id })); }
}

class MemoryCreativeStudioRepository {
  constructor() { this.available = true; this.durable = false; this.jobs = new Map(); this.policy = new Map(); this.drafts = new Map(); }
  async init() {}
  async getDraft(ownerId,fileId){return copy(this.drafts.get(ownerId+':'+fileId)||{version:0,data:null});}
  async saveDraft(ownerId,fileId,version,data){const old=this.drafts.get(ownerId+':'+fileId)||{version:0};if(old.version!==version)throw Object.assign(Error('editor_draft_conflict'),{status:409,code:'editor_draft_conflict'});const saved={version:version+1,data:copy(data),updatedAt:new Date().toISOString()};this.drafts.set(ownerId+':'+fileId,saved);return copy(saved);}

  async create(job) {
    const existing = [...this.jobs.values()].find(item => item.ownerId === job.ownerId && item.idempotencyKey === job.idempotencyKey);
    if (existing) return { job: copy(existing), created: false };
    checkLimits([...this.jobs.values()].filter(row=>row.ownerId===job.ownerId),job);
    const now = new Date().toISOString(); const row = { ...copy(job), createdAt: now, updatedAt: now, leaseToken: null, leaseUntil: 0, nextRunAt: 0 };
    this.jobs.set(row.id, row); return { job: copy(row), created: true };
  }
  async get(ownerId, id) { const row = this.jobs.get(id); return row?.ownerId === ownerId ? copy(row) : null; }
  async list(ownerId) { return [...this.jobs.values()].filter(row => row.ownerId === ownerId).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(copy); }
  async modes(ownerId) { return { ...(this.policy.get(ownerId) || {}) }; }
  async setMode(ownerId, pluginId, mode) { this.policy.set(ownerId, { ...await this.modes(ownerId), [pluginId]: mode }); }
  async claim(ownerId, id) {
    const row = this.jobs.get(id);
    if (!row || row.ownerId !== ownerId || !['queued','running'].includes(row.status) || row.leaseUntil > Date.now() || row.nextRunAt > Date.now()) return null;
    row.leaseToken = crypto.randomUUID(); row.leaseUntil = Date.now() + 600000; return copy(row);
  }
  async save(job, { release = false, delayMs = 0 } = {}) {
    const row = this.jobs.get(job.id);
    if (!row || row.ownerId !== job.ownerId || row.leaseToken !== job.leaseToken) throw Object.assign(new Error('studio_lease_lost'), { code: 'studio_lease_lost', status: 409 });
    const saved = { ...copy(job), updatedAt: new Date().toISOString(), nextRunAt: Date.now()+delayMs, leaseUntil: release ? 0 : row.leaseUntil, leaseToken: release ? null : row.leaseToken };
    this.jobs.set(job.id,saved); return copy(saved);
  }
  async due(limit = 4) { return [...this.jobs.values()].filter(row => ['queued','running'].includes(row.status) && row.nextRunAt<=Date.now() && row.leaseUntil<=Date.now()).slice(0,limit).map(row=>({ownerId:row.ownerId,id:row.id})); }
}

function createCreativeStudioRepository({ databaseUrl, databaseSslMode, allowMemory = false } = {}) {
  if (databaseUrl) return new PostgresCreativeStudioRepository({ databaseUrl, databaseSslMode });
  if (allowMemory && process.env.NODE_ENV !== 'production') return new MemoryCreativeStudioRepository();
  return new PostgresCreativeStudioRepository();
}
module.exports = { PostgresCreativeStudioRepository, MemoryCreativeStudioRepository, createCreativeStudioRepository, CreativeStudioRepositoryError, LIMITS };
