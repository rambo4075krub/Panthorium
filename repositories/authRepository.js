const crypto = require("crypto");
const { Pool } = require("pg");
const { JsonStore } = require("./jsonStore");

class JsonAuthRepository {
  constructor(file) {
    this.store = new JsonStore(file);
  }

  async init() {}

  async findUserByUsername(username) {
    return this.store.read().users.find((u) => u.username === username) || null;
  }

  async findUserById(id) {
    return this.store.read().users.find((u) => u.id === id) || null;
  }

  async createUser(user) {
    this.store.update((data) => {
      data.users = data.users || [];
      data.users.push(user);
      return data;
    });
    return user;
  }

  async storeRefreshToken(token) {
    this.store.update((data) => {
      data.refreshTokens = (data.refreshTokens || []).filter((t) => t.expiresAt > Date.now());
      data.refreshTokens.push(token);
      return data;
    });
  }

  async consumeRefreshToken(tokenHash) {
    let found = null;
    this.store.update((data) => {
      const now = Date.now();
      const tokens = data.refreshTokens || [];
      found = tokens.find((t) => t.tokenHash === tokenHash && t.expiresAt > now) || null;
      data.refreshTokens = tokens.filter((t) => t.tokenHash !== tokenHash && t.expiresAt > now);
      return data;
    });
    return found;
  }

  async revokeRefreshToken(tokenHash) {
    this.store.update((data) => {
      data.refreshTokens = (data.refreshTokens || []).filter((t) => t.tokenHash !== tokenHash && t.expiresAt > Date.now());
      return data;
    });
  }
}

class PostgresAuthRepository {
  constructor(connectionString, sslMode = "require") {
    this.pool = new Pool({
      connectionString,
      ssl: sslMode === "disable" ? false : { rejectUnauthorized: false }
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_users (
        id UUID PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        roles JSONB NOT NULL DEFAULT '[]'::jsonb,
        permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS panthorium_refresh_tokens (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES panthorium_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_refresh_user ON panthorium_refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_panthorium_refresh_expiry ON panthorium_refresh_tokens(expires_at);
    `);
  }

  mapUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      roles: row.roles || [],
      permissions: row.permissions || [],
      createdAt: row.created_at?.toISOString?.() || row.created_at
    };
  }

  async findUserByUsername(username) {
    const { rows } = await this.pool.query("SELECT * FROM panthorium_users WHERE username = $1 LIMIT 1", [username]);
    return this.mapUser(rows[0]);
  }

  async findUserById(id) {
    const { rows } = await this.pool.query("SELECT * FROM panthorium_users WHERE id = $1 LIMIT 1", [id]);
    return this.mapUser(rows[0]);
  }

  async createUser(user) {
    const { rows } = await this.pool.query(
      `INSERT INTO panthorium_users (id, username, password_hash, roles, permissions, created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
       ON CONFLICT (username) DO NOTHING
       RETURNING *`,
      [user.id || crypto.randomUUID(), user.username, user.passwordHash, JSON.stringify(user.roles || []), JSON.stringify(user.permissions || []), user.createdAt || new Date().toISOString()]
    );
    return rows[0] ? this.mapUser(rows[0]) : this.findUserByUsername(user.username);
  }

  async storeRefreshToken(token) {
    await this.pool.query("DELETE FROM panthorium_refresh_tokens WHERE expires_at <= NOW()");
    await this.pool.query(
      `INSERT INTO panthorium_refresh_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [token.id, token.userId, token.tokenHash, new Date(token.expiresAt), token.createdAt]
    );
  }

  async consumeRefreshToken(tokenHash) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `DELETE FROM panthorium_refresh_tokens
         WHERE token_hash = $1 AND expires_at > NOW()
         RETURNING id, user_id, token_hash, expires_at, created_at`,
        [tokenHash]
      );
      await client.query("COMMIT");
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, userId: row.user_id, tokenHash: row.token_hash, expiresAt: new Date(row.expires_at).getTime(), createdAt: row.created_at };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshToken(tokenHash) {
    await this.pool.query("DELETE FROM panthorium_refresh_tokens WHERE token_hash = $1", [tokenHash]);
  }
}

function createAuthRepository(config) {
  if (config.databaseUrl) return new PostgresAuthRepository(config.databaseUrl, config.databaseSslMode);
  return new JsonAuthRepository(config.dataFile);
}

module.exports = { JsonAuthRepository, PostgresAuthRepository, createAuthRepository };
