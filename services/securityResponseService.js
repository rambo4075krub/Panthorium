const { Pool } = require("pg");
const { isIP } = require("node:net");

class SecurityResponseService {
  constructor({ audit, databaseUrl = "", databaseSslMode = "disable" }) {
    this.audit = audit;
    this.databaseUrl = databaseUrl;
    this.databaseSslMode = databaseSslMode;
    this.pool = null;
    this.memoryBlocks = new Map();
  }

  async init() {
    if (!this.databaseUrl) return;
    this.pool = new Pool({ connectionString: this.databaseUrl, ssl: this.databaseSslMode === "disable" ? false : { rejectUnauthorized: false } });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_security_ip_blocks (
      ip TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      created_by TEXT
    )`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_panthorium_security_ip_blocks_expiry ON panthorium_security_ip_blocks(expires_at)");
  }

  normalizeIp(ip) {
    let value = String(ip || "").trim();
    if (!value || value.length > 128) return "";
    value = value.replace(/^::ffff:/, "");
    return isIP(value) ? value : "";
  }

  async cleanupExpired() {
    if (this.pool) { await this.pool.query("DELETE FROM panthorium_security_ip_blocks WHERE expires_at <= NOW()"); return; }
    const now = Date.now();
    for (const [ip, block] of this.memoryBlocks.entries()) if (Date.parse(block.expiresAt) <= now) this.memoryBlocks.delete(ip);
  }

  async getActiveBlock(ip) {
    const normalized = this.normalizeIp(ip); if (!normalized) return null; await this.cleanupExpired();
    if (this.pool) {
      const result = await this.pool.query("SELECT ip, reason, source, created_at, expires_at, created_by FROM panthorium_security_ip_blocks WHERE ip=$1 AND expires_at > NOW()", [normalized]);
      const row = result.rows[0];
      return row ? { ip: row.ip, reason: row.reason, source: row.source, createdAt: row.created_at, expiresAt: row.expires_at, createdBy: row.created_by } : null;
    }
    return this.memoryBlocks.get(normalized) || null;
  }

  async listBlocks() {
    await this.cleanupExpired();
    if (this.pool) {
      const result = await this.pool.query("SELECT ip, reason, source, created_at, expires_at, created_by FROM panthorium_security_ip_blocks WHERE expires_at > NOW() ORDER BY expires_at DESC");
      return result.rows.map((row) => ({ ip: row.ip, reason: row.reason, source: row.source, createdAt: row.created_at, expiresAt: row.expires_at, createdBy: row.created_by }));
    }
    return [...this.memoryBlocks.values()].sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
  }

  async blockIp(ip, options = {}) {
    const normalized = this.normalizeIp(ip); if (!normalized) throw new Error("invalid_ip");
    const durationMinutes = Math.max(1, Math.min(Number(options.durationMinutes) || 30, 1440));
    const block = { ip: normalized, reason: String(options.reason || "security policy").slice(0, 240), source: String(options.source || "manual").slice(0, 40), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + durationMinutes * 60000).toISOString(), createdBy: options.actorUserId || null };
    if (this.pool) {
      await this.pool.query(`INSERT INTO panthorium_security_ip_blocks(ip, reason, source, created_at, expires_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (ip) DO UPDATE SET reason=EXCLUDED.reason, source=EXCLUDED.source, created_at=EXCLUDED.created_at, expires_at=EXCLUDED.expires_at, created_by=EXCLUDED.created_by`, [block.ip, block.reason, block.source, block.createdAt, block.expiresAt, block.createdBy]);
    } else this.memoryBlocks.set(normalized, block);
    this.audit.record("security.ip_blocked", { actorUserId: block.createdBy, ip: block.ip, reason: block.reason, source: block.source, expiresAt: block.expiresAt });
    return block;
  }

  async unblockIp(ip, actorUserId) {
    const normalized = this.normalizeIp(ip); if (!normalized) return false; let removed = false;
    if (this.pool) { const result = await this.pool.query("DELETE FROM panthorium_security_ip_blocks WHERE ip=$1", [normalized]); removed = result.rowCount > 0; }
    else removed = this.memoryBlocks.delete(normalized);
    if (removed) this.audit.record("security.ip_unblocked", { actorUserId, ip: normalized });
    return removed;
  }

  async evaluateLoginFailure(ip) {
    const normalized = this.normalizeIp(ip);
    if (!normalized || normalized === "127.0.0.1" || normalized === "::1") return null;
    if (await this.getActiveBlock(normalized)) return null;
    const entries = await this.audit.listRecent({ limit: 100, event: "auth.login_failed", from: new Date(Date.now() - 15 * 60000).toISOString() });
    const previousFailures = entries.filter((entry) => this.normalizeIp(entry.ip) === normalized).length;
    if (previousFailures < 9) return null;
    return this.blockIp(normalized, { durationMinutes: 30, reason: "10+ failed login attempts within 15 minutes", source: "automatic" });
  }
}

module.exports = { SecurityResponseService };
