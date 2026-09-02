const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class AuthService {
  constructor({ repository, config, audit }) {
    this.repository = repository;
    this.config = config;
    this.audit = audit;
  }

  async init() {
    await this.repository.init();
    await this.ensureAdmin();
  }

  async ensureAdmin() {
    if (!this.config.adminPassword) return;
    const existing = await this.repository.findUserByUsername(this.config.adminUsername);
    if (existing) return;
    const passwordHash = await bcrypt.hash(this.config.adminPassword, 12);
    await this.repository.createUser({
      id: crypto.randomUUID(),
      username: this.config.adminUsername,
      passwordHash,
      roles: ["administrator"],
      permissions: ["chat", "core:command", "settings", "system:read"],
      createdAt: new Date().toISOString()
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

  async issueRefreshToken(principal) {
    const raw = crypto.randomBytes(48).toString("base64url");
    const expiresAt = Date.now() + this.config.refreshTokenDays * 86400000;
    await this.repository.storeRefreshToken({
      id: crypto.randomUUID(),
      userId: principal.id,
      tokenHash: sha256(raw),
      expiresAt,
      createdAt: new Date().toISOString()
    });
    return raw;
  }

  async login(username, password) {
    const user = await this.repository.findUserByUsername(username);
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

  async issueSession(user) {
    const principal = {
      id: user.id,
      username: user.username,
      roles: user.roles || [],
      permissions: user.permissions || []
    };
    return {
      principal,
      accessToken: this.signAccessToken(principal),
      refreshToken: await this.issueRefreshToken(principal)
    };
  }

  async refresh(rawToken) {
    if (!rawToken) return null;
    const stored = await this.repository.consumeRefreshToken(sha256(rawToken));
    if (!stored) return null;
    const user = await this.repository.findUserById(stored.userId);
    if (!user) return null;
    this.audit.record("auth.refresh", { userId: user.id });
    return this.issueSession(user);
  }

  async revoke(rawToken) {
    if (!rawToken) return;
    await this.repository.revokeRefreshToken(sha256(rawToken));
  }

  verifyAccessToken(token) {
    return jwt.verify(token, this.config.jwtSecret, {
      issuer: "panthorium",
      audience: "panthorium-ui"
    });
  }
}

module.exports = { AuthService };
