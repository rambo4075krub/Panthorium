const { Pool } = require("pg");

class ConversationRepository {
  constructor({ databaseUrl, databaseSslMode } = {}) {
    this.memory = new Map();
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === "disable" ? false : { rejectUnauthorized: false } }) : null;
  }
  async init() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      usage JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_panthorium_conversation_session ON panthorium_conversation_messages(user_id, session_id, id)");
  }
  key(userId, sessionId) { return `${userId}:${sessionId}`; }
  async append({ userId, sessionId, role, content, provider = null, model = null, usage = null }) {
    if (this.pool) {
      await this.pool.query("INSERT INTO panthorium_conversation_messages(user_id,session_id,role,content,provider,model,usage) VALUES($1,$2,$3,$4,$5,$6,$7)", [userId, sessionId, role, content, provider, model, usage ? JSON.stringify(usage) : null]);
      return;
    }
    const key = this.key(userId, sessionId); const list = this.memory.get(key) || [];
    list.push({ role, content, provider, model, usage, createdAt: new Date().toISOString() });
    this.memory.set(key, list.slice(-100));
  }
  async history(userId, sessionId, limit = 40) {
    if (this.pool) {
      const result = await this.pool.query("SELECT role,content,provider,model,usage,created_at AS \"createdAt\" FROM (SELECT * FROM panthorium_conversation_messages WHERE user_id=$1 AND session_id=$2 ORDER BY id DESC LIMIT $3) q ORDER BY id ASC", [userId, sessionId, Math.min(Math.max(limit, 1), 100)]);
      return result.rows;
    }
    return (this.memory.get(this.key(userId, sessionId)) || []).slice(-limit);
  }
  async clear(userId, sessionId) {
    if (this.pool) { await this.pool.query("DELETE FROM panthorium_conversation_messages WHERE user_id=$1 AND session_id=$2", [userId, sessionId]); return; }
    this.memory.delete(this.key(userId, sessionId));
  }
  async listSessions(userId, limit = 30) {
    if (!this.pool) return [...this.memory.keys()].filter((k) => k.startsWith(`${userId}:`)).slice(-limit).map((k) => ({ sessionId: k.slice(userId.length + 1) }));
    const result = await this.pool.query("SELECT session_id AS \"sessionId\", MAX(created_at) AS \"updatedAt\", COUNT(*)::int AS messages FROM panthorium_conversation_messages WHERE user_id=$1 GROUP BY session_id ORDER BY MAX(created_at) DESC LIMIT $2", [userId, Math.min(Math.max(limit, 1), 100)]);
    return result.rows;
  }
}
module.exports = { ConversationRepository };
