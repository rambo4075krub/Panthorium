'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const BATCH_SIZE = 128;

// The notebook includes this journal in its existing SQLite storage backups.
// Several workers may replay the same rows. PostgreSQL deduplicates by event ID.
class HttpAuditQueue {
  constructor(file, persist) {
    fs.closeSync(fs.openSync(file, 'a', 0o600));
    this.db = new DatabaseSync(file, { timeout: 1000 });
    this.db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS panthorium_http_audit_pending (
        event_id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, entry TEXT NOT NULL
      )`);
    this.insert = this.db.prepare('INSERT INTO panthorium_http_audit_pending VALUES (?, ?, ?)');
    this.next = this.db.prepare('SELECT event_id, entry FROM panthorium_http_audit_pending ORDER BY rowid LIMIT ?');
    this.ack = this.db.prepare('DELETE FROM panthorium_http_audit_pending WHERE event_id IN (SELECT value FROM json_each(?))');
    this.backlog = this.db.prepare('SELECT COUNT(*) AS pending, MIN(recorded_at) AS oldest FROM panthorium_http_audit_pending');
    this.persist = persist;
    this.retryMs = 250;
    this.schedule(0);
  }

  append(entry) {
    this.insert.run(entry.event_id, entry.time, JSON.stringify(entry));
    this.schedule(50);
  }

  schedule(ms) {
    if (this.stopped || this.timer) return;
    if (this.running) { this.reschedule = true; return; }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.drain().then(() => {
        this.retryMs = 250;
        this.running = null;
        if (this.reschedule) {
          this.reschedule = false;
          this.schedule(50);
        }
      }, error => {
        console.error('[Audit] HTTP history pending retry:', error.code || error.name);
        this.running = null;
        this.schedule(this.retryMs);
        this.retryMs = Math.min(30000, this.retryMs * 2);
      });
    }, ms);
    this.timer.unref();
  }

  async drain() {
    while (!this.stopped) {
      const batch = this.next.all(BATCH_SIZE);
      if (!batch.length) return;
      await this.persist(batch.map(row => JSON.parse(row.entry)));
      // A crash before this statement replays the committed batch safely.
      this.ack.run(JSON.stringify(batch.map(row => row.event_id)));
    }
  }

  stats() { return this.backlog.get(); }

  async close() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
    this.db.close();
  }
}

module.exports = { HttpAuditQueue };
