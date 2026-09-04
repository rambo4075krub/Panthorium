const { Pool } = require('pg');
const { randomUUID } = require('crypto');

class AgentJobRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable' } = {}) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.memory = new Map();
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_agent_jobs (
        job_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        request TEXT NOT NULL,
        provider TEXT,
        run_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        workflow_id TEXT,
        result JSONB,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_at TIMESTAMPTZ,
        locked_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_jobs_due ON panthorium_agent_jobs(status, run_at);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_jobs_user_time ON panthorium_agent_jobs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_jobs_workflow ON panthorium_agent_jobs(workflow_id);
    `);
  }

  normalize(row = {}) {
    return {
      jobId: row.jobId || randomUUID(),
      userId: row.userId,
      userContext: row.userContext || {},
      request: String(row.request || '').slice(0, 8000),
      provider: row.provider || null,
      runAt: row.runAt instanceof Date ? row.runAt.toISOString() : String(row.runAt || new Date().toISOString()),
      status: row.status || 'scheduled',
      workflowId: row.workflowId || null,
      result: row.result || null,
      error: row.error || null,
      attempts: Number(row.attempts) || 0,
      lockedAt: row.lockedAt || null,
      lockedBy: row.lockedBy || null,
      createdAt: row.createdAt || new Date().toISOString(),
      updatedAt: row.updatedAt || new Date().toISOString(),
      completedAt: row.completedAt || null,
      cancelledAt: row.cancelledAt || null
    };
  }

  mapRow(row) {
    if (!row) return null;
    return this.normalize({
      jobId: row.jobId, userId: row.userId, userContext: row.userContext, request: row.request, provider: row.provider,
      runAt: row.runAt, status: row.status, workflowId: row.workflowId, result: row.result, error: row.error,
      attempts: row.attempts, lockedAt: row.lockedAt, lockedBy: row.lockedBy, createdAt: row.createdAt,
      updatedAt: row.updatedAt, completedAt: row.completedAt, cancelledAt: row.cancelledAt
    });
  }

  async create(input) {
    const item = this.normalize(input);
    if (this.pool) {
      const result = await this.pool.query(`
        INSERT INTO panthorium_agent_jobs(job_id,user_id,user_context,request,provider,run_at,status,workflow_id,result,error,attempts,created_at,updated_at)
        VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
        RETURNING job_id AS "jobId", user_id AS "userId", user_context AS "userContext", request, provider, run_at AS "runAt", status, workflow_id AS "workflowId", result, error, attempts, locked_at AS "lockedAt", locked_by AS "lockedBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt"`,
        [item.jobId,item.userId,JSON.stringify(item.userContext),item.request,item.provider,item.runAt,item.status,item.workflowId,JSON.stringify(item.result),item.error,item.attempts,item.createdAt,item.updatedAt]
      );
      return this.mapRow(result.rows[0]);
    }
    this.memory.set(item.jobId, item); return item;
  }

  async get(userId, jobId) {
    if (!this.pool) { const item = this.memory.get(String(jobId || '')); return item && item.userId === userId ? item : null; }
    const result = await this.pool.query(`SELECT job_id AS "jobId", user_id AS "userId", user_context AS "userContext", request, provider, run_at AS "runAt", status, workflow_id AS "workflowId", result, error, attempts, locked_at AS "lockedAt", locked_by AS "lockedBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt" FROM panthorium_agent_jobs WHERE job_id=$1 AND user_id=$2`, [jobId, userId]);
    return this.mapRow(result.rows[0]);
  }

  async list(userId, limit = 30) {
    const safe = Math.min(Math.max(Number(limit) || 30, 1), 100);
    if (!this.pool) return [...this.memory.values()].filter((j) => j.userId === userId).sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, safe);
    const result = await this.pool.query(`SELECT job_id AS "jobId", user_id AS "userId", user_context AS "userContext", request, provider, run_at AS "runAt", status, workflow_id AS "workflowId", result, error, attempts, locked_at AS "lockedAt", locked_by AS "lockedBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt" FROM panthorium_agent_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, safe]);
    return result.rows.map((row) => this.mapRow(row));
  }

  async cancel(userId, jobId) {
    const now = new Date().toISOString();
    if (!this.pool) {
      const item = this.memory.get(String(jobId || '')); if (!item || item.userId !== userId || !['scheduled','waiting_confirmation'].includes(item.status)) return null;
      const next = { ...item, status: 'cancelled', cancelledAt: now, updatedAt: now, lockedAt: null, lockedBy: null }; this.memory.set(item.jobId, next); return next;
    }
    const result = await this.pool.query(`UPDATE panthorium_agent_jobs SET status='cancelled', cancelled_at=NOW(), updated_at=NOW(), locked_at=NULL, locked_by=NULL WHERE job_id=$1 AND user_id=$2 AND status IN ('scheduled','waiting_confirmation') RETURNING job_id AS "jobId", user_id AS "userId", user_context AS "userContext", request, provider, run_at AS "runAt", status, workflow_id AS "workflowId", result, error, attempts, locked_at AS "lockedAt", locked_by AS "lockedBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt"`, [jobId,userId]);
    return this.mapRow(result.rows[0]);
  }

  async claimDue(workerId, limit = 5) {
    const safe = Math.min(Math.max(Number(limit) || 5, 1), 20); const now = Date.now();
    if (!this.pool) {
      const due = [...this.memory.values()].filter((j) => j.status === 'scheduled' && Date.parse(j.runAt) <= now).sort((a,b) => Date.parse(a.runAt)-Date.parse(b.runAt)).slice(0,safe);
      return due.map((item) => { const next = { ...item, status: 'running', attempts: item.attempts + 1, lockedAt: new Date().toISOString(), lockedBy: workerId, updatedAt: new Date().toISOString() }; this.memory.set(item.jobId,next); return next; });
    }
    const result = await this.pool.query(`
      WITH due AS (
        SELECT job_id FROM panthorium_agent_jobs
        WHERE status='scheduled' AND run_at <= NOW()
        ORDER BY run_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE panthorium_agent_jobs j
      SET status='running', attempts=j.attempts+1, locked_at=NOW(), locked_by=$2, updated_at=NOW()
      FROM due WHERE j.job_id=due.job_id
      RETURNING j.job_id AS "jobId", j.user_id AS "userId", j.user_context AS "userContext", j.request, j.provider, j.run_at AS "runAt", j.status, j.workflow_id AS "workflowId", j.result, j.error, j.attempts, j.locked_at AS "lockedAt", j.locked_by AS "lockedBy", j.created_at AS "createdAt", j.updated_at AS "updatedAt", j.completed_at AS "completedAt", j.cancelled_at AS "cancelledAt"`, [safe,workerId]);
    return result.rows.map((row) => this.mapRow(row));
  }

  async finish(jobId, patch = {}) {
    const now = new Date().toISOString();
    if (!this.pool) {
      const current = this.memory.get(String(jobId || '')); if (!current) return null;
      const next = { ...current, ...patch, updatedAt: now, lockedAt: null, lockedBy: null }; this.memory.set(current.jobId,next); return next;
    }
    const currentResult = await this.pool.query(`SELECT job_id AS "jobId", user_id AS "userId", user_context AS "userContext", request, provider, run_at AS "runAt", status, workflow_id AS "workflowId", result, error, attempts, locked_at AS "lockedAt", locked_by AS "lockedBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt" FROM panthorium_agent_jobs WHERE job_id=$1`, [jobId]);
    const current = this.mapRow(currentResult.rows[0]); if (!current) return null; const next = { ...current, ...patch };
    const result = await this.pool.query(`UPDATE panthorium_agent_jobs SET status=$2,workflow_id=$3,result=$4::jsonb,error=$5,updated_at=NOW(),completed_at=$6,cancelled_at=$7,locked_at=NULL,locked_by=NULL WHERE job_id=$1 RETURNING job_id AS "jobId", user_id AS "userId", user_context AS "userContext", request, provider, run_at AS "runAt", status, workflow_id AS "workflowId", result, error, attempts, locked_at AS "lockedAt", locked_by AS "lockedBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt"`, [jobId,next.status,next.workflowId,JSON.stringify(next.result),next.error,next.completedAt,next.cancelledAt]);
    return this.mapRow(result.rows[0]);
  }

  async listWaiting(limit = 50) {
    const safe = Math.min(Math.max(Number(limit) || 50,1),100);
    if (!this.pool) return [...this.memory.values()].filter((j) => j.status === 'waiting_confirmation' && j.workflowId).slice(0,safe);
    const result = await this.pool.query(`SELECT job_id AS "jobId", user_id AS "userId", user_context AS "userContext", request, provider, run_at AS "runAt", status, workflow_id AS "workflowId", result, error, attempts, locked_at AS "lockedAt", locked_by AS "lockedBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt" FROM panthorium_agent_jobs WHERE status='waiting_confirmation' AND workflow_id IS NOT NULL ORDER BY updated_at ASC LIMIT $1`, [safe]);
    return result.rows.map((row) => this.mapRow(row));
  }

  async recoverStale(staleMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - staleMs;
    if (!this.pool) {
      let count = 0; for (const [id,item] of this.memory.entries()) if (item.status === 'running' && item.lockedAt && Date.parse(item.lockedAt) < cutoff) { this.memory.set(id,{...item,status:'scheduled',lockedAt:null,lockedBy:null,updatedAt:new Date().toISOString()}); count++; } return count;
    }
    const result = await this.pool.query(`UPDATE panthorium_agent_jobs SET status='scheduled',locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE status='running' AND locked_at < NOW() - ($1 * INTERVAL '1 millisecond')`, [Math.max(1000,Number(staleMs)||900000)]);
    return result.rowCount || 0;
  }
}

module.exports = { AgentJobRepository };