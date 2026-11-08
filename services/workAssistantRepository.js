'use strict';
const { getDatabasePool } = require('./databasePool');
const { createHash } = require('node:crypto');
const copy = value => structuredClone(value);
const error = (code, status = 400) => Object.assign(new Error(code), { code, status, sideEffectNotApplied: true });
const COLUMNS = 'id,owner_id AS "ownerId",version,data,updated_at AS "updatedAt"';
const MAX_PROJECTS = 40;
const MAX_BYTES = 300000;
function fingerprint(value) {
  const stable = input => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map(key => [key, stable(input[key])])) : input;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

class WorkAssistantRepository {
  constructor({ pool, databaseUrl, databaseSslMode = 'require', allowMemory = false } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.available = !!this.pool || allowMemory; this.memory = new Map(); this.tail = Promise.resolve();
  }
  requireReady() { if (!this.available) throw error('work_storage_unavailable', 503); }
  async init() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_work_projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_work_projects_owner ON panthorium_work_projects(owner_id,updated_at DESC);`);
  }
  async get(ownerId, id, client = this.pool) {
    this.requireReady();
    if (!client) { const row = this.memory.get(id); return row?.ownerId === ownerId ? copy(row) : null; }
    return (await client.query(`SELECT ${COLUMNS} FROM panthorium_work_projects WHERE id=$1 AND owner_id=$2`, [id, ownerId])).rows[0] || null;
  }
  async list(ownerId) {
    this.requireReady();
    if (!this.pool) return [...this.memory.values()].filter(row => row.ownerId === ownerId).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(copy);
    return (await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_work_projects WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 40`, [ownerId])).rows;
  }
  // One transaction protects the project, its calendar entries and email outbox.
  // Memory mode is only for tests/development, serialized and rolled back together.
  async mutate({ ownerId, id, version, operationId, input, create = false, resources = [] }, change) {
    this.requireReady();
    let release;
    if (!this.pool) { const previous = this.tail; this.tail = new Promise(resolve => { release = resolve; }); await previous; }
    const snapshots = !this.pool ? [this.memory, ...resources].map(map => [map, copy([...map])]) : [];
    const client = this.pool ? await this.pool.connect() : null;
    try {
      if (client) { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['work:' + ownerId]); }
      let row = await this.get(ownerId, id, client);
      const digest = operationId ? fingerprint(input) : null;
      const previous = row?.data.operations?.find(item => item.id === operationId);
      if (previous) {
        if (previous.digest !== digest) throw error('work_operation_conflict', 409);
        if (client) await client.query('COMMIT');
        return { project: row, replayed: true };
      }
      if (!row) {
        if (!create || version !== 0) throw error('work_project_not_found', 404);
        const count = client ? Number((await client.query('SELECT COUNT(*) AS count FROM panthorium_work_projects WHERE owner_id=$1', [ownerId])).rows[0].count) : [...this.memory.values()].filter(item => item.ownerId === ownerId).length;
        if (count >= MAX_PROJECTS) throw error('work_project_limit', 429);
        row = { id, ownerId, version: 0, data: { title: 'งานใหม่', sourceFileIds: [], text: '', draft: '', history: [], tasks: [], exports: [], operations: [] } };
      }
      if (row.version !== version) throw error('work_version_conflict', 409);
      const next = copy(row);
      await change(next, client);
      if (operationId) next.data.operations = [...(next.data.operations || []), { id: operationId, digest }].slice(-40);
      if (Buffer.byteLength(JSON.stringify(next.data)) > MAX_BYTES) throw error('work_project_too_large', 413);
      next.version++; next.updatedAt = new Date().toISOString();
      if (client) {
        if (!row.version) await client.query('INSERT INTO panthorium_work_projects(id,owner_id,version,data,updated_at) VALUES($1,$2,$3,$4::jsonb,$5)', [id, ownerId, next.version, JSON.stringify(next.data), next.updatedAt]);
        else await client.query('UPDATE panthorium_work_projects SET version=$3,data=$4::jsonb,updated_at=$5 WHERE id=$1 AND owner_id=$2', [id, ownerId, next.version, JSON.stringify(next.data), next.updatedAt]);
        await client.query('COMMIT');
      } else this.memory.set(id, copy(next));
      return { project: next, replayed: false };
    } catch (failure) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      for (const [map, snapshot] of snapshots) { map.clear(); for (const [key, value] of snapshot) map.set(key, value); }
      throw failure;
    } finally { client?.release(); release?.(); }
  }
}
module.exports = { WorkAssistantRepository, error, fingerprint, MAX_PROJECTS };
