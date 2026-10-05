const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');
const { CloudNotesError } = require('./cloudNotesRepository');

function timestamp(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toISOString();
}

function sameNote(left, right) {
  if (!left || !right) return false;
  return String(left.memoryId) === String(right.memoryId)
    && String(left.userId) === String(right.userId)
    && left.kind === 'note'
    && right.kind === 'note'
    && String(left.title || '') === String(right.title || '')
    && String(left.content || '') === String(right.content || '')
    && JSON.stringify(left.tags || []) === JSON.stringify(right.tags || [])
    && (left.source || null) === (right.source || null)
    && Number(left.importance || 50) === Number(right.importance || 50)
    && timestamp(left.createdAt) === timestamp(right.createdAt)
    && timestamp(left.updatedAt) === timestamp(right.updatedAt);
}

class AgentMemoryRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', requireDatabase = false, notesRepository = null } = {}) {
    if (requireDatabase && !databaseUrl) throw new Error('DATABASE_URL is required for durable agent memory');
    this.pool = databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.memory = new Map();
    this.notesRepository = notesRepository;
    this.noteMigrationPromises = new Map();
    this.migratedNoteUsers = new Set();
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

  queryTerms(query) {
    return [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}_:-]+/gu) || [])]
      .filter((term) => term.length > 1)
      .slice(0, 16);
  }

  async ensureNotesMigrated(userId) {
    if (!this.notesRepository) return;
    const id = String(userId || '');
    if (this.migratedNoteUsers.has(id)) return;
    if (this.noteMigrationPromises.has(id)) return this.noteMigrationPromises.get(id);
    const task = this.migrateLegacyNotes(id)
      .then(() => { this.migratedNoteUsers.add(id); })
      .finally(() => { this.noteMigrationPromises.delete(id); });
    this.noteMigrationPromises.set(id, task);
    return task;
  }

  async verifyAndCopyLegacyNote(item) {
    let stored = await this.notesRepository.get(item.userId, item.memoryId);
    if (!stored) {
      await this.notesRepository.create(item);
      stored = await this.notesRepository.get(item.userId, item.memoryId);
    }
    if (!sameNote(stored, item)) throw new CloudNotesError(409, 'notes_migration_conflict');
  }

  async migrateLegacyNotes(userId) {
    if (!this.pool) {
      const legacy = [...this.memory.values()].filter(item => item.userId === userId && item.kind === 'note');
      for (const item of legacy) {
        await this.verifyAndCopyLegacyNote(item);
        this.memory.delete(item.memoryId);
      }
      return;
    }

    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query('BEGIN');
      begun = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['panthorium.notes.' + userId]);
      const result = await client.query(
        `SELECT memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt"
         FROM panthorium_agent_memories WHERE user_id=$1 AND kind='note' ORDER BY updated_at ASC`,
        [userId]
      );
      for (const row of result.rows) {
        const item = this.mapRow(row);
        await this.verifyAndCopyLegacyNote(item);
        await client.query("DELETE FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2 AND kind='note'", [item.memoryId, userId]);
      }
      await client.query('COMMIT');
      begun = false;
    } catch (error) {
      if (begun) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async create(input) {
    const item = this.normalize(input);
    if (this.notesRepository && item.kind === 'note') {
      await this.ensureNotesMigrated(item.userId);
      return this.notesRepository.create(item);
    }
    if (!this.pool) { this.memory.set(item.memoryId, item); return item; }
    const r = await this.pool.query(`INSERT INTO panthorium_agent_memories(memory_id,user_id,kind,title,content,tags,source,importance,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt"`, [item.memoryId,item.userId,item.kind,item.title,item.content,JSON.stringify(item.tags),item.source,item.importance,item.createdAt,item.updatedAt]);
    return this.mapRow(r.rows[0]);
  }

  async getSql(userId, memoryId) {
    if (!this.pool) { const item = this.memory.get(String(memoryId || '')); return item && item.userId === userId ? item : null; }
    const r = await this.pool.query(`SELECT memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2`, [memoryId,userId]);
    return this.mapRow(r.rows[0]);
  }

  async get(userId, memoryId) {
    if (!this.notesRepository) return this.getSql(userId, memoryId);
    const legacy = await this.getSql(userId, memoryId);
    if (legacy && legacy.kind !== 'note') return legacy;
    await this.ensureNotesMigrated(userId);
    const note = await this.notesRepository.get(userId, memoryId);
    return note || null;
  }

  async listSql(userId, limit = 30, kind = null, excludeNotes = false) {
    const safe = Math.min(Math.max(Number(limit) || 30, 1), 100);
    if (!this.pool) {
      return [...this.memory.values()]
        .filter(item => item.userId === userId && (!kind || item.kind === kind) && (!excludeNotes || item.kind !== 'note'))
        .sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt))
        .slice(0,safe);
    }
    const args = [userId, safe];
    let where = 'user_id=$1';
    if (kind) {
      args.push(kind);
      where += ' AND kind=$3';
    } else if (excludeNotes) {
      where += " AND kind <> 'note'";
    }
    const r = await this.pool.query(`SELECT memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_memories WHERE ${where} ORDER BY updated_at DESC LIMIT $2`, args);
    return r.rows.map((row) => this.mapRow(row));
  }

  async list(userId, limit = 30, kind = null) {
    if (!this.notesRepository) return this.listSql(userId, limit, kind);
    const safe = Math.min(Math.max(Number(limit) || 30, 1), 100);
    if (kind !== null && kind !== 'note') return this.listSql(userId, safe, kind);
    await this.ensureNotesMigrated(userId);
    if (kind === 'note') return this.notesRepository.list(userId, safe);
    const [memories, notes] = await Promise.all([
      this.listSql(userId, safe, null, true),
      this.notesRepository.list(userId, safe)
    ]);
    return [...memories, ...notes]
      .sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt))
      .slice(0,safe);
  }

  async searchSql(userId, query, limit = 10) {
    const q = String(query || '').trim();
    const safe = Math.min(Math.max(Number(limit) || 10, 1), 30);
    if (!q) return [];
    const terms = this.queryTerms(q);
    if (!terms.length) return [];
    if (!this.pool) {
      return [...this.memory.values()]
        .filter(item => item.userId === userId && (!this.notesRepository || item.kind !== 'note'))
        .map(item => {
          const haystack = `${item.title}\n${item.content}\n${item.tags.join(' ')}`.toLowerCase();
          const relevance = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
          return { item, relevance };
        })
        .filter(entry => entry.relevance > 0)
        .sort((a,b) => b.relevance-a.relevance || b.item.importance-a.item.importance || Date.parse(b.item.updatedAt)-Date.parse(a.item.updatedAt))
        .slice(0,safe)
        .map(entry => entry.item);
    }
    const patterns = terms.map((term) => `%${term.replace(/[%_]/g, '')}%`);
    const noteFilter = this.notesRepository ? " AND kind <> 'note'" : '';
    const r = await this.pool.query(`
      SELECT memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt",
        (SELECT COUNT(*) FROM unnest($2::text[]) AS pattern WHERE title ILIKE pattern OR content ILIKE pattern OR tags::text ILIKE pattern) AS relevance
      FROM panthorium_agent_memories
      WHERE user_id=$1${noteFilter} AND (title ILIKE ANY($2::text[]) OR content ILIKE ANY($2::text[]) OR tags::text ILIKE ANY($2::text[]))
      ORDER BY relevance DESC, importance DESC, updated_at DESC
      LIMIT $3`, [userId, patterns, safe]);
    return r.rows.map((row) => this.mapRow(row));
  }

  async search(userId, query, limit = 10) {
    if (!this.notesRepository) return this.searchSql(userId, query, limit);
    await this.ensureNotesMigrated(userId);
    const safe = Math.min(Math.max(Number(limit) || 10, 1), 30);
    const [memories, notes] = await Promise.all([
      this.searchSql(userId, query, safe),
      this.notesRepository.search(userId, query, safe)
    ]);
    const terms = this.queryTerms(query);
    const relevance = item => terms.reduce((score, term) => {
      const haystack = (item.title + '\n' + item.content + '\n' + (item.tags || []).join(' ')).toLowerCase();
      return score + (haystack.includes(term) ? 1 : 0);
    }, 0);
    return [...memories, ...notes]
      .map(item => ({ item, relevance: relevance(item) }))
      .filter(entry => entry.relevance > 0)
      .sort((a,b) => b.relevance-a.relevance || b.item.importance-a.item.importance || Date.parse(b.item.updatedAt)-Date.parse(a.item.updatedAt))
      .slice(0,safe)
      .map(entry => entry.item);
  }

  async update(userId, memoryId, patch = {}) {
    const current = await this.get(userId, memoryId);
    if (!current) return null;
    const item = this.normalize({ ...current, ...patch, memoryId: current.memoryId, userId: current.userId, updatedAt: new Date().toISOString() });
    if (this.notesRepository && current.kind === 'note') {
      return this.notesRepository.update(userId, memoryId, { title: item.title, content: item.content, tags: item.tags, source: item.source, importance: item.importance });
    }
    if (!this.pool) { this.memory.set(item.memoryId, item); return item; }
    const r = await this.pool.query(`UPDATE panthorium_agent_memories SET title=$3,content=$4,tags=$5::jsonb,importance=$6,updated_at=NOW() WHERE memory_id=$1 AND user_id=$2 RETURNING memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,created_at AS "createdAt",updated_at AS "updatedAt"`, [memoryId,userId,item.title,item.content,JSON.stringify(item.tags),item.importance]);
    return this.mapRow(r.rows[0]);
  }

  async delete(userId, memoryId) {
    const current = await this.get(userId, memoryId);
    if (!current) return false;
    if (this.notesRepository && current.kind === 'note') return this.notesRepository.delete(userId, memoryId);
    if (!this.pool) { const item = this.memory.get(String(memoryId)); if (!item || item.userId !== userId) return false; this.memory.delete(String(memoryId)); return true; }
    const r = await this.pool.query('DELETE FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2', [memoryId,userId]);
    return (r.rowCount || 0) > 0;
  }
}

module.exports = { AgentMemoryRepository, sameNote };
