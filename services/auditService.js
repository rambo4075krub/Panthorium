const fs = require("fs");
const path = require("path");

class AuditService {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  record(event, fields = {}) {
    const entry = {
      time: new Date().toISOString(),
      event,
      ...fields
    };
    fs.appendFile(this.file, JSON.stringify(entry) + "\n", () => {});
  }

  listRecent(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-safeLimit).reverse().map((line) => {
      try { return JSON.parse(line); } catch (_) { return { time: null, event: "audit.parse_error" }; }
    });
  }

  summary() {
    const entries = this.listRecent(500);
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
