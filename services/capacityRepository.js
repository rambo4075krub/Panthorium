'use strict';
const { capacityError } = require('./concurrencyGate');

// Only short metadata transactions hold the lane row lock. Prompts, files,
// provider calls and user effects never run inside a database transaction.
class CapacityRepository {
  constructor({ pool, scope = 'panthorium', leaseMs = 45000 } = {}) {
    this.pool = pool; this.scope = scope; this.leaseMs = leaseMs; this.ready = false;
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
  async poll({ lane, policy, ticketId, userId, create = false }) {
    return this.transaction(async client => {
      await client.query('INSERT INTO panthorium_capacity_lanes(scope,lane,policy) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [this.scope,lane,JSON.stringify(policy)]);
      const laneRow = (await client.query('SELECT policy FROM panthorium_capacity_lanes WHERE scope=$1 AND lane=$2 FOR UPDATE', [this.scope,lane])).rows[0];
      await client.query('DELETE FROM panthorium_capacity_tickets WHERE scope=$1 AND lane=$2 AND expires_at<=clock_timestamp()', [this.scope,lane]);
      const rows = (await client.query('SELECT ticket_id,owner_id,state FROM panthorium_capacity_tickets WHERE scope=$1 AND lane=$2 ORDER BY sequence', [this.scope,lane])).rows;
      // A different policy may take effect only after the lane drains. Rolling
      // workers cannot silently multiply limits or disagree about account caps.
      if (Object.keys(policy).some(key => laneRow.policy[key] !== policy[key])) {
        if (rows.length) throw capacityError('capacity_configuration_mismatch');
        await client.query('UPDATE panthorium_capacity_lanes SET policy=$3 WHERE scope=$1 AND lane=$2', [this.scope,lane,JSON.stringify(policy)]);
      }
      let own = rows.find(row => row.ticket_id === ticketId && row.owner_id === userId);
      if (!own && !create) throw capacityError('capacity_lease_lost');
      const active = rows.filter(row => row.state === 'active');
      const waiting = rows.filter(row => row.state === 'waiting');
      const userActive = active.filter(row => row.owner_id === userId).length;
      const eligibleAhead = waiting.some(row => active.filter(a => a.owner_id === row.owner_id).length < policy.perUserLimit);
      if (!own) {
        const immediate = active.length < policy.limit && userActive < policy.perUserLimit && !eligibleAhead;
        if (!immediate && (waiting.length >= policy.maxQueue || waiting.filter(row => row.owner_id === userId).length >= policy.maxQueuedPerUser)) throw capacityError();
        own = { ticket_id: ticketId, owner_id: userId, state: immediate ? 'active' : 'waiting' };
        await client.query(`INSERT INTO panthorium_capacity_tickets(ticket_id,scope,lane,owner_id,state,expires_at)
          VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6*INTERVAL '1 millisecond'))`, [ticketId,this.scope,lane,userId,own.state,this.leaseMs]);
      } else {
        const firstEligible = waiting.find(row => active.filter(a => a.owner_id === row.owner_id).length < policy.perUserLimit);
        if (own.state === 'waiting' && active.length < policy.limit && firstEligible?.ticket_id === ticketId) own.state = 'active';
        await client.query(`UPDATE panthorium_capacity_tickets SET state=$2,expires_at=clock_timestamp()+($3*INTERVAL '1 millisecond') WHERE ticket_id=$1`, [ticketId,own.state,this.leaseMs]);
      }
      return own.state;
    });
  }
  async renew(ticketId) {
    const result = await this.query(`UPDATE panthorium_capacity_tickets SET expires_at=clock_timestamp()+($3*INTERVAL '1 millisecond')
      WHERE ticket_id=$1 AND scope=$2 AND state='active' AND expires_at>clock_timestamp()`, [ticketId,this.scope,this.leaseMs]);
    return result.rowCount === 1;
  }
  async release(ticketId) { await this.query('DELETE FROM panthorium_capacity_tickets WHERE ticket_id=$1 AND scope=$2', [ticketId,this.scope]); }
  async snapshot() {
    if (!this.ready) throw capacityError('capacity_unavailable');
    return (await this.query(`SELECT lane,COUNT(*) FILTER(WHERE state='active')::int AS active,
      COUNT(*) FILTER(WHERE state='waiting')::int AS queued,
      COALESCE(MAX(EXTRACT(EPOCH FROM (clock_timestamp()-created_at))*1000) FILTER(WHERE state='waiting'),0)::float8 AS "oldestWaitMs"
      FROM panthorium_capacity_tickets WHERE scope=$1 AND expires_at>clock_timestamp() GROUP BY lane`, [this.scope])).rows;
  }
}
module.exports = { CapacityRepository };
