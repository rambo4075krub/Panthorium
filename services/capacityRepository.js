'use strict';
const { capacityError } = require('./concurrencyGate');

// Only short metadata transactions hold the lane row lock. Prompts, files,
// provider calls and user effects never run inside a database transaction.
class CapacityRepository {
  constructor({ pool, scope = 'panthorium', leaseMs = 45000 } = {}) {
    this.pool = pool; this.scope = scope; this.leaseMs = leaseMs; this.ready = false;
    this.waiters = new Map();
    this.nextSweep = new Map();
  }
  async init() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10000ms'");
      // Serialize only schema bootstrap when several fresh replicas start.
      await client.query('SELECT pg_advisory_xact_lock(190731, 4421)');
      await client.query(`CREATE TABLE IF NOT EXISTS panthorium_capacity_lanes (
      scope TEXT NOT NULL, lane TEXT NOT NULL, policy JSONB NOT NULL, PRIMARY KEY(scope,lane));
      CREATE TABLE IF NOT EXISTS panthorium_capacity_tickets (
      sequence BIGSERIAL UNIQUE, ticket_id UUID PRIMARY KEY, scope TEXT NOT NULL, lane TEXT NOT NULL,
      owner_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('waiting','active')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL);
      CREATE INDEX IF NOT EXISTS panthorium_capacity_scope_lane ON panthorium_capacity_tickets(scope,lane,sequence);`);
      await client.query('COMMIT');
      this.ready = true;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  query(text, values) { return this.pool.query({text, values, query_timeout:5000}); }
  async transaction(fn) {
    if (!this.ready) throw capacityError('capacity_unavailable');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      await client.query("SET LOCAL lock_timeout = '2000ms'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async liveTickets(client, lane) {
    await client.query('DELETE FROM panthorium_capacity_tickets WHERE scope=$1 AND lane=$2 AND expires_at<=clock_timestamp()', [this.scope, lane]);
    return (await client.query('SELECT ticket_id,owner_id,state FROM panthorium_capacity_tickets WHERE scope=$1 AND lane=$2 ORDER BY sequence', [this.scope, lane])).rows;
  }

  // Reserve all free slots in FIFO order within the shared lane lock. A slow
  // polling worker cannot leave other free slots idle or let newcomers jump it.
  async promote(client, rows, policy) {
    const byOwner = new Map();
    let free = policy.limit;
    for (const row of rows) {
      if (row.state === 'active') {
        free--;
        byOwner.set(row.owner_id, (byOwner.get(row.owner_id) || 0) + 1);
      }
    }
    const promoted = [];
    for (const row of rows) {
      if (free <= 0) break;
      const count = byOwner.get(row.owner_id) || 0;
      if (row.state !== 'waiting' || count >= policy.perUserLimit) continue;
      promoted.push(row.ticket_id);
      row.state = 'active';
      byOwner.set(row.owner_id, count + 1);
      free--;
    }
    if (promoted.length) await client.query(`UPDATE panthorium_capacity_tickets SET state='active',
      expires_at=clock_timestamp()+($2*INTERVAL '1 millisecond') WHERE ticket_id=ANY($1::uuid[])`, [promoted, this.leaseMs]);
    return promoted;
  }

  wake(ids) {
    for (const id of ids) this.waiters.get(id)?.();
  }

  wait(ticketId, ms, signal) {
    signal?.throwIfAborted();
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        this.waiters.delete(ticketId);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.waiters.set(ticketId, finish);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  async checkTicket({ lane, ticketId, userId }) {
    // Releases dispatch work immediately. Only one waiter per lane and process
    // needs to reclaim expired leases when another process disappears.
    const now = performance.now();
    if (now >= (this.nextSweep.get(lane) || 0)) {
      this.nextSweep.set(lane, now + 250);
      const promoted = await this.transaction(async client => {
        const row = await client.query('SELECT policy FROM panthorium_capacity_lanes WHERE scope=$1 AND lane=$2 FOR UPDATE', [this.scope, lane]);
        return row.rowCount ? this.promote(client, await this.liveTickets(client, lane), row.rows[0].policy) : [];
      });
      this.wake(promoted);
    }
    const result = await this.query(`SELECT state FROM panthorium_capacity_tickets
      WHERE ticket_id=$1 AND scope=$2 AND lane=$3 AND owner_id=$4 AND expires_at>clock_timestamp()`,
      [ticketId, this.scope, lane, userId]);
    const state = result.rows[0]?.state;
    if (!state || (state === 'active' && !await this.renew(ticketId))) throw capacityError('capacity_lease_lost');
    return state;
  }

  async poll({ lane, policy, ticketId, userId, create = false }) {
    if (!create) return this.checkTicket({ lane, ticketId, userId });
    const result = await this.transaction(async client => {
      await client.query('INSERT INTO panthorium_capacity_lanes(scope,lane,policy) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [this.scope,lane,JSON.stringify(policy)]);
      const laneRow = (await client.query('SELECT policy FROM panthorium_capacity_lanes WHERE scope=$1 AND lane=$2 FOR UPDATE', [this.scope,lane])).rows[0];
      const rows = await this.liveTickets(client, lane);
      if (Object.keys(policy).some(key => laneRow.policy[key] !== policy[key])) {
        if (rows.length) throw capacityError('capacity_configuration_mismatch');
        await client.query('UPDATE panthorium_capacity_lanes SET policy=$3 WHERE scope=$1 AND lane=$2', [this.scope,lane,JSON.stringify(policy)]);
      }
      const promoted = await this.promote(client, rows, policy);
      const existing = rows.find(row => row.ticket_id === ticketId && row.owner_id === userId);
      if (existing) return {state: existing.state, promoted};
      const active = rows.filter(row => row.state === 'active');
      const waiting = rows.filter(row => row.state === 'waiting');
      const immediate = active.length < policy.limit && active.filter(row => row.owner_id === userId).length < policy.perUserLimit;
      if (!immediate && (waiting.length >= policy.maxQueue || waiting.filter(row => row.owner_id === userId).length >= policy.maxQueuedPerUser)) throw capacityError();
      const state = immediate ? 'active' : 'waiting';
      await client.query(`INSERT INTO panthorium_capacity_tickets(ticket_id,scope,lane,owner_id,state,expires_at)
        VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6*INTERVAL '1 millisecond'))`,
        [ticketId,this.scope,lane,userId,state,immediate ? this.leaseMs : policy.queueTimeoutMs]);
      return {state, promoted};
    });
    this.wake(result.promoted);
    return result.state;
  }
  async renew(ticketId) {
    const result = await this.query(`UPDATE panthorium_capacity_tickets SET expires_at=clock_timestamp()+($3*INTERVAL '1 millisecond')
      WHERE ticket_id=$1 AND scope=$2 AND state='active' AND expires_at>clock_timestamp()`, [ticketId,this.scope,this.leaseMs]);
    return result.rowCount === 1;
  }
  async release(ticketId, lane) {
    if (!lane) {
      const found = await this.query('SELECT lane FROM panthorium_capacity_tickets WHERE ticket_id=$1 AND scope=$2', [ticketId,this.scope]);
      if (!found.rowCount) return;
      lane = found.rows[0].lane;
    }
    const promoted = await this.transaction(async client => {
      const { rows } = await client.query('SELECT policy FROM panthorium_capacity_lanes WHERE scope=$1 AND lane=$2 FOR UPDATE', [this.scope, lane]);
      const removed = await client.query('DELETE FROM panthorium_capacity_tickets WHERE ticket_id=$1 AND scope=$2 AND lane=$3 RETURNING state', [ticketId,this.scope,lane]);
      if (removed.rows[0]?.state !== 'active') return [];
      const waiting = await client.query("SELECT 1 FROM panthorium_capacity_tickets WHERE scope=$1 AND lane=$2 AND state='waiting' LIMIT 1", [this.scope,lane]);
      return waiting.rowCount ? this.promote(client, await this.liveTickets(client, lane), rows[0].policy) : [];
    });
    this.wake(promoted);
  }
  async snapshot() {
    if (!this.ready) throw capacityError('capacity_unavailable');
    return (await this.query(`SELECT lane,COUNT(*) FILTER(WHERE state='active')::int AS active,
      COUNT(*) FILTER(WHERE state='waiting')::int AS queued,
      COALESCE(MAX(EXTRACT(EPOCH FROM (clock_timestamp()-created_at))*1000) FILTER(WHERE state='waiting'),0)::float8 AS "oldestWaitMs"
      FROM panthorium_capacity_tickets WHERE scope=$1 AND expires_at>clock_timestamp() GROUP BY lane`, [this.scope])).rows;
  }
}
module.exports = { CapacityRepository };
