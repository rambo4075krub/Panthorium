const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');

const COLUMNS = `reminder_id AS "reminderId", user_id AS "userId", kind, title, details,
  due_at AS "dueAt", scheduled_at AS "scheduledAt", time_zone AS "timeZone", status,
  attempts, last_error AS "lastError", sent_at AS "sentAt", recurrence,
  occurrence, account_version AS "accountVersion", provider_message_id AS "providerMessageId", created_at AS "createdAt", updated_at AS "updatedAt"`;
const iso = value => value instanceof Date ? value.toISOString() : value || null;

// This table is also the email outbox: a claimed occurrence is never blindly retried.
class ReminderRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', requireDatabase = false } = {}) {
    this.requireDatabase = requireDatabase;
    this.pool = databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.memory = new Map();
  }

  ensureStorage() { if (this.requireDatabase && !this.pool) throw new Error('scheduler_database_required'); }

  async init() { this.ensureStorage();
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_reminders (
      reminder_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', due_at TIMESTAMPTZ NOT NULL,
      time_zone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE panthorium_reminders ADD COLUMN IF NOT EXISTS recurrence JSONB;
    ALTER TABLE panthorium_reminders ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
    ALTER TABLE panthorium_reminders ADD COLUMN IF NOT EXISTS occurrence INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE panthorium_reminders ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
    ALTER TABLE panthorium_reminders ADD COLUMN IF NOT EXISTS account_version INTEGER NOT NULL DEFAULT 0;
    UPDATE panthorium_reminders SET scheduled_at=due_at WHERE scheduled_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_panthorium_reminders_due ON panthorium_reminders(status,due_at);
    CREATE INDEX IF NOT EXISTS idx_panthorium_reminders_user_time ON panthorium_reminders(user_id,due_at DESC);`);
  }

  normalize(row = {}) {
    return {
      reminderId: row.reminderId || randomUUID(), userId: String(row.userId || ''),
      kind: String(row.kind || 'appointment'), title: String(row.title || '').slice(0, 240),
      details: String(row.details || '').slice(0, 1000), dueAt: iso(row.dueAt) || '',
      scheduledAt: iso(row.scheduledAt || row.dueAt) || '', timeZone: String(row.timeZone || 'UTC'),
      status: String(row.status || 'scheduled'), attempts: Number(row.attempts) || 0,
      lastError: row.lastError || null, sentAt: iso(row.sentAt), recurrence: row.recurrence || null,
      occurrence: Number(row.occurrence) || 1, accountVersion: Math.max(0,Number(row.accountVersion) || 0), providerMessageId: row.providerMessageId || null,
      createdAt: iso(row.createdAt) || new Date().toISOString(), updatedAt: iso(row.updatedAt) || new Date().toISOString()
    };
  }
  mapRow(row) { return row ? this.normalize(row) : null; }

  async create(input) { this.ensureStorage();
    const item = this.normalize(input);
    if (!this.pool) { this.memory.set(item.reminderId, item); return { ...item }; }
    const r = await this.pool.query(`INSERT INTO panthorium_reminders
      (reminder_id,user_id,kind,title,details,due_at,scheduled_at,time_zone,status,recurrence,occurrence,created_at,updated_at,account_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14) RETURNING ${COLUMNS}`,
    [item.reminderId,item.userId,item.kind,item.title,item.details,item.dueAt,item.scheduledAt,item.timeZone,item.status,JSON.stringify(item.recurrence),item.occurrence,item.createdAt,item.updatedAt,item.accountVersion]);
    return this.mapRow(r.rows[0]);
  }

  async list(userId, limit = 50) { this.ensureStorage();
    const safe = Math.min(Math.max(Math.floor(Number(limit) || 50), 1), 100);
    if (!this.pool) return [...this.memory.values()].filter(x => x.userId === userId).sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt)).slice(0,safe).map(x => ({ ...x }));
    const r = await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_reminders WHERE user_id=$1 ORDER BY due_at ASC LIMIT $2`, [userId,safe]);
    return r.rows.map(row => this.mapRow(row));
  }

  async cancel(userId, reminderId) { this.ensureStorage();
    if (!this.pool) {
      const item = this.memory.get(String(reminderId || ''));
      if (!item || item.userId !== userId || !['scheduled','delivery_unknown','failed'].includes(item.status)) return null;
      const next = { ...item, status: 'cancelled', updatedAt: new Date().toISOString() };
      this.memory.set(next.reminderId, next); return { ...next };
    }
    const r = await this.pool.query(`UPDATE panthorium_reminders SET status='cancelled',updated_at=NOW()
      WHERE reminder_id=$1 AND user_id=$2 AND status IN ('scheduled','delivery_unknown','failed') RETURNING ${COLUMNS}`, [reminderId,userId]);
    return this.mapRow(r.rows[0]);
  }

  async snooze(userId, reminderId, dueAt) { this.ensureStorage();
    if (!this.pool) {
      const item = this.memory.get(String(reminderId || ''));
      if (!item || item.userId !== userId || item.status !== 'scheduled') return null;
      const next = { ...item, dueAt, updatedAt: new Date().toISOString() };
      this.memory.set(next.reminderId, next); return { ...next };
    }
    const r = await this.pool.query(`UPDATE panthorium_reminders SET due_at=$3,updated_at=NOW()
      WHERE reminder_id=$1 AND user_id=$2 AND status='scheduled' RETURNING ${COLUMNS}`, [reminderId,userId,dueAt]);
    return this.mapRow(r.rows[0]);
  }

  async claimDue(limit = 10) { this.ensureStorage();
    const safe = Math.min(Math.max(Math.floor(Number(limit) || 10), 1), 20);
    if (!this.pool) {
      const due = [...this.memory.values()].filter(x => x.status === 'scheduled' && Date.parse(x.dueAt) <= Date.now()).sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt)).slice(0,safe);
      return due.map(item => {
        const next = { ...item, status: 'sending', attempts: item.attempts + 1, updatedAt: new Date().toISOString() };
        this.memory.set(next.reminderId, next); return { ...next };
      });
    }
    const r = await this.pool.query(`WITH due AS (
      SELECT reminder_id FROM panthorium_reminders WHERE status='scheduled' AND due_at <= NOW()
      ORDER BY due_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE panthorium_reminders SET status='sending',attempts=attempts+1,updated_at=NOW()
      WHERE reminder_id IN (SELECT reminder_id FROM due) RETURNING ${COLUMNS}`, [safe]);
    return r.rows.map(row => this.mapRow(row));
  }

  async finish(reminderId, { status = 'sent', lastError = null, nextDueAt = null, nextOccurrence = null, providerMessageId = null, occurrence } = {}) { this.ensureStorage();
    if (!['sent','failed','delivery_unknown'].includes(status)) throw new Error('invalid_delivery_status');
    if (nextDueAt && status !== 'sent') throw new Error('only_sent_occurrences_can_recur');
    if (!this.pool) {
      const current = this.memory.get(String(reminderId || ''));
      if (!current || current.status !== 'sending' || (occurrence != null && current.occurrence !== occurrence)) return null;
      const next = { ...current, status: nextDueAt ? 'scheduled' : status, lastError,
        dueAt: nextDueAt || current.dueAt, scheduledAt: nextDueAt || current.scheduledAt,
        occurrence: nextOccurrence || current.occurrence, providerMessageId,
        sentAt: status === 'sent' ? new Date().toISOString() : current.sentAt, updatedAt: new Date().toISOString() };
      this.memory.set(next.reminderId, next); return { ...next };
    }
    const r = await this.pool.query(`UPDATE panthorium_reminders SET status=CASE WHEN $3::timestamptz IS NOT NULL THEN 'scheduled' ELSE $2 END,
      due_at=COALESCE($3::timestamptz,due_at),scheduled_at=COALESCE($3::timestamptz,scheduled_at),
      occurrence=COALESCE($4,occurrence),last_error=$5,provider_message_id=$6,
      sent_at=CASE WHEN $2='sent' THEN NOW() ELSE sent_at END,updated_at=NOW()
      WHERE reminder_id=$1 AND status='sending' AND ($7::integer IS NULL OR occurrence=$7) RETURNING ${COLUMNS}`,
    [reminderId,status,nextDueAt,nextOccurrence,lastError,providerMessageId,occurrence ?? null]);
    return this.mapRow(r.rows[0]);
  }

  async recoverStale(staleMs = 15 * 60 * 1000) { this.ensureStorage();
    const safe = Math.max(60000, Number(staleMs) || 900000);
    if (!this.pool) {
      let count = 0;
      for (const [id,item] of this.memory) if (item.status === 'sending' && Date.parse(item.updatedAt) < Date.now() - safe) {
        this.memory.set(id, { ...item, status: 'delivery_unknown', lastError: 'delivery_interrupted_manual_review', updatedAt: new Date().toISOString() }); count++;
      }
      return count;
    }
    const r = await this.pool.query(`UPDATE panthorium_reminders SET status='delivery_unknown',last_error='delivery_interrupted_manual_review',updated_at=NOW()
      WHERE status='sending' AND updated_at < NOW() - ($1 * INTERVAL '1 millisecond')`, [safe]);
    return r.rowCount || 0;
  }
}
module.exports = { ReminderRepository };
