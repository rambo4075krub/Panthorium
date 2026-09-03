const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

class AuditService {
  constructor(options) {
    if (typeof options === "string") options = { file: options };
    options = options || {};
    this.file = options.file;
    this.databaseUrl = options.databaseUrl || "";
    this.databaseSslMode = options.databaseSslMode || "disable";
    this.pool = null;
    if (this.file) fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  async init() {
    if (!this.databaseUrl) return;
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: this.databaseSslMode === "disable" ? false : { rejectUnauthorized: false }
    });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_audit_events (
        id BIGSERIAL PRIMARY KEY,
        time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        event TEXT NOT NULL,
        request_id TEXT,
        actor_user_id TEXT,
        target_user_id TEXT,
        ip TEXT,
        method TEXT,
        path TEXT,
        status INTEGER,
        duration_ms INTEGER,
        user_agent TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_audit_time ON panthorium_audit_events(time DESC);
      CREATE INDEX IF NOT EXISTS idx_panthorium_audit_event ON panthorium_audit_events(event);
      CREATE INDEX IF NOT EXISTS idx_panthorium_audit_actor ON panthorium_audit_events(actor_user_id);
    `);
  }

  record(event, fields = {}) {
    const entry = { time: new Date().toISOString(), event, ...fields };

    if (this.file) {
      fs.appendFile(this.file, JSON.stringify(entry) + "\n", () => {});
    }

    if (this.pool) {
      const known = new Set([
        "requestId", "actorUserId", "userId", "targetUserId", "ip", "method", "path",
        "status", "durationMs", "userAgent"
      ]);
      const metadata = {};
      for (const [key, value] of Object.entries(fields)) {
        if (!known.has(key)) metadata[key] = value;
      }
      this.pool.query(
        `INSERT INTO panthorium_audit_events
          (time, event, request_id, actor_user_id, target_user_id, ip, method, path, status, duration_ms, user_agent, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          entry.time,
          event,
          fields.requestId || null,
          fields.actorUserId || fields.userId || null,
          fields.targetUserId || null,
          fields.ip || null,
          fields.method || null,
          fields.path || null,
          Number.isFinite(Number(fields.status)) ? Number(fields.status) : null,
          Number.isFinite(Number(fields.durationMs)) ? Number(fields.durationMs) : null,
          fields.userAgent || null,
          JSON.stringify(metadata)
        ]
      ).catch((error) => console.error("[Audit] PostgreSQL write failed:", error.message));
    }
  }

  normalizeFilters(filters = {}) {
    return {
      limit: Math.max(1, Math.min(Number(filters.limit) || 100, 500)),
      event: String(filters.event || "").trim(),
      q: String(filters.q || "").trim(),
      userId: String(filters.userId || "").trim(),
      status: filters.status === undefined || filters.status === "" ? null : Number(filters.status),
      from: filters.from ? new Date(filters.from) : null,
      to: filters.to ? new Date(filters.to) : null
    };
  }

  async listRecent(filters = {}) {
    if (typeof filters !== "object") filters = { limit: filters };
    const f = this.normalizeFilters(filters);

    if (this.pool) {
      const where = [];
      const values = [];
      const add = (sql, value) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
      if (f.event) add("event = ?", f.event);
      if (f.userId) add("actor_user_id = ?", f.userId);
      if (Number.isFinite(f.status)) add("status = ?", f.status);
      if (f.from && !Number.isNaN(f.from.getTime())) add("time >= ?", f.from.toISOString());
      if (f.to && !Number.isNaN(f.to.getTime())) add("time <= ?", f.to.toISOString());
      if (f.q) {
        values.push(`%${f.q}%`);
        const p = `$${values.length}`;
        where.push(`(event ILIKE ${p} OR path ILIKE ${p} OR actor_user_id ILIKE ${p} OR metadata::text ILIKE ${p})`);
      }
      values.push(f.limit);
      const sql = `SELECT id, time, event, request_id, actor_user_id, target_user_id, ip, method, path, status, duration_ms, user_agent, metadata
                   FROM panthorium_audit_events
                   ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                   ORDER BY time DESC LIMIT $${values.length}`;
      const result = await this.pool.query(sql, values);
      return result.rows.map((row) => ({
        id: row.id,
        time: row.time,
        event: row.event,
        requestId: row.request_id,
        actorUserId: row.actor_user_id,
        targetUserId: row.target_user_id,
        ip: row.ip,
        method: row.method,
        path: row.path,
        status: row.status,
        durationMs: row.duration_ms,
        userAgent: row.user_agent,
        ...(row.metadata || {})
      }));
    }

    if (!this.file || !fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean);
    let entries = lines.reverse().map((line) => {
      try { return JSON.parse(line); } catch (_) { return { time: null, event: "audit.parse_error" }; }
    });
    if (f.event) entries = entries.filter((e) => e.event === f.event);
    if (f.userId) entries = entries.filter((e) => (e.actorUserId || e.userId) === f.userId);
    if (Number.isFinite(f.status)) entries = entries.filter((e) => Number(e.status) === f.status);
    if (f.from && !Number.isNaN(f.from.getTime())) entries = entries.filter((e) => Date.parse(e.time) >= f.from.getTime());
    if (f.to && !Number.isNaN(f.to.getTime())) entries = entries.filter((e) => Date.parse(e.time) <= f.to.getTime());
    if (f.q) {
      const q = f.q.toLowerCase();
      entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
    }
    return entries.slice(0, f.limit);
  }

  async summary() {
    if (this.pool) {
      const result = await this.pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE event='auth.login_success')::int AS login_success,
          COUNT(*) FILTER (WHERE event='auth.login_failed')::int AS login_failed,
          COUNT(*) FILTER (WHERE event='auth.refresh')::int AS refresh,
          COUNT(*) FILTER (WHERE event='auth.guest_session')::int AS guest_sessions,
          COUNT(*) FILTER (WHERE event LIKE 'auth.user_%')::int AS user_changes
        FROM panthorium_audit_events
        WHERE time >= NOW() - INTERVAL '24 hours'
      `);
      const r = result.rows[0] || {};
      return {
        total24h: r.total || 0,
        loginSuccess24h: r.login_success || 0,
        loginFailed24h: r.login_failed || 0,
        refresh24h: r.refresh || 0,
        guestSessions24h: r.guest_sessions || 0,
        userChanges24h: r.user_changes || 0
      };
    }

    const entries = await this.listRecent({ limit: 500 });
    const now = Date.now();
    const last24h = entries.filter((entry) => {
      const time = Date.parse(entry.time);
      return Number.isFinite(time) && now - time <= 86400000;
    });
    const count = (event) => last24h.filter((entry) => entry.event === event).length;
    return {
      total24h: last24h.length,
      loginSuccess24h: count("auth.login_success"),
      loginFailed24h: count("auth.login_failed"),
      refresh24h: count("auth.refresh"),
      guestSessions24h: count("auth.guest_session"),
      userChanges24h: last24h.filter((entry) => String(entry.event || "").startsWith("auth.user_")).length
    };
  }
}

module.exports = { AuditService };
