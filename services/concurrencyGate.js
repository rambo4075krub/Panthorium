'use strict';
function capacityError(code = 'system_busy') {
  return Object.assign(new Error(code), { code, status: 503, retryAfterSeconds: 2 });
}
// A cancelled waiter must never start later; every permit is released once.
class ConcurrencyGate {
  constructor({ limit = 8, maxQueue = 32, queueTimeoutMs = 15000, perUserLimit = limit,
    maxQueuedPerUser = maxQueue, audit, name = 'ai' } = {}) {
    Object.assign(this, { limit, maxQueue, queueTimeoutMs, perUserLimit, maxQueuedPerUser, audit, name });
    this.active = 0; this.queue = []; this.users = new Map();
  }
  stats() { return { name: this.name, mode: 'process', active: this.active, limit: this.limit, queued: this.queue.length, maxQueue: this.maxQueue }; }
  available(userId) { return this.active < this.limit && (this.users.get(userId) || 0) < this.perUserLimit; }
  grant(userId, signal) {
    this.active++; this.users.set(userId, (this.users.get(userId) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true; this.active--;
      const count = this.users.get(userId) - 1;
      if (count) this.users.set(userId, count); else this.users.delete(userId);
      this.drain();
    };
    release.signal = signal;
    return release;
  }
  drain() {
    for (let i = 0; i < this.queue.length && this.active < this.limit;) {
      const item = this.queue[i];
      if (!this.available(item.userId)) { i++; continue; }
      this.queue.splice(i, 1); item.cleanup(); item.resolve(this.grant(item.userId, item.signal));
    }
  }
  async acquire({ userId = 'anonymous', signal } = {}) {
    signal?.throwIfAborted();
    if (this.available(userId) && !this.queue.some(item => this.available(item.userId))) return this.grant(userId, signal);
    if (this.queue.length >= this.maxQueue || this.queue.filter(item => item.userId === userId).length >= this.maxQueuedPerUser) {
      this.audit?.record('production.backpressure_rejected', { gate: this.name });
      throw capacityError();
    }
    return new Promise((resolve, reject) => {
      const item = { userId, signal, resolve };
      const remove = error => {
        const i = this.queue.indexOf(item);
        if (i < 0) return;
        this.queue.splice(i, 1); item.cleanup(); reject(error); this.drain();
      };
      const abort = () => remove(signal.reason);
      const timer = setTimeout(() => remove(capacityError()), this.queueTimeoutMs);
      item.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(item); this.drain();
    });
  }
  async run(fn, options = {}) {
    const release = await this.acquire(options);
    try { options.signal?.throwIfAborted(); return await fn(options.signal); }
    finally { release(); }
  }
}
module.exports = { ConcurrencyGate, capacityError };
