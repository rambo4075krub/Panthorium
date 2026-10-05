const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');

class ReminderRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', requireDatabase = false } = {}) {
    if (requireDatabase && !databaseUrl) throw new Error('DATABASE_URL is required for cloud reminders');
    this.pool = databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.memory = new Map();
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(\`
      CREATE TABLE IF NOT EXISTS panthorium_reminders (
        reminder_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        due_at TIMESTAMPTZ NOT NULL,
        time_zone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_reminders_due ON panthorium_reminders(status, due_at);
      CREATE INDEX IF NOT EXISTS idx_panthorium_reminders_user_time ON panthorium_reminders(user_id, due_at DESC);
    \`);
  }

  normalize(row = {}) {
    return {
      reminderId: row.reminderId || randomUUID(), userId: String(row.userId || ''),
      kind: String(row.kind || 'appointment'), title: String(row.title || '').slice(0, 240),
      details: String(row.details || '').slice(0, 1000),
      dueAt: row.dueAt instanceof Date ? row.dueAt.toISOString() : String(row.dueAt || ''),
      timeZone: String(row.timeZone || 'UTC'), status: String(row.status || 'scheduled'),
      attempts: Number(row.attempts) || 0, lastError: row.lastError || null,
      sentAt: row.sentAt || null, createdAt: row.createdAt || new Date().toISOString(),
      updatedAt: row.updatedAt || new Date().toISOString()
    };
  }

  mapRow(row) {
    if (!row) return null;
    return this.normalize({
      reminderId: row.reminderId, userId: row.userId, kind: row.kind, title: row.title,
      details: row.details, dueAt: row.dueAt, timeZone: row.timeZone, status: row.status,
      attempts: row.attempts, lastError: row.lastError, sentAt: row.sentAt,
      createdAt: row.createdAt, updatedAt: row.updatedAt
    });
  }

  async create(input) {
    const item = this.normalize(input);
    if (!this.pool) { this.memory.set(item.reminderId, item); return item; }
    const r = await this.pool.query(\`INSERT INTO panthorium_reminders(reminder_id,user_id,kind,title,details,due_at,time_zone,status,attempts,last_error,sent_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING reminder_id AS "reminderId",user_id AS "userId",kind,title,details,due_at AS "dueAt",time_zone AS "timeZone",status,attempts,last_error AS "lastError",sent_at AS "sentAt",created_at AS "createdAt",updated_at AS "updatedAt"\`,
      [item.reminderId,item.userId,item.kind,item.title,item.details,item.dueAt,item.timeZone,item.status,item.attempts,item.lastError,item.sentAt,item.createdAt,item.updatedAt]);
    return this.mapRow(r.rows[0]);
  }

  async list(userId, limit = 50) {
    const safe = Math.min(Math.max(Number(limit) || 50, 1), 100);
    if (!this.pool) return [...this.memory.values()].filter(x => x.userId === userId).sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt)).slice(0,safe);
    const r = await this.pool.query(\`SELECT reminder_id AS "reminderId",user_id AS "userId",kind,title,details,due_at AS "dueAt",time_zone AS "timeZone",status,attempts,last_error AS "lastError",sent_at AS "sentAt",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM panthorium_reminders WHERE user_id=$1 ORDER BY due_at ASC LIMIT $2\`, [userId,safe]);
    return r.rows.map(row => this.mapRow(row));
  }

  async cancel(userId, reminderId) {
    if (!this.pool) {
      const item = this.memory.get(String(reminderId || ''));
      if (!item || item.userId !== userId || item.status !== 'scheduled') return null;
      const next = { ...item, status: 'cancelled', updatedAt: new Date().toISOString() };
      this.memory.set(next.reminderId, next);
      return next;
    }
    const r = await this.pool.query(\`UPDATE panthorium_reminders SET status='cancelled',updated_at=NOW()
      WHERE reminder_id=$1 AND user_id=$2 AND status='scheduled'
      RETURNING reminder_id AS "reminderId",user_id AS "userId",kind,title,details,due_at AS "dueAt",time_zone AS "timeZone",status,attempts,last_error AS "lastError",sent_at AS "sentAt",created_at AS "createdAt",updated_at AS "updatedAt"\`, [reminderId,userId]);
    return this.mapRow(r.rows[0]);
  }

  async claimDue(limit = 10) {
    const safe = Math.min(Math.max(Number(limit) || 10, 1), 50);
    if (!this.pool) {
      const due = [...this.memory.values()].filter(x => x.status === 'scheduled' && Date.parse(x.dueAt) <= Date.now()).sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt)).slice(0,safe);
      return due.map(item => {
        const next = { ...item, status: 'sending', attempts: item.attempts + 1, updatedAt: new Date().toISOString() };
        this.memory.set(next.reminderId, next);
        return next;
      });
    }
    const r = await this.pool.query(\`WITH due AS (
        SELECT reminder_id FROM panthorium_reminders WHERE status='scheduled' AND due_at <= NOW()
        ORDER BY due_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
      )
      UPDATE panthorium_reminders p SET status='sending',attempts=p.attempts+1,updated_at=NOW()
      FROM due WHERE p.reminder_id=due.reminder_id
      RETURNING p.reminder_id AS "reminderId",p.user_id AS "userId",p.kind,p.title,p.details,p.due_at AS "dueAt",p.time_zone AS "timeZone",p.status,p.attempts,p.last_error AS "lastError",p.sent_at AS "sentAt",p.created_at AS "createdAt",p.updated_at AS "updatedAt"\`, [safe]);
    return r.rows.map(row => this.mapRow(row));
  }

  async finish(reminderId, { status = 'sent', lastError = null, retryAt = null } = {}) {
    if (!this.pool) {
      const current = this.memory.get(String(reminderId || ''));
      if (!current) return null;
      const next = { ...current, status: retryAt ? 'scheduled' : status, dueAt: retryAt || current.dueAt, lastError, sentAt: status === 'sent' && !retryAt ? new Date().toISOString() : current.sentAt, updatedAt: new Date().toISOString() };
      this.memory.set(next.reminderId, next);
      return next;
    }
    const r = await this.pool.query(\`UPDATE panthorium_reminders SET status=CASE WHEN $3::timestamptz IS NOT NULL THEN 'scheduled' ELSE $2 END,
      due_at=COALESCE($3::timestamptz,due_at),last_error=$4,
      sent_at=CASE WHEN $2='sent' AND $3::timestamptz IS NULL THEN NOW() ELSE sent_at END,updated_at=NOW()
      WHERE reminder_id=$1 AND status='sending'
      RETURNING reminder_id AS "reminderId",user_id AS "userId",kind,title,details,due_at AS "dueAt",time_zone AS "timeZone",status,attempts,last_error AS "lastError",sent_at AS "sentAt",created_at AS "createdAt",updated_at AS "updatedAt"\`, [reminderId,status,retryAt,lastError]);
    return this.mapRow(r.rows[0]);
  }
}

module.exports = { ReminderRepository };