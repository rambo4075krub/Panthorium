'use strict';
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { getDatabasePool } = require('./databasePool');
const { CapacityRepository } = require('./capacityRepository');
const { ConcurrencyGate, capacityError } = require('./concurrencyGate');

const DEFAULTS = Object.freeze({
  text:       { limit: 8, maxQueue: 32, perUserLimit: 2, maxQueuedPerUser: 1, queueTimeoutMs: 15000 },
  background: { limit: 2, maxQueue: 8, perUserLimit: 1, maxQueuedPerUser: 1, queueTimeoutMs: 15000 },
  image:      { limit: 2, maxQueue: 4, perUserLimit: 1, maxQueuedPerUser: 1, queueTimeoutMs: 15000 },
  media:      { limit: 1, maxQueue: 2, perUserLimit: 1, maxQueuedPerUser: 1, queueTimeoutMs: 15000 },
  voice:      { limit: 50, maxQueue: 0, perUserLimit: 1, maxQueuedPerUser: 0, queueTimeoutMs: 1000 },
  local:      { limit: 5, maxQueue: 0, perUserLimit: 1, maxQueuedPerUser: 0, queueTimeoutMs: 1000 }
});
function policies(raw) {
  const overrides = raw ? JSON.parse(raw) : {};
  if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object' || Object.keys(overrides).some(key => !Object.hasOwn(DEFAULTS,key))) throw new Error('invalid_capacity_configuration');
  return Object.fromEntries(Object.entries(DEFAULTS).map(([lane, defaults]) => {
    const input = overrides[lane] || {};
    if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(defaults,key))) throw new Error('invalid_capacity_configuration');
    const value = { ...defaults, ...input };
    for (const [key, number] of Object.entries(value)) {
      const min = ['maxQueue','maxQueuedPerUser'].includes(key) ? 0 : key === 'queueTimeoutMs' ? 100 : 1;
      const max = key === 'queueTimeoutMs' ? 60000 : key === 'maxQueue' ? 256 : 1000;
      if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('invalid_capacity_configuration');
    }
    if (value.perUserLimit > value.limit || value.maxQueuedPerUser > value.maxQueue) throw new Error('invalid_capacity_configuration');
    return [lane,value];
  }));
}
class SharedCapacityGate {
  constructor({ repository, name, policy, pollMs = 750, audit } = {}) {
    Object.assign(this, { repository, name, policy, pollMs, audit });
    this.active = 0; this.queued = 0; this.admitting = 0; this.rejected = 0; this.completed = 0; this.waitMs = 0;
  }
  stats() { return { name: this.name, mode: 'postgresql', countsScope: 'this_process', active: this.active, queued: this.queued, ...this.policy, rejected: this.rejected, completed: this.completed, totalWaitMs: this.waitMs }; }
  async acquire({ userId, signal } = {}) {
    signal?.throwIfAborted();
    if (typeof userId !== 'string' || !userId || userId.length > 180) throw capacityError('capacity_identity_required');
    // Bound requests awaiting the database pool as well as persisted waiters.
    if (this.admitting + this.active >= this.policy.limit + this.policy.maxQueue) throw capacityError();
    this.admitting++;
    const ticketId = randomUUID(), started = performance.now();
    const input = { ticketId, lane: this.name, policy: this.policy, userId };
    let registered = false, queued = false;
    try {
      let state, leaseStarted;
      do {
        signal?.throwIfAborted();
        if (registered && performance.now()-started >= this.policy.queueTimeoutMs) throw capacityError();
        leaseStarted = performance.now();
        state = await this.repository.poll({ ...input, create: !registered });
        registered = true;
        if (state === 'active') break;
        if (!queued) { queued = true; this.queued++; }
        await delay(Math.min(this.pollMs + Math.random()*100, Math.max(1,this.policy.queueTimeoutMs-(performance.now()-started))), undefined, { signal });
      } while (true);
      signal?.throwIfAborted();
      if (queued && performance.now()-started >= this.policy.queueTimeoutMs) throw capacityError();
      this.active++; this.waitMs += Math.round(performance.now()-started);
      return this.lease(ticketId, signal, leaseStarted);
    } catch (error) {
      // A commit response may be lost. Delete our ticket even after poll fails;
      // if the database is unavailable, its lease still expires.
      await this.repository.release(ticketId).catch(() => {});
      if (signal?.aborted) throw signal.reason;
      this.rejected++;
      this.audit?.record('production.capacity_rejected', { lane: this.name, reason: error.code === 'system_busy' ? 'busy' : 'unavailable' });
      if (['system_busy','capacity_configuration_mismatch','capacity_lease_lost'].includes(error.code)) throw error;
      throw capacityError('capacity_unavailable');
    } finally { this.admitting--; if (queued) this.queued--; }
  }
  lease(ticketId, callerSignal, leaseStarted) {
    const controller = new AbortController();
    const signal = callerSignal ? AbortSignal.any([callerSignal,controller.signal]) : controller.signal;
    let released = false, renewing = false, deadline;
    const expire = () => controller.abort(capacityError('capacity_lease_lost'));
    const arm = started => {
      clearTimeout(deadline);
      const remaining = this.repository.leaseMs * 0.8 - (performance.now()-started);
      if (remaining <= 0) expire();
      else { deadline = setTimeout(expire, remaining); deadline.unref?.(); }
    };
    arm(leaseStarted);
    const heartbeat = setInterval(async () => {
      if (released || renewing || signal.aborted) return;
      renewing = true;
      const started = performance.now();
      try {
        if (!await this.repository.renew(ticketId)) expire();
        else if (!released && !signal.aborted) arm(started);
      } catch { expire(); }
      finally { renewing = false; }
    }, this.repository.leaseMs / 3);
    heartbeat.unref?.();
    const release = async () => {
      if (released) return;
      released = true; clearInterval(heartbeat); clearTimeout(deadline); this.active--; this.completed++;
      await this.repository.release(ticketId).catch(() => {});
    };
    release.signal = signal;
    return release;
  }
  async run(fn, options = {}) {
    const release = await this.acquire(options);
    try { release.signal.throwIfAborted(); const result = await fn(release.signal); release.signal.throwIfAborted(); return result; }
    catch (error) { release.signal.throwIfAborted(); throw error; }
    finally { await release(); }
  }
}
class WorkloadCapacity {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', pool, required = false, audit, env = process.env } = {}) {
    this.required = required; this.policy = policies(env.PANTHORIUM_CAPACITY_LIMITS);
    const scope = env.PANTHORIUM_CAPACITY_SCOPE || 'panthorium';
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(scope)) throw new Error('invalid_capacity_scope');
    pool ||= databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null;
    this.repository = pool ? new CapacityRepository({ pool, scope }) : null;
    this.gates = Object.fromEntries(Object.entries(this.policy).map(([name,policy]) => [name, this.repository
      ? new SharedCapacityGate({ repository: this.repository, name, policy, audit })
      : new ConcurrencyGate({ ...policy, name, audit })]));
  }
  async init() { if (!this.repository && this.required) throw new Error('capacity_database_required'); await this.repository?.init(); }
  gate(name) { if (!Object.hasOwn(this.gates,name)) throw new Error('unknown_capacity_lane'); return this.gates[name]; }
  async snapshot() {
    const shared = this.repository ? await this.repository.snapshot() : [];
    return { mode: this.repository ? 'postgresql' : 'process', lanes: Object.entries(this.gates).map(([name,gate]) => ({
      ...gate.stats(), metricsScope: 'this_process', ...(this.repository ? { countsScope: 'all_workers', active: 0, queued: 0, oldestWaitMs: 0, ...shared.find(row => row.lane === name) } : {})
    })) };
  }
  async probe() { try { await this.snapshot(); return { ok: Boolean(this.repository) || !this.required }; } catch { return { ok: false }; } }
}
module.exports = { WorkloadCapacity, SharedCapacityGate, policies, DEFAULTS };
