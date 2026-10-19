const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');
const { CloudNotesError } = require('./cloudNotesRepository');

const MEMORY_SCOPES = Object.freeze(['personal', 'work', 'study', 'family']);
const CONFIRMATIONS = Object.freeze(['unconfirmed', 'confirmed', 'inferred']);
const SENSITIVITIES = Object.freeze(['standard', 'sensitive', 'restricted']);
function scopeValue(value = 'personal') {
  if (!MEMORY_SCOPES.includes(value)) throw new TypeError('invalid_memory_scope');
  return value;
}
const COLUMNS = `memory_id AS "memoryId",user_id AS "userId",kind,title,content,tags,source,importance,confidence,expires_at AS "expiresAt",scope,provenance,confirmation,sensitivity,created_at AS "createdAt",updated_at AS "updatedAt"`;
const NOTE_COLUMNS = `memory_id AS "memoryId",user_id AS "userId",scope,provenance,confirmation,sensitivity,confidence,expires_at AS "expiresAt"`;

const thaiWordSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
function normalizedText(value) { return String(value || '').normalize('NFKC').toLowerCase(); }
function scoreMemory(item, terms) {
  const title = normalizedText(item.title);
  const content = normalizedText(item.content);
  const tags = normalizedText((item.tags || []).join(' '));
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 4;
    if (tags.includes(term)) score += 3;
    if (content.includes(term)) score += 1;
  }
  const ageDays = Math.max(0, (Date.now() - Date.parse(item.updatedAt || 0)) / 86400000);
  const recency = Number.isFinite(ageDays) ? Math.max(0, 1 - ageDays / 365) : 0;
  return score * Math.max(0, Math.min(1, Number(item.confidence ?? 0.8))) + Number(item.importance || 50) / 1000 + recency / 10;
}
function matchesMemory(item, terms) {
  const haystack = normalizedText(`${item.title}\n${item.content}\n${(item.tags || []).join(' ')}`);
  return terms.some(term => haystack.includes(term));
}
function isCurrent(item) { return !item.expiresAt || Date.parse(item.expiresAt) > Date.now(); }

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
    this.noteMetadata = new Map();
    this.notesRepository = notesRepository;
    this.noteMigrationPromises = new Map();
    this.migratedNoteUsers = new Set();
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_agent_memories (
        memory_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, content TEXT NOT NULL, tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        source TEXT, importance INTEGER NOT NULL DEFAULT 50, confidence REAL NOT NULL DEFAULT 0.8,
        expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE panthorium_agent_memories ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 0.8;
      ALTER TABLE panthorium_agent_memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE panthorium_agent_memories ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'personal';
      ALTER TABLE panthorium_agent_memories ADD COLUMN IF NOT EXISTS provenance JSONB;
      ALTER TABLE panthorium_agent_memories ADD COLUMN IF NOT EXISTS confirmation TEXT NOT NULL DEFAULT 'unconfirmed';
      ALTER TABLE panthorium_agent_memories ADD COLUMN IF NOT EXISTS sensitivity TEXT NOT NULL DEFAULT 'standard';
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_memories_user_time ON panthorium_agent_memories(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_memories_user_kind ON panthorium_agent_memories(user_id, kind);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_memories_owner_scope ON panthorium_agent_memories(user_id, scope, kind, updated_at DESC);
      CREATE TABLE IF NOT EXISTS panthorium_agent_note_metadata (
        memory_id TEXT NOT NULL, user_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'personal',
        provenance JSONB, confirmation TEXT NOT NULL DEFAULT 'unconfirmed', sensitivity TEXT NOT NULL DEFAULT 'standard',
        confidence REAL NOT NULL DEFAULT 0.8, expires_at TIMESTAMPTZ,
        PRIMARY KEY (user_id, memory_id)
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_note_metadata_scope ON panthorium_agent_note_metadata(user_id, scope);
    `);
  }

  metadata(input = {}) {
    const confirmation = input.confirmation ?? 'unconfirmed';
    const sensitivity = input.sensitivity ?? 'standard';
    if (!CONFIRMATIONS.includes(confirmation)) throw new TypeError('invalid_memory_confirmation');
    if (!SENSITIVITIES.includes(sensitivity)) throw new TypeError('invalid_memory_sensitivity');
    return {
      scope: scopeValue(input.scope),
      provenance: input.provenance == null ? null : JSON.parse(JSON.stringify(input.provenance)),
      confirmation, sensitivity,
      confidence: Math.min(1, Math.max(0, input.confidence == null ? 0.8 : (Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.8))),
      expiresAt: input.expiresAt && Number.isFinite(Date.parse(input.expiresAt)) ? new Date(input.expiresAt).toISOString() : null
    };
  }

  normalize(input = {}) {
    return {
      memoryId: input.memoryId || randomUUID(), userId: String(input.userId || ''),
      kind: String(input.kind || 'note').slice(0, 40), title: String(input.title || '').slice(0, 240),
      content: String(input.content || '').slice(0, 12000),
      tags: Array.isArray(input.tags) ? input.tags.map((x) => String(x).slice(0, 64)).slice(0, 20) : [],
      source: input.source ? String(input.source).slice(0, 120) : null,
      importance: Math.min(Math.max(Number(input.importance) || 50, 1), 100),
      ...this.metadata(input),
      createdAt: input.createdAt || new Date().toISOString(), updatedAt: input.updatedAt || new Date().toISOString()
    };
  }
  mapRow(row) { return row ? this.normalize(row) : null; }

  queryTerms(query) {
    const text = normalizedText(query);
    const segmented = Array.from(thaiWordSegmenter.segment(text)).filter(part => part.isWordLike).map(part => part.segment);
    const fallback = text.match(/[\p{L}\p{N}_:-]+/gu) || [];
    return [...new Set([...segmented, ...fallback])].filter(term => term.length > 1).slice(0, 16);
  }

  // Notes content stays in the existing GCS objects. Scope/privacy metadata has
  // a durable SQL sidecar because legacy CloudNotes normalization strips it.
  async noteMetadataFor(userId, memoryId) {
    if (!this.pool) return this.noteMetadata.get(userId + ':' + memoryId) || null;
    const out = await this.pool.query(`SELECT ${NOTE_COLUMNS} FROM panthorium_agent_note_metadata WHERE user_id=$1 AND memory_id=$2`, [userId, memoryId]);
    return out.rows[0] || null;
  }
  async storeNoteMetadata(item, database = this.pool) {
    const metadata = { memoryId: item.memoryId, userId: item.userId, ...this.metadata(item) };
    if (!this.pool) { this.noteMetadata.set(item.userId + ':' + item.memoryId, metadata); return; }
    await database.query(`INSERT INTO panthorium_agent_note_metadata(memory_id,user_id,scope,provenance,confirmation,sensitivity,confidence,expires_at)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
      ON CONFLICT (user_id,memory_id) DO UPDATE SET scope=EXCLUDED.scope,provenance=EXCLUDED.provenance,confirmation=EXCLUDED.confirmation,sensitivity=EXCLUDED.sensitivity,confidence=EXCLUDED.confidence,expires_at=EXCLUDED.expires_at`,
      [item.memoryId,item.userId,metadata.scope,JSON.stringify(metadata.provenance),metadata.confirmation,metadata.sensitivity,metadata.confidence,metadata.expiresAt]);
  }
  async removeNoteMetadata(userId, memoryId) {
    if (!this.pool) { this.noteMetadata.delete(userId + ':' + memoryId); return; }
    await this.pool.query('DELETE FROM panthorium_agent_note_metadata WHERE user_id=$1 AND memory_id=$2', [userId,memoryId]);
  }
  async scopedNotes(userId, scope) {
    const notes = await this.notesRepository.list(userId, 10000);
    let metadata;
    if (this.pool) metadata = (await this.pool.query(`SELECT ${NOTE_COLUMNS} FROM panthorium_agent_note_metadata WHERE user_id=$1`, [userId])).rows;
    else metadata = [...this.noteMetadata.values()].filter(item => item.userId === userId);
    const byId = new Map(metadata.map(item => [item.memoryId, item]));
    return notes.filter(item => item.userId === userId).map(item => {
      const meta = byId.get(item.memoryId);
      // Keep untouched legacy Notes wire shape for existing Notes consumers.
      return meta ? { ...item, ...this.metadata(meta) } : item;
    }).filter(item => (item.scope || 'personal') === scope && isCurrent(item));
  }

  async ensureNotesMigrated(userId) {
    if (!this.notesRepository) return;
    const id = String(userId || '');
    if (this.migratedNoteUsers.has(id)) return;
    if (this.noteMigrationPromises.has(id)) return this.noteMigrationPromises.get(id);
    const task = this.migrateLegacyNotes(id).then(() => { this.migratedNoteUsers.add(id); }).finally(() => { this.noteMigrationPromises.delete(id); });
    this.noteMigrationPromises.set(id, task);
    return task;
  }
  async verifyAndCopyLegacyNote(item, database = this.pool) {
    const meta = this.metadata(item);
    const custom = meta.scope !== 'personal' || meta.provenance !== null || meta.confirmation !== 'unconfirmed' || meta.sensitivity !== 'standard' || meta.confidence !== 0.8 || meta.expiresAt !== null;
    // Persist scope before publishing a new object, so a failed metadata write
    // cannot expose a work/study/family note as a default-personal note.
    if (custom) await this.storeNoteMetadata(item, database);
    let stored = await this.notesRepository.get(item.userId, item.memoryId);
    if (!stored) { await this.notesRepository.create(item); stored = await this.notesRepository.get(item.userId, item.memoryId); }
    if (!sameNote(stored, item)) throw new CloudNotesError(409, 'notes_migration_conflict');
  }
  async migrateLegacyNotes(userId) {
    if (!this.pool) {
      const legacy = [...this.memory.values()].filter(item => item.userId === userId && item.kind === 'note');
      for (const item of legacy) { await this.verifyAndCopyLegacyNote(item); this.memory.delete(item.memoryId); }
      return;
    }
    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query('BEGIN'); begun = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['panthorium.notes.' + userId]);
      const result = await client.query(`SELECT ${COLUMNS} FROM panthorium_agent_memories WHERE user_id=$1 AND kind='note' ORDER BY updated_at ASC`, [userId]);
      for (const row of result.rows) {
        const item = this.mapRow(row);
        await this.verifyAndCopyLegacyNote(item, client);
        await client.query("DELETE FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2 AND kind='note'", [item.memoryId,userId]);
      }
      await client.query('COMMIT'); begun = false;
    } catch (error) {
      if (begun) { try { await client.query('ROLLBACK'); } catch (_) {} }
      throw error;
    } finally { client.release(); }
  }

  async create(input) {
    const item = this.normalize(input);
    if (this.notesRepository && item.kind === 'note') {
      await this.ensureNotesMigrated(item.userId);
      await this.storeNoteMetadata(item);
      const note = await this.notesRepository.create(item);
      return { ...note, ...this.metadata(item) };
    }
    if (!this.pool) { this.memory.set(item.memoryId,item); return item; }
    const result = await this.pool.query(`INSERT INTO panthorium_agent_memories(memory_id,user_id,kind,title,content,tags,source,importance,confidence,expires_at,scope,provenance,confirmation,sensitivity,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING ${COLUMNS}`,
      [item.memoryId,item.userId,item.kind,item.title,item.content,JSON.stringify(item.tags),item.source,item.importance,item.confidence,item.expiresAt,item.scope,JSON.stringify(item.provenance),item.confirmation,item.sensitivity,item.createdAt,item.updatedAt]);
    return this.mapRow(result.rows[0]);
  }

  async getSql(userId, memoryId, scope = 'personal', { includeExpired = false } = {}) {
    scopeValue(scope);
    if (!this.pool) {
      const item = this.memory.get(String(memoryId || ''));
      return item && item.userId === userId && (item.scope || 'personal') === scope && (includeExpired || isCurrent(item)) ? item : null;
    }
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2 AND scope=$3${includeExpired ? '' : ' AND (expires_at IS NULL OR expires_at>NOW())'}`, [memoryId,userId,scope]);
    return this.mapRow(result.rows[0]);
  }
  async get(userId, memoryId, scope = 'personal', { includeExpired = false } = {}) {
    scopeValue(scope);
    if (!this.notesRepository) return this.getSql(userId,memoryId,scope,{ includeExpired });
    const legacy = await this.getSql(userId,memoryId,scope,{ includeExpired });
    if (legacy && legacy.kind !== 'note') return legacy;
    await this.ensureNotesMigrated(userId);
    const meta = await this.noteMetadataFor(userId,memoryId);
    if ((meta?.scope || 'personal') !== scope || (!includeExpired && meta && !isCurrent(meta))) return null;
    const note = await this.notesRepository.get(userId,memoryId);
    if (!note || note.userId !== userId) return null;
    return meta ? { ...note, ...this.metadata(meta) } : note;
  }

  async calendarRecords(userId) {
    if (!this.pool) return [...this.memory.values()].filter(item => item.userId === userId && (item.scope || 'personal') === 'personal' && item.kind === 'calendar-event' && isCurrent(item)).slice(0,10001);
    const out = await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_agent_memories WHERE user_id=$1 AND scope='personal' AND kind='calendar-event' AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY updated_at DESC LIMIT 10001`,[userId]);
    return out.rows.map(row=>this.mapRow(row));
  }
  async listSql(userId, limit = 30, kind = null, excludeNotes = false, scope = 'personal') {
    scopeValue(scope);
    const safe = Math.min(Math.max(Number(limit) || 30,1),100);
    if (!this.pool) return [...this.memory.values()]
      .filter(item => item.userId === userId && (item.scope || 'personal') === scope && isCurrent(item) && (!kind || item.kind === kind) && (!excludeNotes || item.kind !== 'note'))
      .sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,safe);
    const args = [userId,scope,safe];
    let where = 'user_id=$1 AND scope=$2 AND (expires_at IS NULL OR expires_at>NOW())';
    if (kind) { args.push(kind); where += ' AND kind=$4'; }
    else if (excludeNotes) where += " AND kind <> 'note'";
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_agent_memories WHERE ${where} ORDER BY updated_at DESC LIMIT $3`, args);
    return result.rows.map(row => this.mapRow(row));
  }
  async list(userId, limit = 30, kind = null, scope = 'personal') {
    scopeValue(scope);
    if (!this.notesRepository) return this.listSql(userId,limit,kind,false,scope);
    const safe = Math.min(Math.max(Number(limit) || 30,1),100);
    if (kind !== null && kind !== 'note') return this.listSql(userId,safe,kind,false,scope);
    await this.ensureNotesMigrated(userId);
    const notes = await this.scopedNotes(userId,scope);
    if (kind === 'note') return notes.slice(0,safe);
    const memories = await this.listSql(userId,safe,null,true,scope);
    return [...memories,...notes].sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,safe);
  }

  async searchSql(userId, query, limit = 10, scope = 'personal') {
    scopeValue(scope);
    const safe = Math.min(Math.max(Number(limit) || 10,1),30);
    const terms = this.queryTerms(String(query || '').trim());
    if (!terms.length) return [];
    if (!this.pool) return [...this.memory.values()]
      .filter(item => item.userId === userId && (item.scope || 'personal') === scope && isCurrent(item) && (!this.notesRepository || item.kind !== 'note'))
      .map(item => ({ item, relevance: scoreMemory(item,terms) }))
      .filter(entry => matchesMemory(entry.item,terms) && entry.relevance > Number(entry.item.importance || 50)/1000 + 0.09)
      .sort((a,b) => b.relevance-a.relevance || Date.parse(b.item.updatedAt)-Date.parse(a.item.updatedAt)).slice(0,safe).map(entry => entry.item);
    const args = [userId,scope,safe,...terms.map(term => `%${term.replace(/[%_\\]/g,'')}%`)];
    const conditions = terms.map((_,i) => `(title ILIKE $${i+4} OR content ILIKE $${i+4} OR tags::text ILIKE $${i+4})`);
    const scores = terms.map((_,i) => `(CASE WHEN title ILIKE $${i+4} THEN 4 ELSE 0 END + CASE WHEN tags::text ILIKE $${i+4} THEN 3 ELSE 0 END + CASE WHEN content ILIKE $${i+4} THEN 1 ELSE 0 END)`);
    const noteFilter = this.notesRepository ? " AND kind <> 'note'" : '';
    const result = await this.pool.query(`SELECT ${COLUMNS}, (${scores.join(' + ')}) * confidence AS relevance FROM panthorium_agent_memories
      WHERE user_id=$1 AND scope=$2 AND (expires_at IS NULL OR expires_at>NOW())${noteFilter} AND (${conditions.join(' OR ')})
      ORDER BY relevance DESC,importance DESC,updated_at DESC LIMIT $3`, args);
    return result.rows.map(row => this.mapRow(row));
  }
  async search(userId, query, limit = 10, scope = 'personal') {
    scopeValue(scope);
    if (!this.notesRepository) return this.searchSql(userId,query,limit,scope);
    await this.ensureNotesMigrated(userId);
    const safe = Math.min(Math.max(Number(limit) || 10,1),30);
    const [memories,notes] = await Promise.all([this.searchSql(userId,query,safe,scope),this.scopedNotes(userId,scope)]);
    const terms = this.queryTerms(query);
    return [...memories,...notes].map(item => ({ item,relevance:scoreMemory(item,terms) }))
      .filter(entry => matchesMemory(entry.item,terms) && entry.relevance > Number(entry.item.importance || 50)/1000 + 0.09)
      .sort((a,b) => b.relevance-a.relevance || Date.parse(b.item.updatedAt)-Date.parse(a.item.updatedAt)).slice(0,safe).map(entry => entry.item);
  }

  async update(userId, memoryId, patch = {}, scope = 'personal') {
    scopeValue(scope);
    if (patch.scope !== undefined && patch.scope !== scope) throw new TypeError('memory_scope_immutable');
    const current = await this.get(userId,memoryId,scope);
    if (!current) return null;
    const item = this.normalize({ ...current,...patch,memoryId:current.memoryId,userId:current.userId,scope,updatedAt:new Date().toISOString() });
    if (this.notesRepository && current.kind === 'note') {
      // Privacy metadata is updated first: a failed GCS write must not leave
      // newly restricted/expiring content retrievable with stale metadata.
      await this.storeNoteMetadata(item);
      const note = await this.notesRepository.update(userId,memoryId,{ title:item.title,content:item.content,tags:item.tags,source:item.source,importance:item.importance });
      return note ? { ...note,...this.metadata(item) } : null;
    }
    if (!this.pool) { this.memory.set(item.memoryId,item); return item; }
    const result = await this.pool.query(`UPDATE panthorium_agent_memories SET title=$4,content=$5,tags=$6::jsonb,source=$7,importance=$8,confidence=$9,expires_at=$10,provenance=$11::jsonb,confirmation=$12,sensitivity=$13,updated_at=NOW()
      WHERE memory_id=$1 AND user_id=$2 AND scope=$3 AND (expires_at IS NULL OR expires_at>NOW()) RETURNING ${COLUMNS}`,
      [memoryId,userId,scope,item.title,item.content,JSON.stringify(item.tags),item.source,item.importance,item.confidence,item.expiresAt,JSON.stringify(item.provenance),item.confirmation,item.sensitivity]);
    return this.mapRow(result.rows[0]);
  }
  async delete(userId, memoryId, scope = 'personal') {
    scopeValue(scope);
    // Expired memories are not retrievable but their owner can still erase them.
    const current = await this.get(userId,memoryId,scope,{ includeExpired:true });
    if (!current) return false;
    if (this.notesRepository && current.kind === 'note') {
      const removed = await this.notesRepository.delete(userId,memoryId);
      if (removed) await this.removeNoteMetadata(userId,memoryId);
      return removed;
    }
    if (!this.pool) return this.memory.delete(String(memoryId));
    const result = await this.pool.query('DELETE FROM panthorium_agent_memories WHERE memory_id=$1 AND user_id=$2 AND scope=$3',[memoryId,userId,scope]);
    return (result.rowCount || 0)>0;
  }
}

module.exports = { AgentMemoryRepository, sameNote, MEMORY_SCOPES, CONFIRMATIONS, SENSITIVITIES, scopeValue };
