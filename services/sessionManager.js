class SessionManager {
  constructor({ maxHistory = 16, ttlMs = 24 * 60 * 60 * 1000, maxSessions = 1000 } = {}) {
    this.maxHistory = maxHistory;
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }

  get(sessionId) {
    const now = Date.now();
    let entry = this.sessions.get(sessionId);
    if (!entry || now - entry.updatedAt > this.ttlMs) {
      entry = { messages: [], updatedAt: now };
      this.sessions.set(sessionId, entry);
    }
    entry.updatedAt = now;
    this.prune();
    return entry.messages;
  }

  append(sessionId, message) {
    const history = this.get(sessionId);
    history.push(message);
    if (history.length > this.maxHistory) history.splice(0, history.length - this.maxHistory);
    return history;
  }

  clear(sessionId) {
    this.sessions.delete(sessionId);
  }

  prune() {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.updatedAt > this.ttlMs) this.sessions.delete(id);
    }
    if (this.sessions.size <= this.maxSessions) return;
    const oldest = [...this.sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [id] of oldest.slice(0, this.sessions.size - this.maxSessions)) this.sessions.delete(id);
  }

  size() {
    return this.sessions.size;
  }
}

module.exports = { SessionManager };
