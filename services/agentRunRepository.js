const { Pool } = require('pg');

class AgentRunRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable' } = {}) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.memory = new Map();
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_agent_runs (
        workflow_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        request TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        status TEXT NOT NULL,
        current_step INTEGER NOT NULL DEFAULT 0,
        step_count INTEGER NOT NULL DEFAULT 0,
        workflow JSONB NOT NULL DEFAULT '{}'::jsonb,
        results JSONB NOT NULL DEFAULT '[]'::jsonb,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_runs_user_time
        ON panthorium_agent_runs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_runs_status
        ON panthorium_agent_runs(status);
    `);
  }

  normalize(run) {
    return {
      workflowId: run.workflowId,
      userId: run.userId,
      request: String(run.request || '').slice(0, 8000),
      provider: run.provider || null,
      model: run.model || null,
      status: run.status || 'planned',
      currentStep: Number(run.currentStep) || 0,
      stepCount: Number(run.stepCount) || 0,
      workflow: run.workflow || {},
      results: run.results || [],
      error: run.error || null,
      createdAt: run.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: run.completedAt || null
    };
  }

  async create(run) {
    const item = this.normalize(run);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO panthorium_agent_runs(workflow_id,user_id,request,provider,model,status,current_step,step_count,workflow,results,error,created_at,updated_at,completed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)
         ON CONFLICT (workflow_id) DO NOTHING`,
        [item.workflowId,item.userId,item.request,item.provider,item.model,item.status,item.currentStep,item.stepCount,JSON.stringify(item.workflow),JSON.stringify(item.results),item.error,item.createdAt,item.updatedAt,item.completedAt]
      );
    } else {
      this.memory.set(item.workflowId, item);
    }
    return item;
  }

  async update(workflowId, patch = {}) {
    if (this.pool) {
      const current = await this.getAny(workflowId); if (!current) return null;
      const next = this.normalize({ ...current, ...patch, workflowId: current.workflowId, userId: current.userId, createdAt: current.createdAt });
      await this.pool.query(
        `UPDATE panthorium_agent_runs SET provider=$2,model=$3,status=$4,current_step=$5,step_count=$6,workflow=$7::jsonb,results=$8::jsonb,error=$9,updated_at=$10,completed_at=$11 WHERE workflow_id=$1`,
        [workflowId,next.provider,next.model,next.status,next.currentStep,next.stepCount,JSON.stringify(next.workflow),JSON.stringify(next.results),next.error,next.updatedAt,next.completedAt]
      );
      return next;
    }
    const current = this.memory.get(workflowId); if (!current) return null;
    const next = this.normalize({ ...current, ...patch, workflowId: current.workflowId, userId: current.userId, createdAt: current.createdAt });
    this.memory.set(workflowId, next); return next;
  }

  async getAny(workflowId) {
    if (!this.pool) return this.memory.get(String(workflowId || '')) || null;
    const result = await this.pool.query(`SELECT workflow_id AS "workflowId", user_id AS "userId", request, provider, model, status, current_step AS "currentStep", step_count AS "stepCount", workflow, results, error, created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt" FROM panthorium_agent_runs WHERE workflow_id=$1`, [workflowId]);
    return result.rows[0] || null;
  }

  async get(userId, workflowId) {
    const run = await this.getAny(workflowId);
    return run && run.userId === userId ? run : null;
  }

  async list(userId, limit = 30) {
    const safe = Math.min(Math.max(Number(limit) || 30, 1), 100);
    if (!this.pool) return [...this.memory.values()].filter((r) => r.userId === userId).sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, safe).map(({ workflow, results, ...r }) => ({ ...r, resultCount: results.length }));
    const result = await this.pool.query(`SELECT workflow_id AS "workflowId", request, provider, model, status, current_step AS "currentStep", step_count AS "stepCount", error, created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", jsonb_array_length(results) AS "resultCount" FROM panthorium_agent_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, safe]);
    return result.rows;
  }
}

module.exports = { AgentRunRepository };
