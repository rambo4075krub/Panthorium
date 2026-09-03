const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const ALLOWED_ROLES = new Set(["administrator", "operator", "guest"]);
const ALLOWED_PERMISSIONS = new Set(["chat", "core:command", "settings", "system:read"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeList(values, allowed) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && allowed.has(value)))];
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

  publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      roles: user.roles || [],
      permissions: user.permissions || [],
      createdAt: user.createdAt || null
    };
  }

  async listUsers() {
    const users = await this.repository.listUsers();
    return users.map((user) => this.publicUser(user));
  }

  async createManagedUser({ username, password, roles, permissions }, actorId) {
    const cleanUsername = typeof username === "string" ? username.trim() : "";
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(cleanUsername)) throw new Error("invalid_username");
    if (typeof password !== "string" || password.length < 10 || password.length > 256) throw new Error("invalid_password");
    if (await this.repository.findUserByUsername(cleanUsername)) throw new Error("username_exists");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.repository.createUser({
      id: crypto.randomUUID(),
      username: cleanUsername,
      passwordHash,
      roles: normalizeList(roles, ALLOWED_ROLES),
      permissions: normalizeList(permissions, ALLOWED_PERMISSIONS),
      createdAt: new Date().toISOString()
    });
    this.audit.record("auth.user_created", { actorId, userId: user.id, username: user.username });
    return this.publicUser(user);
  }

  async updateManagedUserAccess(id, { roles, permissions }, actorId) {
    const existing = await this.repository.findUserById(id);
    if (!existing) throw new Error("user_not_found");

    const nextRoles = normalizeList(roles, ALLOWED_ROLES);
    const nextPermissions = normalizeList(permissions, ALLOWED_PERMISSIONS);

    // Never allow the currently authenticated administrator to lock itself out.
    if (id === actorId) {
      if (!nextRoles.includes("administrator")) throw new Error("cannot_demote_self");
      if (!nextPermissions.includes("settings")) throw new Error("cannot_remove_own_settings");
    }

    // Keep at least one administrator in the system.
    if ((existing.roles || []).includes("administrator") && !nextRoles.includes("administrator")) {
      const users = await this.repository.listUsers();
      const adminCount = users.filter((user) => (user.roles || []).includes("administrator")).length;
      if (adminCount <= 1) throw new Error("last_administrator_required");
    }

    const updated = await this.repository.updateUserAccess(id, {
      roles: nextRoles,
      permissions: nextPermissions
    });
    const revokedSessions = await this.repository.revokeUserSessions(id);
    this.audit.record("auth.user_access_updated", { actorId, userId: id, revokedSessions });
    return this.publicUser(updated);
  }

  async resetManagedUserPassword(id, password, actorId) {
    if (typeof password !== "string" || password.length < 10 || password.length > 256) throw new Error("invalid_password");
    const existing = await this.repository.findUserById(id);
    if (!existing) throw new Error("user_not_found");
    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await this.repository.updateUserPassword(id, passwordHash);
    const revokedSessions = await this.repository.revokeUserSessions(id);
    this.audit.record("auth.user_password_reset", { actorId, userId: id, revokedSessions });
    return this.publicUser(updated);
  }

  async deleteManagedUser(id, actorId) {
    if (id === actorId) throw new Error("cannot_delete_self");
    const existing = await this.repository.findUserById(id);
    if (!existing) throw new Error("user_not_found");
    if ((existing.roles || []).includes("administrator")) throw new Error("cannot_delete_administrator");
    const deleted = await this.repository.deleteUser(id);
    if (!deleted) throw new Error("user_not_found");
    this.audit.record("auth.user_deleted", { actorId, userId: id, username: existing.username });
    return true;
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
