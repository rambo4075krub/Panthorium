'use strict';

const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');
const KINDS = Object.freeze(['organization', 'membership', 'team', 'invitation', 'resource', 'revision', 'comment', 'accessRequest', 'audit', 'resourceAiRun']);
const PILOT_LIMITS = Object.freeze({ organizationsPerCreator: 3, members: 200, teams: 100, pendingInvitations: 50, entitiesPerKind: 2000 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function failure(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function validId(id) { return typeof id === 'string' && ID.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id); }

// Each organization is one bounded consistency domain. The root row lock is
// acquired for reads too: a callback never mixes pre/post-revocation entities.
class OrganizationRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', pool, required = process.env.NODE_ENV === 'production', allowMemory = false } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.required = required || process.env.NODE_ENV === 'production';
    this.allowMemory = allowMemory && !this.required;
    this.ready = false;
    this.memory = new Map();
    this.locks = new Map();
  }
  async init() {
    if (!this.pool) {
      if (!this.allowMemory) throw failure('org_storage_unavailable', 503);
      this.ready = true; return;
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_org_creators (user_id TEXT PRIMARY KEY)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_organizations (org_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, data JSONB NOT NULL)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS panthorium_organizations_creator ON panthorium_organizations(creator_id)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_org_entities (org_id TEXT NOT NULL REFERENCES panthorium_organizations(org_id), kind TEXT NOT NULL, entity_id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(org_id,kind,entity_id))`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS panthorium_org_memberships ON panthorium_org_entities(kind,entity_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS panthorium_org_history ON panthorium_org_entities(org_id,kind,(data->>'resourceId'),(data->>'createdAt'),entity_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS panthorium_org_audit_history ON panthorium_org_entities(org_id,(data->>'createdAt') DESC,entity_id DESC) WHERE kind='audit'`);
    this.ready = true;
  }
  readiness() { return { available: this.ready, durable: !!this.pool && this.ready, mode: this.pool ? 'postgresql' : 'development-memory', pilotLimits: PILOT_LIMITS }; }
  check() { if (!this.ready) throw failure('org_storage_unavailable', 503); }
  async locked(key, callback) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release; const waiting = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => waiting); this.locks.set(key, tail);
    await previous;
    try { return await callback(); }
    finally { release(); if (this.locks.get(key) === tail) this.locks.delete(key); }
  }
  key(kind, id) {
    if (!KINDS.includes(kind) || !validId(id)) throw failure('org_invalid_entity');
    return `${kind}:${id}`;
  }
  envelope(orgId, kind, id, data, existing, expectedVersion) {
    this.key(kind, id);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('org_invalid_entity');
    if ((data.id != null && data.id !== id) || (data.orgId != null && data.orgId !== orgId) || (kind === 'organization' && id !== orgId) || (kind === 'membership' && data.userId !== id)) throw failure('org_identity_mismatch');
    const expected = expectedVersion === undefined ? data.version : expectedVersion;
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || expected !== (existing?.version || 0))) throw failure('org_version_conflict', 409);
    if (existing && ['audit', 'revision'].includes(kind)) throw failure('org_immutable_entity', 409);
    const now = new Date().toISOString();
    return { ...clone(data), id, orgId, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now };
  }
  memoryTx(orgId, records, write) {
    const repository = this;
    return {
      async get(kind, id) { return clone(records.get(repository.key(kind, id)) || null); },
      async list(kind, options = {}) {
        repository.key(kind, orgId);
        let values = [...records.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, data]) => clone(data));
        if (['audit', 'revision'].includes(kind)) {
          if (options.resourceId) { repository.key('resource', options.resourceId); values = values.filter(item => item.resourceId === options.resourceId); }
          values.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
          if (options.before) values = values.filter(item => item.createdAt < options.before.createdAt || (item.createdAt === options.before.createdAt && item.id < options.before.id));
          return values.slice(0, Math.max(1, Math.min(PILOT_LIMITS.entitiesPerKind, options.limit || PILOT_LIMITS.entitiesPerKind)));
        }
        return values;
      },
      async put(kind, id, data, expectedVersion) {
        if (!write) throw failure('org_read_only_transaction', 409);
        const key = repository.key(kind, id), existing = records.get(key);
        const value = repository.envelope(orgId, kind, id, data, existing, expectedVersion);
        if (!['audit', 'revision'].includes(kind) && !existing && (await this.list(kind)).length >= PILOT_LIMITS.entitiesPerKind) throw failure('org_capacity_exceeded', 409);
        records.set(key, value); return clone(value);
      },
      async remove(kind, id, expectedVersion) {
        if (!write) throw failure('org_read_only_transaction', 409);
        if (['organization', 'audit', 'revision'].includes(kind)) throw failure('org_immutable_entity', 409);
        const key = repository.key(kind, id), existing = records.get(key);
        if (expectedVersion !== undefined && existing?.version !== expectedVersion) throw failure('org_version_conflict', 409);
        return records.delete(key);
      }
    };
  }
  sqlTx(orgId, client, write) {
    const repository = this;
    return {
      async get(kind, id) {
        repository.key(kind, id);
        if (kind === 'organization') {
          if (id !== orgId) return null;
          return clone((await client.query('SELECT data FROM panthorium_organizations WHERE org_id=$1', [orgId])).rows[0]?.data || null);
        }
        return clone((await client.query('SELECT data FROM panthorium_org_entities WHERE org_id=$1 AND kind=$2 AND entity_id=$3', [orgId, kind, id])).rows[0]?.data || null);
      },
      async list(kind, options = {}) {
        repository.key(kind, orgId);
        if (kind === 'organization') return [await this.get(kind, orgId)];
        if (['audit', 'revision'].includes(kind)) {
          const limit = Math.max(1, Math.min(PILOT_LIMITS.entitiesPerKind, options.limit || PILOT_LIMITS.entitiesPerKind));
          const before = options.before;
          const params = [orgId, kind]; let filter = '';
          if (options.resourceId) { repository.key('resource', options.resourceId); params.push(options.resourceId); filter += ` AND (data->>'resourceId')=$${params.length}`; }
          if (before) { params.push(before.createdAt, before.id); filter += ` AND ((data->>'createdAt')<$${params.length - 1} OR ((data->>'createdAt')=$${params.length - 1} AND entity_id<$${params.length}))`; }
          params.push(limit);
          const query = `SELECT data FROM panthorium_org_entities WHERE org_id=$1 AND kind=$2${filter} ORDER BY data->>'createdAt' DESC, entity_id DESC LIMIT $${params.length}`;
          return (await client.query(query, params)).rows.map(row => clone(row.data));
        }
        const rows = (await client.query('SELECT data FROM panthorium_org_entities WHERE org_id=$1 AND kind=$2 LIMIT $3', [orgId, kind, PILOT_LIMITS.entitiesPerKind + 1])).rows;
        if (rows.length > PILOT_LIMITS.entitiesPerKind) throw failure('org_capacity_exceeded', 409);
        return rows.map(row => clone(row.data));
      },
      async put(kind, id, data, expectedVersion) {
        if (!write) throw failure('org_read_only_transaction', 409);
        const existing = await this.get(kind, id);
        const value = repository.envelope(orgId, kind, id, data, existing, expectedVersion);
        if (!['audit', 'revision'].includes(kind) && !existing && (await this.list(kind)).length >= PILOT_LIMITS.entitiesPerKind) throw failure('org_capacity_exceeded', 409);
        if (kind === 'organization') await client.query('UPDATE panthorium_organizations SET data=$2 WHERE org_id=$1', [orgId, JSON.stringify(value)]);
        else await client.query(`INSERT INTO panthorium_org_entities(org_id,kind,entity_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,kind,entity_id) DO UPDATE SET data=EXCLUDED.data`, [orgId, kind, id, JSON.stringify(value)]);
        return clone(value);
      },
      async remove(kind, id, expectedVersion) {
        if (!write) throw failure('org_read_only_transaction', 409);
        repository.key(kind, id);
        if (['organization', 'audit', 'revision'].includes(kind)) throw failure('org_immutable_entity', 409);
        if (expectedVersion !== undefined && (await this.get(kind, id))?.version !== expectedVersion) throw failure('org_version_conflict', 409);
        return (await client.query('DELETE FROM panthorium_org_entities WHERE org_id=$1 AND kind=$2 AND entity_id=$3', [orgId, kind, id])).rowCount > 0;
      }
    };
  }
  async run(orgId, write, callback) {
    this.check(); if (!validId(orgId)) throw failure('org_invalid_id');
    if (!this.pool) return this.locked(`org:${orgId}`, async () => {
      const original = this.memory.get(orgId); if (!original) throw failure('org_not_found', 404);
      const records = new Map([...original].map(([key, value]) => [key, clone(value)]));
      const result = await callback(this.memoryTx(orgId, records, write));
      if (write) this.memory.set(orgId, records);
      return result;
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (!(await client.query('SELECT org_id FROM panthorium_organizations WHERE org_id=$1 FOR UPDATE', [orgId])).rows.length) throw failure('org_not_found', 404);
      const result = await callback(this.sqlTx(orgId, client, write));
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  read(orgId, callback) { return this.run(orgId, false, callback); }
  transact(orgId, callback) { return this.run(orgId, true, callback); }
  async createOrganization(org, membership) {
    this.check(); const orgId = org?.id, userId = membership?.userId || membership?.id;
    if (!validId(orgId) || !validId(userId) || membership.id !== userId) throw failure('org_invalid_identity');
    const organization = this.envelope(orgId, 'organization', orgId, org, null);
    const owner = this.envelope(orgId, 'membership', userId, membership, null);
    if (owner.role !== 'owner' || owner.status !== 'active') throw failure('org_invalid_owner');
    const auditId = randomUUID();
    const audit = this.envelope(orgId, 'audit', auditId, { actorId: userId, event: 'organization.created', target: { kind: 'organization', id: orgId }, details: { profile: organization.profile }, occurredAt: organization.createdAt }, null);
    if (!this.pool) return this.locked(`creator:${userId}`, async () => {
      if (this.memory.has(orgId)) throw failure('org_conflict', 409);
      const count = [...this.memory.values()].filter(records => [...records.values()].some(value => value.id === value.orgId && value.createdBy === userId)).length;
      if (count >= PILOT_LIMITS.organizationsPerCreator) throw failure('org_creation_limit', 409);
      this.memory.set(orgId, new Map([[`organization:${orgId}`, { ...organization, createdBy: userId }], [`membership:${userId}`, owner], [`audit:${auditId}`, audit]]));
      return { organization: { ...organization, createdBy: userId }, membership: owner };
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO panthorium_org_creators(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId]);
      await client.query('SELECT user_id FROM panthorium_org_creators WHERE user_id=$1 FOR UPDATE', [userId]);
      const count = Number((await client.query('SELECT COUNT(*) AS count FROM panthorium_organizations WHERE creator_id=$1', [userId])).rows[0].count);
      if (count >= PILOT_LIMITS.organizationsPerCreator) throw failure('org_creation_limit', 409);
      const stored = { ...organization, createdBy: userId };
      await client.query('INSERT INTO panthorium_organizations(org_id,creator_id,data) VALUES($1,$2,$3)', [orgId, userId, JSON.stringify(stored)]);
      await client.query('INSERT INTO panthorium_org_entities(org_id,kind,entity_id,data) VALUES($1,$2,$3,$4)', [orgId, 'membership', userId, JSON.stringify(owner)]);
      await client.query('INSERT INTO panthorium_org_entities(org_id,kind,entity_id,data) VALUES($1,$2,$3,$4)', [orgId, 'audit', auditId, JSON.stringify(audit)]);
      await client.query('COMMIT'); return { organization: stored, membership: owner };
    } catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') throw failure('org_conflict', 409); throw error; }
    finally { client.release(); }
  }
  async listOrganizationsForUser(userId) {
    this.check(); if (!validId(userId)) throw failure('org_invalid_identity');
    const ids = this.pool ? (await this.pool.query('SELECT org_id FROM panthorium_org_entities WHERE kind=$1 AND entity_id=$2', ['membership', userId])).rows.map(row => row.org_id) : [...this.memory.keys()];
    const result = [];
    for (const orgId of ids) await this.read(orgId, async tx => {
      const membership = await tx.get('membership', userId), organization = await tx.get('organization', orgId);
      if (membership?.status === 'active' && organization?.status === 'active' && (!membership.expiresAt || Date.parse(membership.expiresAt) > Date.now())) result.push({ organization, membership });
    });
    return result;
  }
}
module.exports = { OrganizationRepository, PILOT_LIMITS, KINDS, validId, failure };
