class MultiAgentRunRepository {
  constructor({ databaseUrl, databaseSslMode } = {}) {
    this.databaseUrl = databaseUrl;
    this.databaseSslMode = databaseSslMode;
    this.pool = null;
    this.memory = new Map();
  }
  async init() {
    if (!this.databaseUrl) return;
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: this.databaseUrl, ssl: this.databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_multi_agent_runs (
      orchestration_id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      request TEXT NOT NULL,
      roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL,
      current_role TEXT,
      workflow_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_multi_agent_user_updated ON panthorium_multi_agent_runs(user_id, updated_at DESC)');
  }
  normalize(row) {
    if (!row) return null;
    return { orchestrationId: row.orchestration_id, userId: row.user_id, request: row.request, roles: row.roles || [], outputs: row.outputs || [], status: row.status, currentRole: row.current_role || null, workflowId: row.workflow_id || null, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  async save(run) {
    const row = { orchestration_id: run.orchestrationId, user_id: run.userId, request: run.request, roles: run.roles || [], outputs: run.outputs || [], status: run.status, current_role: run.currentRole || null, workflow_id: run.workflowId || null, created_at: run.createdAt || new Date().toISOString(), updated_at: new Date().toISOString() };
    if (!this.pool) { this.memory.set(run.orchestrationId, row); return this.normalize(row); }
    const result = await this.pool.query(`INSERT INTO panthorium_multi_agent_runs(orchestration_id,user_id,request,roles,outputs,status,current_role,workflow_id,created_at,updated_at)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,NOW())
      ON CONFLICT(orchestration_id) DO UPDATE SET roles=EXCLUDED.roles,outputs=EXCLUDED.outputs,status=EXCLUDED.status,current_role=EXCLUDED.current_role,workflow_id=EXCLUDED.workflow_id,updated_at=NOW() RETURNING *`,
      [row.orchestration_id,row.user_id,row.request,JSON.stringify(row.roles),JSON.stringify(row.outputs),row.status,row.current_role,row.workflow_id,row.created_at]);
    return this.normalize(result.rows[0]);
  }
  async get(userId, orchestrationId) {
    if (!this.pool) { const row = this.memory.get(orchestrationId); return row?.user_id === userId ? this.normalize(row) : null; }
    const result = await this.pool.query('SELECT * FROM panthorium_multi_agent_runs WHERE user_id=$1 AND orchestration_id=$2',[userId,orchestrationId]); return this.normalize(result.rows[0]);
  }
  async list(userId, limit = 30) {
    const safe = Math.max(1, Math.min(Number(limit) || 30, 100));
    if (!this.pool) return [...this.memory.values()].filter(x=>x.user_id===userId).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,safe).map(x=>this.normalize(x));
    const result = await this.pool.query('SELECT * FROM panthorium_multi_agent_runs WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2',[userId,safe]); return result.rows.map(x=>this.normalize(x));
  }
}
module.exports = { MultiAgentRunRepository };
