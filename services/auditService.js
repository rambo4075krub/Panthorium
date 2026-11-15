const { canonicalIp } = require('./securityIp');
const { migrateSecurityIps } = require('./securityIpMigration');
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { getDatabasePool } = require('./databasePool');

class AuditService {
  constructor(options) {
    if (typeof options === "string") options = { file: options };
    options = options || {};
    this.file = options.file;
    this.databaseUrl = options.databaseUrl || "";
    this.databaseSslMode = options.databaseSslMode || "disable";
    this.pool = null;
    this.alertAcks = new Map();
    this.listeners = new Set();
    if (this.file) fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  async init() {
    if (!this.databaseUrl) return;
    this.pool = getDatabasePool({ connectionString: this.databaseUrl, ssl: this.databaseSslMode === "disable" ? false : { rejectUnauthorized: false } });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_audit_events (
        id BIGSERIAL PRIMARY KEY, time TIMESTAMPTZ NOT NULL DEFAULT NOW(), event TEXT NOT NULL,
        request_id TEXT, actor_user_id TEXT, target_user_id TEXT, ip TEXT, method TEXT, path TEXT,
        status INTEGER, duration_ms INTEGER, user_agent TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_audit_time ON panthorium_audit_events(time DESC);
      CREATE INDEX IF NOT EXISTS idx_panthorium_audit_event ON panthorium_audit_events(event);
      CREATE INDEX IF NOT EXISTS idx_panthorium_audit_actor ON panthorium_audit_events(actor_user_id);
      CREATE INDEX IF NOT EXISTS idx_panthorium_audit_ip_time ON panthorium_audit_events(ip,time DESC);

      CREATE TABLE IF NOT EXISTS panthorium_security_alert_acknowledgements (
        alert_id TEXT PRIMARY KEY,
        acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acknowledged_by TEXT,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_alert_ack_expiry ON panthorium_security_alert_acknowledgements(expires_at);
    `);
    await migrateSecurityIps(this.pool, "audit");
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('audit_listener_required');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(event, fields = {}) {
    fields = { ...fields, ...(fields.ip ? { ip: canonicalIp(fields.ip) || null } : {}) };
    const writes = [];
    const entry = { time: new Date().toISOString(), event, ...fields };
    if (this.file) writes.push(fs.promises.appendFile(this.file, JSON.stringify(entry) + "\n").catch(error => console.error("[Audit] File write failed:", error.message)));
    if (this.pool) {
      const known = new Set(["requestId", "actorUserId", "userId", "targetUserId", "ip", "method", "path", "status", "durationMs", "userAgent"]);
      const metadata = {};
      for (const [key, value] of Object.entries(fields)) if (!known.has(key)) metadata[key] = value;
      writes.push(this.pool.query(
        `INSERT INTO panthorium_audit_events
         (time,event,request_id,actor_user_id,target_user_id,ip,method,path,status,duration_ms,user_agent,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [entry.time, event, fields.requestId || null, fields.actorUserId || fields.userId || null, fields.targetUserId || null,
          fields.ip || null, fields.method || null, fields.path || null,
          Number.isFinite(Number(fields.status)) ? Number(fields.status) : null,
          Number.isFinite(Number(fields.durationMs)) ? Number(fields.durationMs) : null,
          fields.userAgent || null, JSON.stringify(metadata)]
      ).catch((error) => console.error("[Audit] PostgreSQL write failed:", error.message)));
    }
    for (const listener of this.listeners) {
      try { Promise.resolve(listener({ ...entry })).catch(() => {}); }
      catch { /* Observers cannot break the audited operation. */ }
    }
    return Promise.all(writes);
  }

  normalizeFilters(filters = {}) {
    return {
      limit: Math.max(1, Math.min(Number(filters.limit) || 100, 500)), event: String(filters.event || "").trim(),
      q: String(filters.q || "").trim(), userId: String(filters.userId || "").trim(),
      status: filters.status === undefined || filters.status === "" ? null : Number(filters.status),
      from: filters.from ? new Date(filters.from) : null, to: filters.to ? new Date(filters.to) : null
    };
  }

  async listRecent(filters = {}) {
    if (typeof filters !== "object") filters = { limit: filters };
    const f = this.normalizeFilters(filters);
    if (this.pool) {
      const where = [], values = [];
      const add = (sql, value) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
      if (f.event) add("event = ?", f.event);
      if (f.userId) add("actor_user_id = ?", f.userId);
      if (Number.isFinite(f.status)) add("status = ?", f.status);
      if (f.from && !Number.isNaN(f.from.getTime())) add("time >= ?", f.from.toISOString());
      if (f.to && !Number.isNaN(f.to.getTime())) add("time <= ?", f.to.toISOString());
      if (f.q) { values.push(`%${f.q}%`); const p = `$${values.length}`; where.push(`(event ILIKE ${p} OR path ILIKE ${p} OR actor_user_id ILIKE ${p} OR ip ILIKE ${p} OR metadata::text ILIKE ${p})`); }
      values.push(f.limit);
      const result = await this.pool.query(`SELECT id,time,event,request_id,actor_user_id,target_user_id,ip,method,path,status,duration_ms,user_agent,metadata FROM panthorium_audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY time DESC LIMIT $${values.length}`, values);
      return result.rows.map((row) => ({ id: row.id, time: row.time, event: row.event, requestId: row.request_id, actorUserId: row.actor_user_id, targetUserId: row.target_user_id, ip: row.ip, method: row.method, path: row.path, status: row.status, durationMs: row.duration_ms, userAgent: row.user_agent, ...(row.metadata || {}) }));
    }
    if (!this.file || !fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean);
    let entries = lines.reverse().map((line) => { try { return JSON.parse(line); } catch (_) { return { time: null, event: "audit.parse_error" }; } });
    if (f.event) entries = entries.filter((e) => e.event === f.event);
    if (f.userId) entries = entries.filter((e) => (e.actorUserId || e.userId) === f.userId);
    if (Number.isFinite(f.status)) entries = entries.filter((e) => Number(e.status) === f.status);
    if (f.from && !Number.isNaN(f.from.getTime())) entries = entries.filter((e) => Date.parse(e.time) >= f.from.getTime());
    if (f.to && !Number.isNaN(f.to.getTime())) entries = entries.filter((e) => Date.parse(e.time) <= f.to.getTime());
    if (f.q) { const q = f.q.toLowerCase(); entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q)); }
    return entries.slice(0, f.limit);
  }

  fileWindow(since) {
    if (!this.file || !fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split(/\r?\n/).flatMap(line => {
      try { const e = JSON.parse(line); return new Date(e.time).getTime() >= since ? [{...e,ip:canonicalIp(e.ip) || 'unknown'}] : []; }
      catch { return []; }
    });
  }

  async summary() {
    let counts;
    if (this.pool) counts = (await this.pool.query("SELECT event,COUNT(*)::int AS count FROM panthorium_audit_events WHERE time>=NOW()-INTERVAL '24 hours' GROUP BY event")).rows;
    else { const map = new Map(); for (const e of this.fileWindow(Date.now()-86400000)) map.set(e.event,(map.get(e.event)||0)+1); counts = [...map].map(([event,count])=>({event,count})); }
    const count = event => counts.find(row=>row.event===event)?.count || 0;
    return {total24h:counts.reduce((n,r)=>n+r.count,0),loginSuccess24h:count('auth.login_success'),loginFailed24h:count('auth.login_failed'),refresh24h:count('auth.refresh'),guestSessions24h:count('auth.guest_session'),userChanges24h:counts.filter(r=>r.event.startsWith('auth.user_')).reduce((n,r)=>n+r.count,0)};
  }

  async securityCounts() {
    let rows;
    if (this.pool) rows = (await this.pool.query(`SELECT ip,
      COUNT(*) FILTER(WHERE event='auth.login_failed' AND time>=NOW()-INTERVAL '15 minutes')::int AS login,
      COUNT(*) FILTER(WHERE event='http.request' AND status IN (401,403) AND time>=NOW()-INTERVAL '10 minutes')::int AS denied,
      COUNT(*) FILTER(WHERE event='http.request' AND status=429 AND time>=NOW()-INTERVAL '10 minutes')::int AS rate,
      COUNT(*) FILTER(WHERE event LIKE '%session%' AND event LIKE '%revoked%')::int AS revokes
      FROM panthorium_audit_events WHERE time>=NOW()-INTERVAL '1 hour'
      AND (event='auth.login_failed' OR (event='http.request' AND status IN (401,403,429)) OR (event LIKE '%session%' AND event LIKE '%revoked%')) GROUP BY ip`)).rows;
    else {
      const now = Date.now();
      rows = this.fileWindow(now-3600000).map(e=>({ip:e.ip,
        login:Number(e.event==='auth.login_failed' && new Date(e.time).getTime()>=now-900000),
        denied:Number(e.event==='http.request' && [401,403].includes(Number(e.status)) && new Date(e.time).getTime()>=now-600000),
        rate:Number(e.event==='http.request' && Number(e.status)===429 && new Date(e.time).getTime()>=now-600000),
        revokes:Number(e.event.includes('session') && e.event.includes('revoked'))}));
    }
    const groups = new Map();
    for (const row of rows) {
      const ip = canonicalIp(row.ip) || 'unknown';
      const group = groups.get(ip) || {ip,login:0,denied:0,rate:0,revokes:0};
      for (const key of ['login','denied','rate','revokes']) group[key] += Number(row[key]) || 0;
      groups.set(ip,group);
    }
    return [...groups.values()];
  }

  async countLoginFailures(ip) {
    if (this.pool) return (await this.pool.query("SELECT COUNT(*)::int AS count FROM panthorium_audit_events WHERE ip=$1 AND event='auth.login_failed' AND time>=NOW()-INTERVAL '15 minutes'", [canonicalIp(ip)])).rows[0].count;
    return (await this.securityCounts()).find(r=>r.ip===canonicalIp(ip))?.login || 0;
  }

  alertId(alert) {
    const subject = `${alert.code}|${alert.ip || "global"}`;
    return createHash("sha256").update(subject).digest("hex").slice(0, 24);
  }

  async activeAcknowledgements() {
    const now = Date.now();
    if (this.pool) {
      await this.pool.query("DELETE FROM panthorium_security_alert_acknowledgements WHERE expires_at <= NOW()");
      const result = await this.pool.query("SELECT alert_id, acknowledged_at, acknowledged_by, expires_at FROM panthorium_security_alert_acknowledgements WHERE expires_at > NOW()");
      return new Map(result.rows.map((row) => [row.alert_id, { acknowledgedAt: row.acknowledged_at, acknowledgedBy: row.acknowledged_by, expiresAt: row.expires_at }]));
    }
    for (const [id, ack] of this.alertAcks.entries()) if (Date.parse(ack.expiresAt) <= now) this.alertAcks.delete(id);
    return new Map(this.alertAcks);
  }

  async acknowledgeAlert(alertId, actorUserId, ttlHours = 24) {
    const safeHours = Math.max(1, Math.min(Number(ttlHours) || 24, 168));
    const expiresAt = new Date(Date.now() + safeHours * 3600000).toISOString();
    const acknowledgedAt = new Date().toISOString();
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO panthorium_security_alert_acknowledgements(alert_id, acknowledged_at, acknowledged_by, expires_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (alert_id) DO UPDATE SET acknowledged_at=EXCLUDED.acknowledged_at, acknowledged_by=EXCLUDED.acknowledged_by, expires_at=EXCLUDED.expires_at`,
        [alertId, acknowledgedAt, actorUserId || null, expiresAt]
      );
    } else {
      this.alertAcks.set(alertId, { acknowledgedAt, acknowledgedBy: actorUserId || null, expiresAt });
    }
    this.record("security.alert_acknowledged", { actorUserId, alertId, expiresAt });
    return { alertId, acknowledgedAt, acknowledgedBy: actorUserId || null, expiresAt };
  }

  async clearAlertAcknowledgement(alertId, actorUserId) {
    let removed = false;
    if (this.pool) {
      const result = await this.pool.query("DELETE FROM panthorium_security_alert_acknowledgements WHERE alert_id=$1", [alertId]);
      removed = result.rowCount > 0;
    } else {
      removed = this.alertAcks.delete(alertId);
    }
    if (removed) this.record("security.alert_reopened", { actorUserId, alertId });
    return removed;
  }

  async securityAlerts() {
    const rows = await this.securityCounts();
    const alerts = [];
    for (const [ip, count] of rows.map(r=>[r.ip,r.login])) {
      if (count >= 10) alerts.push({ level: "critical", code: "LOGIN_BRUTE_FORCE", title: "Login failures สูงผิดปกติ", detail: `${count} ครั้งใน 15 นาทีจาก IP ${ip}`, count, ip });
      else if (count >= 5) alerts.push({ level: "warning", code: "LOGIN_FAILURE_SPIKE", title: "Login failures เพิ่มสูง", detail: `${count} ครั้งใน 15 นาทีจาก IP ${ip}`, count, ip });
    }
    for (const [ip, count] of rows.map(r=>[r.ip,r.denied])) {
      if (count >= 20) alerts.push({ level: "critical", code: "AUTH_DENIED_FLOOD", title: "401/403 จำนวนมาก", detail: `${count} requests ใน 10 นาทีจาก IP ${ip}`, count, ip });
      else if (count >= 10) alerts.push({ level: "warning", code: "AUTH_DENIED_SPIKE", title: "Unauthorized/Forbidden สูง", detail: `${count} requests ใน 10 นาทีจาก IP ${ip}`, count, ip });
    }
    for (const [ip, count] of rows.map(r=>[r.ip,r.rate])) {
      if (count >= 5) alerts.push({ level: "warning", code: "RATE_LIMIT_PRESSURE", title: "Rate limit ถูก trigger หลายครั้ง", detail: `${count} responses 429 ใน 10 นาทีจาก IP ${ip}`, count, ip });
    }
    const revokes = rows.reduce((n,r)=>n+r.revokes,0);
    if (revokes >= 3) alerts.push({ level: 'info', code: 'SESSION_REVOCATIONS', title: 'มีการ revoke sessions', detail: `${revokes} sessions ถูก revoke ใน 1 ชั่วโมง`, count: revokes });

    const acknowledgements = await this.activeAcknowledgements();
    for (const alert of alerts) {
      alert.id = this.alertId(alert);
      const ack = acknowledgements.get(alert.id);
      alert.acknowledged = !!ack;
      if (ack) alert.acknowledgement = ack;
    }

    const rank = { critical: 3, warning: 2, info: 1 };
    alerts.sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || rank[b.level] - rank[a.level] || b.count - a.count);
    const active = alerts.filter((a) => !a.acknowledged);
    return {
      generatedAt: new Date().toISOString(),
      status: active.some((a) => a.level === "critical") ? "critical" : active.some((a) => a.level === "warning") ? "warning" : "normal",
      activeCount: active.length,
      acknowledgedCount: alerts.length - active.length,
      alerts
    };
  }
}

module.exports = { AuditService };
