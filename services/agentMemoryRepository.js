const { Pool } = require('pg');
const { randomUUID } = require('crypto');

class AgentMemoryRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable' } = {}) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.memory = new Map();
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_agent_memories (
        memory_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        source TEXT,
        importance INTEGER NOT NULL DEFAULT 50,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_memories_user_time ON panthorium_agent_memories(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_memories_user_kind ON panthorium_agent_memories(user_id, kind);
    `);
  }

  normalize(input = {}) {
    return {
      memoryId: input.memoryId || randomUUID(),
      userId: String(input.userId || ''),
      kind: String(input.kind || 'note').slice(0, 40),
      title: String(input.title || '').slice(0, 240),
      content: String(input.content || '').slice(0, 12000),
      tags: Array.isArray(input.tags) ? input.tags.map((x) => String(x).slice(0, 64)).slice(0, 20) : [],
      source: input.source ? String(input.source).slice(0, 120) : null,
      importance: Math.min(Math.max(Number(input.importance) || 50, 1), 100),
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString()
    };
  }

  mapRow(row) {
    if (!row) return null;
    return this.normalize({ memoryId: row.memoryId, userId: row.userId, kind: row.kind, title: row.title, content: row.content, tags: row.tags, source: row.source, importance: row.importance, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }

  async create(input) {
    const item = this.normalize(input);
    if (!this.pool) { this.memory.set(item.memoryId, item); return item; }
    const r = await this.pool.query(`INSERT INTO panthorium_agent_memories(memory_id,user_id,kind,title,content,tags,source,importance,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt"`, [item.memoryId,item.userId,item.kind,item.title,item.content,JSON.stringify(item.tags),item.source,item.importance,item.createdAt,item.updatedAt]);
    return this.mapRow(r.rows[0]);
  }

  async get(userId, memoryId) {
    if (!this.pool) { const item = this.memory.get(String(memoryId || '')); return item && item.userId === userId ? item : null; }
    const r = await this.pool.query(`SELECT memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2`, [memoryId,userId]);
    return this.mapRow(r.rows[0]);
  }

  async list(userId, limit = 30, kind = null) {
    const safe = Math.min(Math.max(Number(limit) || 30, 1), 100);
    if (!this.pool) return [...this.memory.values()].filter((x) => x.userId === userId && (!kind || x.kind === kind)).sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,safe);
    const args = [userId, safe];
    const where = kind ? ' AND kind=$3' : '';
    if (kind) args.push(kind);
    const r = await this.pool.query(`SELECT memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_memories WHERE user_id=$1${where} ORDER BY updated_at DESC LIMIT $2`, args);
    return r.rows.map((row) => this.mapRow(row));
  }

  async search(userId, query, limit = 10) {
    const q = String(query || '').trim();
    const safe = Math.min(Math.max(Number(limit) || 10, 1), 30);
    if (!q) return [];
    if (!this.pool) {
      const needle = q.toLowerCase();
      return [...this.memory.values()].filter((x) => x.userId === userId && `${x.title}\n${x.content}\n${x.tags.join(' ')}`.toLowerCase().includes(needle)).sort((a,b) => b.importance-a.importance || Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,safe);
    }
    const r = await this.pool.query(`SELECT memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_memories WHERE user_id=$1 AND (title ILIKE $2 OR content ILIKE $2 OR tags::text ILIKE $2) ORDER BY importance DESC, updated_at DESC LIMIT $3`, [userId, `%${q.replace(/[%_]/g, '')}%`, safe]);
    return r.rows.map((row) => this.mapRow(row));
  }

  async delete(userId, memoryId) {
    if (!this.pool) { const item = this.memory.get(memoryId); if (!item || item.userId !== userId) return false; this.memory.delete(memoryId); return true; }
    const r = await this.pool.query('DELETE FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2', [memoryId,userId]);
    return (r.rowCount || 0) > 0;
  }
}

module.exports = { AgentMemoryRepository };