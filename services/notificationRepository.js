'use strict';
const { getDatabasePool } = require('./databasePool');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const iso = value => value instanceof Date ? value.toISOString() : value;
function failure(code, status = 400) { return Object.assign(new Error(code), { code, status, ...(status < 500 ? { sideEffectNotApplied: true } : {}) }); }
function mergeSettings(previous, patch) {
  const result = { ...previous, ...patch };
  for (const key of ['channels', 'categories', 'events', 'quietHours']) result[key] = { ...previous[key], ...(patch[key] || {}) };
  return clone(result);
}
const socialActivity = type => type === 'social.activity' || typeof type === 'string' && type.startsWith('social.activity.');
const SOCIAL_ACTIVITY_SQL = "(type='social.activity' OR type LIKE 'social.activity.%')";
const SELECT = 'id,user_id,category,type,title,body,source_id,severity,sensitive,created_at,read_at,deleted_at';
function item(row) {
  return row ? { id: row.id, userId: row.user_id, category: row.category, type: row.type, title: row.title, body: row.body,
    sourceId: row.source_id, severity: row.severity, sensitive: row.sensitive, createdAt: iso(row.created_at),
    readAt: iso(row.read_at), deletedAt: iso(row.deleted_at) } : null;
}

class NotificationRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', pool, required = false, allowMemory = false, now = Date.now } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.required = required === true;
    this.allowMemory = allowMemory === true && !this.required;
    this.now = now;
    this.ready = false;
    this.preferences = new Map();
    this.items = new Map();
  }
  async init() {
    if (!this.pool) {
      if (!this.allowMemory) throw failure('notifications_storage_unavailable', 503);
      this.ready = true; return;
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_notification_settings (
      user_id TEXT PRIMARY KEY, settings JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS panthorium_notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, source_id TEXT, severity TEXT NOT NULL,
      sensitive BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL,
      read_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ);
      CREATE INDEX IF NOT EXISTS idx_notifications_owner_time ON panthorium_notifications(user_id,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_owner_unread ON panthorium_notifications(user_id,read_at,deleted_at);`);
    this.ready = true;
  }
  assertReady() { if (!this.ready) throw failure('notifications_storage_unavailable', 503); }
  async getSettings(userId, defaults) {
    this.assertReady();
    if (!this.pool) return mergeSettings(defaults, this.preferences.get(userId) || {});
    const result = await this.pool.query('SELECT settings FROM panthorium_notification_settings WHERE user_id=$1', [userId]);
    return mergeSettings(defaults, result.rows[0]?.settings || {});
  }
  async patchSettings(userId, patch, defaults) {
    this.assertReady();
    if (!this.pool) {
      // No await between the read and write: two patches cannot lose each other.
      const settings = mergeSettings(mergeSettings(defaults, this.preferences.get(userId) || {}), patch);
      this.preferences.set(userId, clone(settings)); return settings;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO panthorium_notification_settings(user_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING', [userId, JSON.stringify(defaults)]);
      const existing = await client.query('SELECT settings FROM panthorium_notification_settings WHERE user_id=$1 FOR UPDATE', [userId]);
      const settings = mergeSettings(mergeSettings(defaults, existing.rows[0].settings), patch);
      await client.query('UPDATE panthorium_notification_settings SET settings=$2::jsonb,updated_at=$3 WHERE user_id=$1', [userId, JSON.stringify(settings), new Date(this.now()).toISOString()]);
      await client.query('COMMIT'); return settings;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async put(notification) {
    this.assertReady();
    if (!this.pool) {
      if (!this.items.has(notification.id)) this.items.set(notification.id, clone(notification));
      return clone(this.items.get(notification.id));
    }
    const n = notification;
    await this.pool.query(`INSERT INTO panthorium_notifications(${SELECT}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL)
      ON CONFLICT(id) DO NOTHING`, [n.id,n.userId,n.category,n.type,n.title,n.body,n.sourceId,n.severity,n.sensitive,n.createdAt]);
    return this.get(n.userId, n.id, true);
  }
  async get(userId, id, includeDeleted = false) {
    this.assertReady();
    if (!this.pool) {
      const n = this.items.get(id); return n?.userId === userId && (includeDeleted || !n.deletedAt) ? clone(n) : null;
    }
    const result = await this.pool.query(`SELECT ${SELECT} FROM panthorium_notifications WHERE user_id=$1 AND id=$2${includeDeleted ? '' : ' AND deleted_at IS NULL'}`, [userId,id]);
    return item(result.rows[0]);
  }
  async list(userId, { limit, cursor, unreadOnly = false, cutoff, onlySocial = false, excludeSocial = false }) {
    this.assertReady();
    if (!this.pool) return [...this.items.values()].filter(n => n.userId === userId && !n.deletedAt && n.createdAt >= cutoff && (!unreadOnly || !n.readAt) && (!onlySocial || socialActivity(n.type)) && (!excludeSocial || !socialActivity(n.type)) &&
      (!cursor || n.createdAt < cursor.createdAt || n.createdAt === cursor.createdAt && n.id < cursor.id))
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0,limit).map(clone);
    const values = [userId,cutoff], where = ['user_id=$1', 'deleted_at IS NULL', 'created_at >= $2'];
    if (unreadOnly) where.push('read_at IS NULL');
    if (onlySocial) where.push(SOCIAL_ACTIVITY_SQL);
    if (excludeSocial) where.push('NOT '+SOCIAL_ACTIVITY_SQL);
    if (cursor) { values.push(cursor.createdAt,cursor.id); where.push('(created_at < $3 OR (created_at = $3 AND id < $4))'); }
    values.push(limit);
    const result = await this.pool.query(`SELECT ${SELECT} FROM panthorium_notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`, values);
    return result.rows.map(item);
  }
  async unreadCount(userId, cutoff, excludeSocial = false) {
    this.assertReady();
    if (!this.pool) return [...this.items.values()].filter(n => n.userId === userId && !n.deletedAt && !n.readAt && n.createdAt >= cutoff && (!excludeSocial || !socialActivity(n.type))).length;
    const result = await this.pool.query(`SELECT COUNT(*) AS count FROM panthorium_notifications WHERE user_id=$1 AND deleted_at IS NULL AND read_at IS NULL AND created_at >= $2${excludeSocial ? ' AND NOT '+SOCIAL_ACTIVITY_SQL : ''}`, [userId,cutoff]);
    return Number(result.rows[0].count);
  }
  async markRead(userId, ids, all = false) {
    this.assertReady();
    const at = new Date(this.now()).toISOString();
    if (!this.pool) {
      let changed = 0;
      for (const n of this.items.values()) if (n.userId === userId && !n.deletedAt && !n.readAt && (all || ids.includes(n.id))) { n.readAt = at; changed++; }
      return changed;
    }
    if (!all && !ids.length) return 0;
    const result = await this.pool.query(`UPDATE panthorium_notifications SET read_at=$2 WHERE user_id=$1 AND deleted_at IS NULL AND read_at IS NULL${all ? '' : ' AND id IN ('+ids.map((_,index)=>'$'+(index+3)).join(',')+')'}`, all ? [userId,at] : [userId,at,...ids]);
    return result.rowCount;
  }
  async remove(userId, ids) {
    this.assertReady();
    const at = new Date(this.now()).toISOString();
    if (!this.pool) {
      let changed = 0;
      for (const n of this.items.values()) if (n.userId === userId && !n.deletedAt && ids.includes(n.id)) { n.deletedAt = at; changed++; }
      return changed;
    }
    // Keep a bounded tombstone so replay/reconciliation cannot resurrect dismissed activity.
    if (!ids.length) return 0;
    const result = await this.pool.query('UPDATE panthorium_notifications SET deleted_at=$2 WHERE user_id=$1 AND deleted_at IS NULL AND id IN ('+ids.map((_,index)=>'$'+(index+3)).join(',')+')', [userId,at,...ids]);
    return result.rowCount;
  }
  async prune(userId, cutoff) {
    this.assertReady();
    if (this.pool) { await this.pool.query('DELETE FROM panthorium_notifications WHERE user_id=$1 AND created_at < $2', [userId,cutoff]); return; }
    for (const [id,n] of this.items) if (n.userId === userId && n.createdAt < cutoff) this.items.delete(id);
  }
}
module.exports = { NotificationRepository, mergeSettings, failure };
