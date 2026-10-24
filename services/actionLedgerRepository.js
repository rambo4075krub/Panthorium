'use strict';
const { createHash, randomUUID } = require('crypto');
const { getDatabasePool } = require('./databasePool');

const STATES = ['proposed', 'awaiting_confirmation', 'running', 'succeeded', 'failed', 'cancel_requested', 'unknown'];
const SELECT = `action_id AS "actionId", user_id AS "userId", request_id AS "requestId", tool_id AS "toolId", args, args_hash AS "argsHash", approval_hash AS "approvalHash", approval_expires_at AS "approvalExpiresAt", requires_confirmation AS "requiresConfirmation", description, risk, state, result, started_at AS "startedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
const clone = value => JSON.parse(JSON.stringify(value));
function identifier(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`invalid_${name}`);
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 30) throw new Error('invalid_tool_args');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  }
  throw new Error('invalid_tool_args');
}
function payloadHash(toolId, args) {
  const body = canonical({ toolId, args });
  if (Buffer.byteLength(body) > 262144) throw new Error('tool_args_too_large');
  return createHash('sha256').update(body).digest('hex');
}

class ActionLedgerRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', pool, required = false, allowMemory = false, approvalTtlMs = 5 * 60 * 1000, staleAfterMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.required = required;
    this.allowMemory = allowMemory === true && required !== true;
    this.ready = false;
    this.approvalTtlMs = approvalTtlMs;
    this.staleAfterMs = staleAfterMs;
    this.now = now;
    this.memory = new Map();
    this.keys = new Map();
  }
  async init() {
    this.ready = false;
    if (!this.pool) {
      if (!this.allowMemory) throw new Error('action_ledger_unavailable');
      this.ready = true;
      return;
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_action_ledger (
      action_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT NOT NULL,
      tool_id TEXT NOT NULL, args JSONB NOT NULL, args_hash TEXT NOT NULL,
      approval_hash TEXT NOT NULL, approval_expires_at TIMESTAMPTZ NOT NULL,
      requires_confirmation BOOLEAN NOT NULL, description TEXT NOT NULL, risk TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('proposed','awaiting_confirmation','running','succeeded','failed','cancel_requested','unknown')),
      result JSONB, started_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE(user_id,request_id));
      CREATE INDEX IF NOT EXISTS idx_panthorium_action_owner_time ON panthorium_action_ledger(user_id,created_at DESC);`);
    this.ready = true;
  }
  assertReady() { if (!this.ready || (!this.pool && !this.allowMemory)) throw new Error('action_ledger_unavailable'); }
  async propose({ userId, requestId, toolId, args, risk = 'low', requiresConfirmation = false, description = '' }) {
    this.assertReady(); identifier(userId, 'action_owner'); identifier(requestId, 'request_id'); identifier(toolId, 'tool_id');
    const argsHash = payloadHash(toolId, args);
    const actionId = randomUUID();
    const now = new Date(this.now()).toISOString();
    const approvalExpiresAt = new Date(this.now() + this.approvalTtlMs).toISOString();
    const approvalHash = createHash('sha256').update(canonical({ actionId, userId, requestId, argsHash, approvalExpiresAt })).digest('hex');
    const item = { actionId, userId, requestId, toolId, args: clone(args), argsHash, approvalHash, approvalExpiresAt, requiresConfirmation: !!requiresConfirmation, description: String(description).slice(0, 500), risk, state: requiresConfirmation ? 'awaiting_confirmation' : 'proposed', result: null, startedAt: null, createdAt: now, updatedAt: now };
    let stored;
    if (this.pool) {
      await this.pool.query(`INSERT INTO panthorium_action_ledger(action_id,user_id,request_id,tool_id,args,args_hash,approval_hash,approval_expires_at,requires_confirmation,description,risk,state,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$13) ON CONFLICT(user_id,request_id) DO NOTHING`,
      [actionId,userId,requestId,toolId,JSON.stringify(item.args),argsHash,approvalHash,approvalExpiresAt,item.requiresConfirmation,item.description,risk,item.state,now]);
      const result = await this.pool.query(`SELECT ${SELECT} FROM panthorium_action_ledger WHERE user_id=$1 AND request_id=$2`, [userId,requestId]);
      stored = result.rows[0];
    } else {
      const key = JSON.stringify([userId, requestId]);
      const existingId = this.keys.get(key);
      if (!existingId) { this.keys.set(key, actionId); this.memory.set(actionId, item); }
      stored = this.memory.get(existingId || actionId);
    }
    if (!stored || stored.argsHash !== argsHash) throw new Error('action_request_conflict');
    return clone(stored);
  }
  async get(userId, actionId) {
    this.assertReady(); identifier(userId, 'action_owner'); identifier(actionId, 'action_id');
    const now = new Date(this.now()).toISOString();
    const stale = new Date(this.now() - this.staleAfterMs).toISOString();
    if (this.pool) {
      // A lost worker is never re-claimed. Only reconciliation or its eventual completion can resolve this receipt.
      await this.pool.query(`UPDATE panthorium_action_ledger SET state='unknown',updated_at=$3 WHERE user_id=$1 AND action_id=$2 AND state IN ('running','cancel_requested') AND started_at < $4 AND result IS NULL`, [userId,actionId,now,stale]);
      const result = await this.pool.query(`SELECT ${SELECT} FROM panthorium_action_ledger WHERE user_id=$1 AND action_id=$2`, [userId,actionId]);
      return result.rows[0] || null;
    }
    const item = this.memory.get(actionId);
    if (!item || item.userId !== userId) return null;
    if (['running', 'cancel_requested'].includes(item.state) && item.startedAt && Date.parse(item.startedAt) < Date.parse(stale) && !item.result) { item.state = 'unknown'; item.updatedAt = now; }
    return clone(item);
  }
  async findByRequest(userId, requestId) {
    this.assertReady(); identifier(userId, 'action_owner'); identifier(requestId, 'request_id');
    if (this.pool) {
      const result = await this.pool.query('SELECT action_id AS \"actionId\" FROM panthorium_action_ledger WHERE user_id=$1 AND request_id=$2', [userId, requestId]);
      return result.rows[0] ? this.get(userId, result.rows[0].actionId) : null;
    }
    const id = this.keys.get(JSON.stringify([userId, requestId]));
    return id ? this.get(userId, id) : null;
  }
  async list(userId, limit = 30) {
    this.assertReady(); identifier(userId, 'action_owner');
    const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 30)));
    if (this.pool) {
      const result = await this.pool.query(`SELECT action_id AS "actionId" FROM panthorium_action_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, safeLimit]);
      return Promise.all(result.rows.map(row => this.get(userId, row.actionId)));
    }
    const items = [...this.memory.values()].filter(item => item.userId === userId).sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, safeLimit);
    return Promise.all(items.map(item => this.get(userId, item.actionId)));
  }
  async listNotificationStates(userId, limit = 100) {
    this.assertReady(); identifier(userId, 'action_owner');
    const count = Math.min(100, Math.max(1, Math.floor(Number(limit) || 100)));
    if (!this.pool) return this.list(userId,count);
    const now = new Date(this.now()).toISOString();
    const stale = new Date(this.now() - this.staleAfterMs).toISOString();
    // One account-scoped reconciliation and one narrow query replace per-row get()
    // calls for a polling inbox. Never expose approval hashes, arguments or results.
    await this.pool.query(`UPDATE panthorium_action_ledger SET state='unknown',updated_at=$2
      WHERE user_id=$1 AND state IN ('running','cancel_requested') AND started_at < $3 AND result IS NULL`, [userId,now,stale]);
    const result = await this.pool.query(`SELECT action_id AS "actionId",user_id AS "userId",tool_id AS "toolId",state,
      started_at AS "startedAt",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM panthorium_action_ledger WHERE user_id=$1 ORDER BY created_at DESC,action_id DESC LIMIT $2`, [userId,count]);
    return result.rows;
  }
  async claim(userId, actionId, approvalHash) {
    const item = await this.get(userId, actionId);
    if (!item) throw new Error('action_not_found');
    if (!['proposed', 'awaiting_confirmation'].includes(item.state)) return { claimed: false, action: item };
    if (item.requiresConfirmation) {
      if (typeof approvalHash !== 'string' || approvalHash !== item.approvalHash) throw new Error('action_approval_invalid');
      if (!this.pool && Date.parse(item.approvalExpiresAt) <= this.now()) throw new Error('action_confirmation_expired');
    }
    const now = new Date(this.now()).toISOString();
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(`SELECT ${SELECT} FROM panthorium_action_ledger WHERE user_id=$1 AND action_id=$2 FOR UPDATE`, [userId, actionId]);
        const current = locked.rows[0];
        if (!current) throw new Error('action_not_found');
        if (!['proposed','awaiting_confirmation'].includes(current.state)) {
          await client.query('COMMIT');
          return { claimed: false, action: current };
        }
        // Evaluate server clock only after acquiring the row lock. NOW() is the transaction start time.
        const result = await client.query(`UPDATE panthorium_action_ledger SET state='running',started_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE user_id=$1 AND action_id=$2 AND state IN ('proposed','awaiting_confirmation')
          AND (requires_confirmation=FALSE OR (approval_hash=$3 AND approval_expires_at > clock_timestamp())) RETURNING ${SELECT}`, [userId,actionId,approvalHash || null]);
        if (!result.rows[0]) throw new Error('action_confirmation_expired');
        await client.query('COMMIT');
        return { claimed: true, action: result.rows[0] };
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* no effect has been dispatched */ }
        throw error;
      } finally { client.release(); }
    }
    const current = this.memory.get(actionId);
    if (!['proposed', 'awaiting_confirmation'].includes(current.state)) return { claimed: false, action: clone(current) };
    current.state = 'running'; current.startedAt = now; current.updatedAt = now;
    return { claimed: true, action: clone(current) };
  }
  async finish(userId, actionId, state, result) {
    this.assertReady();
    if (!['succeeded','failed'].includes(state)) throw new Error('invalid_action_state');
    const frozenResult = clone(result);
    const now = new Date(this.now()).toISOString();
    if (this.pool) {
      const updated = await this.pool.query(`UPDATE panthorium_action_ledger SET state=$3,result=$4::jsonb,updated_at=$5
        WHERE user_id=$1 AND action_id=$2 AND state IN ('running','cancel_requested','unknown') AND started_at IS NOT NULL AND result IS NULL RETURNING ${SELECT}`, [userId,actionId,state,JSON.stringify(frozenResult),now]);
      return updated.rows[0] || await this.get(userId, actionId);
    }
    const item = this.memory.get(actionId);
    if (!item || item.userId !== userId) return null;
    if (['running','cancel_requested','unknown'].includes(item.state) && item.startedAt && !item.result) { item.state = state; item.result = frozenResult; item.updatedAt = now; }
    return clone(item);
  }
  async markUnknown(userId, actionId) {
    this.assertReady();
    const now = new Date(this.now()).toISOString();
    if (this.pool) {
      await this.pool.query(`UPDATE panthorium_action_ledger SET state='unknown',updated_at=$3 WHERE user_id=$1 AND action_id=$2 AND state IN ('running','cancel_requested') AND result IS NULL`, [userId,actionId,now]);
      return this.get(userId, actionId);
    }
    const item = this.memory.get(actionId);
    if (item?.userId === userId && ['running','cancel_requested'].includes(item.state) && !item.result) { item.state = 'unknown'; item.updatedAt = now; }
    return item?.userId === userId ? clone(item) : null;
  }
  async cancel(userId, actionId) {
    const item = await this.get(userId, actionId);
    if (!item) throw new Error('action_not_found');
    const now = new Date(this.now()).toISOString();
    if (this.pool) {
      await this.pool.query(`UPDATE panthorium_action_ledger SET state='cancel_requested',updated_at=$3 WHERE user_id=$1 AND action_id=$2 AND state IN ('proposed','awaiting_confirmation','running')`, [userId,actionId,now]);
      return this.get(userId, actionId);
    }
    const current = this.memory.get(actionId);
    if (['proposed','awaiting_confirmation','running'].includes(current.state)) { current.state = 'cancel_requested'; current.updatedAt = now; }
    return clone(current);
  }
}
module.exports = { ActionLedgerRepository, payloadHash, canonical, STATES };
