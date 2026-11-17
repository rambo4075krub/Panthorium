'use strict';
const { getDatabasePool } = require('./databasePool');

// Only routing metadata and expiring, encrypted transit envelopes belong here.
// Documents, transcripts, process journals and memory live in the owner's vault.
class RemoteWorkspaceRepository {
  constructor({ pool, databaseUrl, databaseSslMode, required = false, now = Date.now } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null);
    if (required && !this.pool) throw Error('remote_database_required');
    this.now = now; this.rows = new Map(); this.locks = new Map(); this.ready = null;
  }
  async init() {
    if (!this.pool) return;
    if (!this.ready) this.ready = this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_remote_workspace (
      kind TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL, data JSONB NOT NULL,
      updated_at BIGINT NOT NULL, expires_at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS remote_workspace_owner ON panthorium_remote_workspace(user_id,kind,updated_at DESC);
      CREATE INDEX IF NOT EXISTS remote_workspace_expiry ON panthorium_remote_workspace(expires_at) WHERE expires_at>0;`).catch(error => { this.ready = null; throw error; });
    await this.ready;
  }
  async locked(key, fn) {
    await this.init();
    if (this.pool) {
      const client = await this.pool.connect();
      try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['billing:' + key]); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['remote:' + key]); const result = await fn(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    // Test/development adapter. One transaction lock also makes rollback exact.
    const previous = this.locks.get('memory') || Promise.resolve();
    let release; const current = new Promise(resolve => { release = resolve; });
    this.locks.set('memory', current); await previous;
    const snapshot = structuredClone(this.rows);
    try { return await fn(null); } catch (error) { this.rows = snapshot; throw error; }
    finally { release(); if (this.locks.get('memory') === current) this.locks.delete('memory'); }
  }
  async get(kind, id, owner, client) {
    const row = this.pool ? (await (client || this.pool).query('SELECT * FROM panthorium_remote_workspace WHERE kind=$1 AND id=$2', [kind,id])).rows[0] : this.rows.get(kind + ':' + id);
    if (!row || owner !== undefined && row.user_id !== owner || Number(row.expires_at) > 0 && Number(row.expires_at) <= this.now()) return null;
    return structuredClone(row.data);
  }
  async put(kind, id, owner, data, client, ttl = 0) {
    const at = this.now(), expires = ttl ? at + ttl : 0;
    if (this.pool) {
      const result = await (client || this.pool).query(`INSERT INTO panthorium_remote_workspace(kind,id,user_id,data,updated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(kind,id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at,expires_at=EXCLUDED.expires_at
        WHERE panthorium_remote_workspace.user_id=EXCLUDED.user_id RETURNING id`, [kind,id,owner,JSON.stringify(data),at,expires]);
      if (!result.rows.length) throw Error('remote_owner_conflict');
    } else {
      const old = this.rows.get(kind + ':' + id);
      if (old && old.user_id !== owner) throw Error('remote_owner_conflict');
      this.rows.set(kind + ':' + id, { kind,id,user_id:owner,data:structuredClone(data),updated_at:at,expires_at:expires });
    }
  }
  async list(kind, owner, client, limit = 5000) {
    const rows = this.pool ? (await (client || this.pool).query(`SELECT data FROM panthorium_remote_workspace
      WHERE kind=$1 AND user_id=$2 AND (expires_at=0 OR expires_at>$3) ORDER BY updated_at DESC LIMIT $4`, [kind,owner,this.now(),limit])).rows
      : [...this.rows.values()].filter(row => row.kind === kind && row.user_id === owner && (!row.expires_at || row.expires_at > this.now())).sort((a,b) => b.updated_at-a.updated_at).slice(0,limit);
    return rows.map(row => structuredClone(row.data));
  }
  async remove(kind, id, owner, client) {
    if (this.pool) await (client || this.pool).query('DELETE FROM panthorium_remote_workspace WHERE kind=$1 AND id=$2 AND user_id=$3', [kind,id,owner]);
    else if (this.rows.get(kind + ':' + id)?.user_id === owner) this.rows.delete(kind + ':' + id);
  }
  async cleanup() {
    await this.init();
    if (this.pool) {
      await this.pool.query('DELETE FROM panthorium_remote_workspace WHERE expires_at>0 AND expires_at<=$1', [this.now()]);
      // Expiration is enforced when reading too; cleanup does not depend on a timer.
      await this.pool.query(`UPDATE panthorium_remote_workspace SET data=data-'resultEnvelope'-'payload'
        WHERE kind='job' AND (data->>'transitUntil')::bigint<=$1 AND (data ? 'resultEnvelope' OR data ? 'payload')`, [this.now()]);
    } else for (const [key,row] of this.rows) {
      if (row.expires_at && row.expires_at <= this.now()) this.rows.delete(key);
      else if (row.kind === 'job' && row.data.transitUntil <= this.now()) { delete row.data.resultEnvelope; delete row.data.payload; }
    }
  }
}
module.exports = { RemoteWorkspaceRepository };
