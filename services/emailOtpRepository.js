const { JsonStore } = require('../repositories/jsonStore');
const { getDatabasePool } = require('./databasePool');

class JsonEmailOtpRepository {
  constructor(file) { this.store = new JsonStore(file); }
  async init() { this.store.update(data => { data.emailOtps ||= []; return data; }); }
  async issue(key, codeHash, now = Date.now()) {
    let issued = false;
    this.store.update(data => {
      const existing = (data.emailOtps || []).find(row => row.key === key);
      if (existing && existing.expiresAt > now && existing.createdAt + 60000 > now) return data;
      data.emailOtps = (data.emailOtps || []).filter(row => row.key !== key && row.expiresAt > now);
      data.emailOtps.push({ key, codeHash, createdAt: now, expiresAt: now + 600000, attempts: 0 });
      issued = true; return data;
    });
    return issued;
  }
  async consume(key, codeHash, now = Date.now()) {
    let valid = false;
    this.store.update(data => {
      const row = (data.emailOtps || []).find(entry => entry.key === key);
      if (row && row.expiresAt > now && row.attempts < 5) {
        valid = row.codeHash === codeHash;
        if (!valid) row.attempts++;
      }
      data.emailOtps = (data.emailOtps || []).filter(entry => entry.expiresAt > now && (entry.key !== key || (!valid && entry.attempts < 5)));
      return data;
    });
    return valid;
  }
  async discard(key) { this.store.update(data => { data.emailOtps = (data.emailOtps || []).filter(row => row.key !== key); return data; }); }
}

class PostgresEmailOtpRepository {
  constructor(connectionString, sslMode = 'require') { this.pool = getDatabasePool({ connectionString, ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false } }); }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_email_otps (
      scope_key TEXT PRIMARY KEY, code_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    )`);
  }
  async issue(key, codeHash, now = Date.now()) {
    await this.pool.query('DELETE FROM panthorium_email_otps WHERE expires_at <= $1', [new Date(now)]);
    const { rowCount } = await this.pool.query(`INSERT INTO panthorium_email_otps(scope_key,code_hash,created_at,expires_at,attempts)
      VALUES($1,$2,$3,$4,0) ON CONFLICT(scope_key) DO UPDATE SET code_hash=$2,created_at=$3,expires_at=$4,attempts=0
      WHERE panthorium_email_otps.expires_at <= $3 OR panthorium_email_otps.created_at <= $5
      RETURNING scope_key`, [key, codeHash, new Date(now), new Date(now + 600000), new Date(now - 60000)]);
    return rowCount > 0;
  }
  async consume(key, codeHash, now = Date.now()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM panthorium_email_otps WHERE scope_key=$1 FOR UPDATE', [key]);
      const row = rows[0];
      const valid = Boolean(row && new Date(row.expires_at).getTime() > now && row.attempts < 5 && row.code_hash === codeHash);
      if (row) {
        if (valid || new Date(row.expires_at).getTime() <= now || row.attempts >= 4) await client.query('DELETE FROM panthorium_email_otps WHERE scope_key=$1', [key]);
        else await client.query('UPDATE panthorium_email_otps SET attempts=attempts+1 WHERE scope_key=$1', [key]);
      }
      await client.query('COMMIT');
      return valid;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async discard(key) { await this.pool.query('DELETE FROM panthorium_email_otps WHERE scope_key=$1', [key]); }
}

function createEmailOtpRepository(config) {
  return config.databaseUrl ? new PostgresEmailOtpRepository(config.databaseUrl, config.databaseSslMode) : new JsonEmailOtpRepository(config.dataFile);
}
module.exports = { createEmailOtpRepository, JsonEmailOtpRepository, PostgresEmailOtpRepository };
