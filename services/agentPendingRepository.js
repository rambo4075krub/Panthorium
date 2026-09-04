const { Pool } = require('pg');

class AgentPendingRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable' } = {}) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.memory = new Map();
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_agent_pending (
        workflow_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        state JSONB NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_pending_user
        ON panthorium_agent_pending(user_id);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_pending_expiry
        ON panthorium_agent_pending(expires_at);
    `);
  }

  normalize(item = {}) {
    const expiresAt = item.expiresAt instanceof Date ? item.expiresAt.toISOString() : new Date(item.expiresAt || Date.now()).toISOString();
    return {
      workflowId: String(item.workflowId || ''),
      userId: String(item.userId || ''),
      state: item.state && typeof item.state === 'object' ? item.state : {},
      expiresAt,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  async save(item) {
    const row = this.normalize(item);
    if (!row.workflowId || !row.userId) throw new Error('invalid_pending_workflow');
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO panthorium_agent_pending(workflow_id,user_id,state,expires_at,created_at,updated_at)
         VALUES($1,$2,$3::jsonb,$4,$5,$6)
         ON CONFLICT (workflow_id) DO UPDATE SET user_id=EXCLUDED.user_id,state=EXCLUDED.state,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at`,
        [row.workflowId,row.userId,JSON.stringify(row.state),row.expiresAt,row.createdAt,row.updatedAt]
      );
    } else {
      const current = this.memory.get(row.workflowId);
      this.memory.set(row.workflowId, { ...row, createdAt: current?.createdAt || row.createdAt });
    }
    return row;
  }

  async get(workflowId) {
    const id = String(workflowId || '');
    if (!id) return null;
    if (!this.pool) return this.memory.get(id) || null;
    const result = await this.pool.query(
      `SELECT workflow_id AS "workflowId", user_id AS "userId", state, expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM panthorium_agent_pending WHERE workflow_id=$1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async remove(workflowId) {
    const id = String(workflowId || '');
    if (!id) return false;
    if (!this.pool) return this.memory.delete(id);
    const result = await this.pool.query(`DELETE FROM panthorium_agent_pending WHERE workflow_id=$1`, [id]);
    return result.rowCount > 0;
  }

  async removeExpired(now = new Date()) {
    const cutoff = now instanceof Date ? now : new Date(now);
    if (!this.pool) {
      const expired = [];
      for (const [id, row] of this.memory.entries()) {
        if (Date.parse(row.expiresAt) <= cutoff.getTime()) { expired.push(row); this.memory.delete(id); }
      }
      return expired;
    }
    const result = await this.pool.query(
      `DELETE FROM panthorium_agent_pending WHERE expires_at <= $1 RETURNING workflow_id AS "workflowId", user_id AS "userId", state, expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [cutoff.toISOString()]
    );
    return result.rows;
  }
}

module.exports = { AgentPendingRepository };