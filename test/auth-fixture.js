'use strict';
const { randomUUID } = require('node:crypto');
const { AuthService: RealAuthService } = require('../services/authService');
// Component/browser fixtures have no authentication database. Give their signed
// tokens an explicit live session instead of bypassing the production gate.
class AuthService extends RealAuthService {
  constructor(options) {
    const sessions = new Map();
    const repository = { ...options.repository,
      getActiveSession: async (id, userId) => sessions.get(id)?.userId === userId ? sessions.get(id) : null };
    super({ ...options, repository });
    this.fixtureSessions = sessions;
  }
  signAccessToken(principal) {
    if (String(principal.id).startsWith('guest:')) return super.signAccessToken(principal);
    const sid = principal.sid || randomUUID();
    this.fixtureSessions.set(sid, { userId: principal.id });
    return super.signAccessToken({ ...principal, sid });
  }
}
module.exports = { AuthService };
