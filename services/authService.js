const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class AuthService {
  constructor({ store, config, audit }) {
    this.store = store;
    this.config = config;
    this.audit = audit;
    this.ensureAdmin();
  }

  ensureAdmin() {
    if (!this.config.adminPassword) return;
    const db = this.store.read();
    if (db.users.some((u) => u.username === this.config.adminUsername)) return;
    const passwordHash = bcrypt.hashSync(this.config.adminPassword, 12);
    this.store.update((data) => {
      data.users.push({
        id: crypto.randomUUID(),
        username: this.config.adminUsername,
        passwordHash,
        roles: ["administrator"],
        permissions: ["chat", "core:command", "settings", "system:read"],
        createdAt: new Date().toISOString()
      });
      return data;
    });
  }

  signAccessToken(principal) {
    return jwt.sign({
      sub: principal.id,
      username: principal.username,
      roles: principal.roles || [],
      permissions: principal.permissions || []
    }, this.config.jwtSecret, {
      expiresIn: this.config.accessTokenTtl,
      issuer: "panthorium",
      audience: "panthorium-ui"
    });
  }

  issueRefreshToken(principal) {
    const raw = crypto.randomBytes(48).toString("base64url");
    const expiresAt = Date.now() + this.config.refreshTokenDays * 86400000;
    const hash = sha256(raw);
    this.store.update((data) => {
      data.refreshTokens = (data.refreshTokens || []).filter((t) => t.expiresAt > Date.now());
      data.refreshTokens.push({
        id: crypto.randomUUID(),
        userId: principal.id,
        tokenHash: hash,
        expiresAt,
        createdAt: new Date().toISOString()
      });
      return data;
    });
    return raw;
  }

  async login(username, password) {
    const db = this.store.read();
    const user = db.users.find((u) => u.username === username);
    if (!user || !(await bcrypt.compare(password || "", user.passwordHash))) {
      this.audit.record("auth.login_failed", { username });
      return null;
    }
    this.audit.record("auth.login_success", { userId: user.id, username: user.username });
    return this.issueSession(user);
  }

  guest() {
    const principal = {
      id: `guest:${crypto.randomUUID()}`,
      username: "guest",
      roles: ["guest"],
      permissions: ["chat", "system:read"]
    };
    this.audit.record("auth.guest_session", { userId: principal.id });
    return { principal, accessToken: this.signAccessToken(principal), refreshToken: null };
  }

  issueSession(user) {
    const principal = {
      id: user.id,
      username: user.username,
      roles: user.roles || [],
      permissions: user.permissions || []
    };
    return {
      principal,
      accessToken: this.signAccessToken(principal),
      refreshToken: this.issueRefreshToken(principal)
    };
  }

  refresh(rawToken) {
    if (!rawToken) return null;
    const hash = sha256(rawToken);
    const db = this.store.read();
    const stored = (db.refreshTokens || []).find((t) => t.tokenHash === hash && t.expiresAt > Date.now());
    if (!stored) return null;
    const user = db.users.find((u) => u.id === stored.userId);
    if (!user) return null;

    this.store.update((data) => {
      data.refreshTokens = (data.refreshTokens || []).filter((t) => t.tokenHash !== hash);
      return data;
    });
    this.audit.record("auth.refresh", { userId: user.id });
    return this.issueSession(user);
  }

  revoke(rawToken) {
    if (!rawToken) return;
    const hash = sha256(rawToken);
    this.store.update((data) => {
      data.refreshTokens = (data.refreshTokens || []).filter((t) => t.tokenHash !== hash);
      return data;
    });
  }

  verifyAccessToken(token) {
    return jwt.verify(token, this.config.jwtSecret, {
      issuer: "panthorium",
      audience: "panthorium-ui"
    });
  }
}

module.exports = { AuthService };
