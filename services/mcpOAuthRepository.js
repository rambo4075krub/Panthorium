'use strict';

const { getDatabasePool } = require('./databasePool');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

// OAuth credentials are stored only as SHA-256 lookup hashes. All one-time
// transitions use database row locks; the in-memory mode is exclusively for tests.
class McpOAuthRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'require', pool, required = true, allowMemory = false, now = () => Date.now() } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.allowMemory = allowMemory === true && required === false;
    this.now = now;
    this.memory = new Map();
    this.ready = false;
    this.queue = Promise.resolve();
  }

  async init() {
    if (!this.pool && !this.allowMemory) throw new Error('mcp_oauth_database_required');
    if (this.pool) {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_mcp_oauth (
        kind TEXT NOT NULL, key TEXT NOT NULL, data JSONB NOT NULL,
        expires_at BIGINT, consumed_at BIGINT, PRIMARY KEY(kind,key));
        CREATE INDEX IF NOT EXISTS idx_panthorium_mcp_oauth_expiry ON panthorium_mcp_oauth(expires_at);
        CREATE INDEX IF NOT EXISTS idx_panthorium_mcp_oauth_owner ON panthorium_mcp_oauth((data->>'userId')) WHERE kind='grant';`);
      await this.pool.query('DELETE FROM panthorium_mcp_oauth WHERE expires_at IS NOT NULL AND expires_at < $1', [this.now()]);
    }
    this.ready = true;
  }

  assertReady() { if (!this.ready) throw new Error('mcp_oauth_unavailable'); }
  memoryKey(kind, key) { return JSON.stringify([kind, key]); }

  async get(kind, key, { db = this.pool, lock = false, allowExpired = false } = {}) {
    this.assertReady();
    let row;
    if (db) row = (await db.query(`SELECT data,expires_at,consumed_at FROM panthorium_mcp_oauth WHERE kind=$1 AND key=$2${lock ? ' FOR UPDATE' : ''}`, [kind, key])).rows[0];
    else row = this.memory.get(this.memoryKey(kind, key));
    if (!row || (!allowExpired && row.expires_at != null && Number(row.expires_at) <= this.now())) return null;
    return { data: clone(row.data), expiresAt: row.expires_at == null ? null : Number(row.expires_at), consumedAt: row.consumed_at == null ? null : Number(row.consumed_at) };
  }

  async put(kind, key, data, expiresAt = null, db = this.pool) {
    this.assertReady();
    if (db) await db.query('INSERT INTO panthorium_mcp_oauth(kind,key,data,expires_at) VALUES($1,$2,$3::jsonb,$4)', [kind, key, JSON.stringify(data), expiresAt]);
    else {
      const memoryKey = this.memoryKey(kind, key);
      if (this.memory.has(memoryKey)) throw new Error('mcp_oauth_record_conflict');
      this.memory.set(memoryKey, { data: clone(data), expires_at: expiresAt, consumed_at: null });
    }
  }

  async update(kind, key, data, db = this.pool) {
    if (db) await db.query('UPDATE panthorium_mcp_oauth SET data=$3::jsonb WHERE kind=$1 AND key=$2', [kind, key, JSON.stringify(data)]);
    else { const row = this.memory.get(this.memoryKey(kind, key)); if (row) row.data = clone(data); }
  }

  async consume(kind, key, db = this.pool) {
    if (db) await db.query('UPDATE panthorium_mcp_oauth SET consumed_at=$3 WHERE kind=$1 AND key=$2', [kind, key, this.now()]);
    else { const row = this.memory.get(this.memoryKey(kind, key)); if (row) row.consumed_at = this.now(); }
  }

  async transaction(callback) {
    this.assertReady();
    if (this.pool) {
      const client = await this.pool.connect();
      try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    let release;
    const previous = this.queue;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    const before = new Map([...this.memory].map(([key, value]) => [key, clone(value)]));
    try { return await callback(null); }
    catch (error) { this.memory = before; throw error; }
    finally { release(); }
  }

  async consumeRequest(requestId, codeHash, code) {
    return this.transaction(async db => {
      const row = await this.get('request', requestId, { db, lock: true });
      if (!row || row.consumedAt != null) return false;
      await this.consume('request', requestId, db);
      if (codeHash) await this.put('code', codeHash, code, code.expiresAt, db);
      return true;
    });
  }

  async redeemCode(codeHash, expected, grant, access, refresh) {
    return this.transaction(async db => {
      const row = await this.get('code', codeHash, { db, lock: true });
      if (!row || row.consumedAt != null || row.data.clientId !== expected.clientId || row.data.redirectUri !== expected.redirectUri || row.data.challenge !== expected.challenge || row.data.resource !== expected.resource) return false;
      await this.consume('code', codeHash, db);
      await this.put('grant', grant.id, grant, grant.expiresAt, db);
      await this.put('access', access.hash, { grantId: grant.id }, access.expiresAt, db);
      await this.put('refresh', refresh.hash, { grantId: grant.id }, grant.expiresAt, db);
      return true;
    });
  }

  async rotateRefresh(refreshHash, clientId, resource, access, refresh) {
    // Lock the grant before its refresh record consistently across all rotations.
    const token = await this.get('refresh', refreshHash);
    if (!token) return null;
    return this.transaction(async db => {
      const grantRow = await this.get('grant', token.data.grantId, { db, lock: true });
      const grant = grantRow?.data;
      if (!grant || grant.revokedAt || grant.clientId !== clientId || grant.resource !== resource) return null;
      const row = await this.get('refresh', refreshHash, { db, lock: true });
      if (!row) return null;
      if (row.consumedAt != null) {
        await this.update('grant', grant.id, { ...grant, revokedAt: this.now(), revocationReason: 'refresh_token_reuse' }, db);
        return null; // Commit the family revocation, then let the service reject.
      }
      await this.consume('refresh', refreshHash, db);
      await this.put('access', access.hash, { grantId: grant.id }, access.expiresAt, db);
      await this.put('refresh', refresh.hash, { grantId: grant.id }, grant.expiresAt, db);
      return grant;
    });
  }

  async revokeGrant(grantId, { userId, clientId } = {}) {
    return this.transaction(async db => {
      const row = await this.get('grant', grantId, { db, lock: true });
      if (!row || (userId && row.data.userId !== userId) || (clientId && row.data.clientId !== clientId)) return false;
      await this.update('grant', grantId, { ...row.data, revokedAt: this.now(), revocationReason: 'revoked' }, db);
      return true;
    });
  }

  async listGrants(userId) {
    this.assertReady();
    if (this.pool) return (await this.pool.query("SELECT data FROM panthorium_mcp_oauth WHERE kind='grant' AND data->>'userId'=$1 AND expires_at>$2 ORDER BY (data->>'createdAt') DESC LIMIT 100", [userId, this.now()])).rows.map(row => row.data);
    return [...this.memory].filter(([key, row]) => JSON.parse(key)[0] === 'grant' && row.data.userId === userId && row.expires_at > this.now()).map(([, row]) => clone(row.data)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  }
}

module.exports = { McpOAuthRepository };
