'use strict';

const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('crypto');
const { getDatabasePool } = require('./databasePool');
const ID = /^[A-Za-z0-9:_-]{1,180}$/;
const MAX_RESUME_MS = 15 * 60 * 1000;

class VoiceSessionRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', pool, required = false, secret = '' } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.required = required;
    this.key = secret ? createHash('sha256').update('panthorium-voice-resumption-v1:').update(secret).digest() : null;
    this.ready = false;
  }

  async init() {
    if (!this.pool) { if (this.required) throw new Error('voice_session_database_required'); return; }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_voice_checkpoints (
      user_id TEXT NOT NULL, session_id TEXT NOT NULL, encrypted_handle TEXT NOT NULL,
      action_pending BOOLEAN NOT NULL DEFAULT false, expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,session_id));
      CREATE INDEX IF NOT EXISTS panthorium_voice_checkpoint_expiry ON panthorium_voice_checkpoints(expires_at);
      CREATE TABLE IF NOT EXISTS panthorium_voice_leases (
      user_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
    this.ready = true;
  }

  available() { return this.ready && !!this.pool; }
  ids(userId, sessionId) {
    if (!ID.test(String(userId || '')) || !ID.test(String(sessionId || ''))) throw new Error('invalid_voice_session_identity');
  }
  seal(value, userId, sessionId) {
    this.ids(userId, sessionId);
    if (!this.key) throw new Error('voice_session_encryption_unavailable');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['panthorium-voice-v1', userId, sessionId])));
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  open(value, userId, sessionId) {
    if (!this.key) return null;
    try {
      const data = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0,12));
      decipher.setAAD(Buffer.from(JSON.stringify(['panthorium-voice-v1', userId, sessionId])));
      decipher.setAuthTag(data.subarray(12,28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    } catch { return null; }
  }
  async get({ userId, sessionId }) {
    this.ids(userId, sessionId);
    if (!this.available()) return null;
    const row = (await this.pool.query('SELECT encrypted_handle,action_pending,expires_at FROM panthorium_voice_checkpoints WHERE user_id=$1 AND session_id=$2 AND expires_at>NOW()', [userId, sessionId])).rows[0];
    if (!row) return null;
    const handle = this.open(row.encrypted_handle, userId, sessionId);
    return handle ? { handle, actionPending: row.action_pending, expiresAt: new Date(row.expires_at).toISOString() } : null;
  }
  async put({ userId, sessionId, handle, expiresAt, actionPending = false }) {
    this.ids(userId, sessionId);
    if (!this.available()) throw new Error('voice_session_store_unavailable');
    if (typeof handle !== 'string' || !handle || Buffer.byteLength(handle) > 16384) throw new Error('invalid_voice_session_handle');
    const expires = Math.min(new Date(expiresAt === undefined ? Date.now() + MAX_RESUME_MS : expiresAt).getTime(), Date.now() + MAX_RESUME_MS);
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('invalid_voice_session_expiry');
    await this.pool.query(`INSERT INTO panthorium_voice_checkpoints(user_id,session_id,encrypted_handle,action_pending,expires_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,session_id) DO UPDATE SET encrypted_handle=$3,action_pending=$4,expires_at=$5,updated_at=NOW()`, [userId, sessionId, this.seal(handle, userId, sessionId), !!actionPending, new Date(expires).toISOString()]);
  }
  async delete({ userId, sessionId }) {
    this.ids(userId, sessionId);
    if (this.available()) await this.pool.query('DELETE FROM panthorium_voice_checkpoints WHERE user_id=$1 AND session_id=$2', [userId, sessionId]);
  }
  leaseExpiry(ttlMs) { return new Date(Date.now() + Math.max(10000, Math.min(Number(ttlMs) || 45000, 90000))).toISOString(); }
  async claim({ userId, sessionId, ownerId, ttlMs }) {
    this.ids(userId, sessionId); this.ids(userId, ownerId);
    if (!this.available()) throw new Error('voice_session_store_unavailable');
    const result = await this.pool.query(`INSERT INTO panthorium_voice_leases(user_id,session_id,owner_id,expires_at)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET session_id=$2,owner_id=$3,expires_at=$4,updated_at=NOW()
      WHERE panthorium_voice_leases.expires_at<=NOW() OR panthorium_voice_leases.owner_id=$3 RETURNING owner_id,session_id`, [userId, sessionId, ownerId, this.leaseExpiry(ttlMs)]);
    return result.rows.some(row => row.owner_id === ownerId && row.session_id === sessionId);
  }
  async renew({ userId, ownerId, ttlMs }) {
    this.ids(userId, ownerId);
    if (!this.available()) return false;
    const r = await this.pool.query('UPDATE panthorium_voice_leases SET expires_at=$3,updated_at=NOW() WHERE user_id=$1 AND owner_id=$2 AND expires_at>NOW() RETURNING owner_id', [userId,ownerId,this.leaseExpiry(ttlMs)]);
    return r.rows.length === 1;
  }
  async release({ userId, ownerId }) {
    this.ids(userId, ownerId);
    if (this.available()) await this.pool.query('DELETE FROM panthorium_voice_leases WHERE user_id=$1 AND owner_id=$2', [userId, ownerId]);
  }
  async purgeExpired() {
    if (!this.available()) return;
    await this.pool.query('DELETE FROM panthorium_voice_checkpoints WHERE expires_at<=NOW()');
    await this.pool.query('DELETE FROM panthorium_voice_leases WHERE expires_at<=NOW()');
  }
}
module.exports = { VoiceSessionRepository };
