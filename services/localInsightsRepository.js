'use strict';
const { randomUUID, createHash } = require('crypto');
const { getDatabasePool } = require('./databasePool');
const { failure } = require('./notificationRepository');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = value => new Date(value).toISOString();

// This store contains counters and bounded security facts, never conversation content.
class LocalInsightsRepository {
  constructor({ databaseUrl, databaseSslMode = 'disable', pool } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.ready = false;
  }
  assertReady() { if (!this.ready) throw failure('insights_storage_unavailable', 503); }
  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_insights_control (
        id INTEGER PRIMARY KEY CHECK(id=1), enabled BOOLEAN NOT NULL DEFAULT FALSE,
        actor_id UUID REFERENCES panthorium_users(id) ON DELETE SET NULL,
        generation INTEGER NOT NULL DEFAULT 0, next_analysis TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        report JSONB, report_at TIMESTAMPTZ, worker_status TEXT NOT NULL DEFAULT 'disabled');
      INSERT INTO panthorium_insights_control(id) VALUES(1) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS panthorium_insights_preferences (
        user_id UUID PRIMARY KEY REFERENCES panthorium_users(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS panthorium_insights_counters (
        user_id UUID REFERENCES panthorium_insights_preferences(user_id) ON DELETE CASCADE,
        day DATE NOT NULL, feature TEXT NOT NULL, total INTEGER NOT NULL, errors INTEGER NOT NULL,
        denied INTEGER NOT NULL, slow INTEGER NOT NULL, PRIMARY KEY(user_id,day,feature));
      CREATE TABLE IF NOT EXISTS panthorium_insights_incidents (
        id UUID PRIMARY KEY, dedupe TEXT UNIQUE NOT NULL, family TEXT NOT NULL,
        code TEXT NOT NULL, ip TEXT NOT NULL, severity INTEGER NOT NULL,
        count INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        plan JSONB, analysis TEXT, analysis_at TIMESTAMPTZ, state TEXT NOT NULL DEFAULT 'observed');
      CREATE INDEX IF NOT EXISTS idx_insights_incident_time ON panthorium_insights_incidents(last_seen DESC);
      CREATE TABLE IF NOT EXISTS panthorium_insights_outbox (
        id TEXT PRIMARY KEY, incident_id UUID REFERENCES panthorium_insights_incidents(id) ON DELETE CASCADE,
        user_id UUID REFERENCES panthorium_users(id) ON DELETE CASCADE,
        payload JSONB NOT NULL, delivered_at TIMESTAMPTZ);
    `);
    this.ready = true;
  }
  async transaction(fn) {
    this.assertReady(); const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async control() { this.assertReady(); return (await this.pool.query('SELECT * FROM panthorium_insights_control WHERE id=1')).rows[0]; }
  async setEnabled(actor, enabled) {
    this.assertReady();
    await this.pool.query("UPDATE panthorium_insights_control SET enabled=$1,actor_id=$2,generation=generation+1,worker_status=$3,next_analysis=NOW() WHERE id=1", [enabled, actor, enabled ? 'waiting_idle' : 'disabled']);
  }
  async preferences(userId) {
    this.assertReady();
    const prefs = (await this.pool.query('SELECT enabled FROM panthorium_insights_preferences WHERE user_id=$1', [userId])).rows[0];
    const counters = (await this.pool.query(`SELECT feature,SUM(total)::int AS total,SUM(errors)::int AS errors,SUM(denied)::int AS denied,SUM(slow)::int AS slow
      FROM panthorium_insights_counters WHERE user_id=$1 AND day >= CURRENT_DATE - 30 GROUP BY feature ORDER BY SUM(total) DESC`, [userId])).rows;
    return { enabled: prefs?.enabled === true, retentionDays: 30, counters };
  }
  async setConsent(userId, enabled) {
    return this.transaction(async c => {
      // The control row serializes erasure with report publication; the preference row
      // serializes erasure with writes. Buffered pre-consent requests cannot reappear.
      await c.query('UPDATE panthorium_insights_control SET generation=generation+1,report=NULL,report_at=NULL WHERE id=1');
      await c.query(`INSERT INTO panthorium_insights_preferences(user_id,enabled) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=clock_timestamp()`, [userId, enabled]);
      if (!enabled) await c.query('DELETE FROM panthorium_insights_counters WHERE user_id=$1', [userId]);
    });
  }
  async addCounters(batch) {
    if (!batch.length) return;
    await this.transaction(async c => {
      for (const item of batch) {
        const consent = (await c.query('SELECT enabled,updated_at FROM panthorium_insights_preferences WHERE user_id=$1 FOR UPDATE', [item.userId])).rows[0];
        if (!consent?.enabled || new Date(consent.updated_at).getTime() > item.since) continue;
        await c.query(`INSERT INTO panthorium_insights_counters(user_id,day,feature,total,errors,denied,slow) VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(user_id,day,feature) DO UPDATE SET total=panthorium_insights_counters.total+EXCLUDED.total,
          errors=panthorium_insights_counters.errors+EXCLUDED.errors,denied=panthorium_insights_counters.denied+EXCLUDED.denied,slow=panthorium_insights_counters.slow+EXCLUDED.slow`,
        [item.userId,item.day,item.feature,item.total,item.errors,item.denied,item.slow]);
      }
    });
  }
  async aggregate() {
    this.assertReady();
    // Suppress small cohorts separately for every feature. No account identifiers or
    // raw URLs leave this repository for model processing.
    return (await this.pool.query(`SELECT feature,COUNT(DISTINCT user_id)::int AS accounts,SUM(total)::int AS total,
      SUM(errors)::int AS errors,SUM(denied)::int AS denied,SUM(slow)::int AS slow
      FROM panthorium_insights_counters JOIN panthorium_insights_preferences USING(user_id)
      WHERE enabled=TRUE AND day >= CURRENT_DATE - 7 GROUP BY feature HAVING COUNT(DISTINCT user_id)>=5 ORDER BY SUM(total) DESC LIMIT 20`)).rows;
  }
  async recordIncident(alert, family) {
    this.assertReady();
    const severity = alert.level === 'critical' ? 3 : 2;
    const dedupe = hash([family, alert.ip, Math.floor(Date.now()/3600000)]);
    return (await this.pool.query(`INSERT INTO panthorium_insights_incidents(id,dedupe,family,code,ip,severity,count)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe) DO UPDATE SET
      code=CASE WHEN EXCLUDED.severity >= panthorium_insights_incidents.severity THEN EXCLUDED.code ELSE panthorium_insights_incidents.code END,
      revision=panthorium_insights_incidents.revision+CASE WHEN EXCLUDED.severity>panthorium_insights_incidents.severity THEN 1 ELSE 0 END,
      plan=CASE WHEN EXCLUDED.severity>panthorium_insights_incidents.severity THEN NULL ELSE panthorium_insights_incidents.plan END,
      severity=GREATEST(panthorium_insights_incidents.severity,EXCLUDED.severity),
      count=EXCLUDED.count,last_seen=NOW() RETURNING *`, [randomUUID(),dedupe,family,alert.code,alert.ip,severity,alert.count])).rows[0];
  }
  async incidents() { this.assertReady(); return (await this.pool.query("SELECT * FROM panthorium_insights_incidents WHERE first_seen>NOW()-INTERVAL '30 days' ORDER BY last_seen DESC LIMIT 50")).rows; }
  async incident(id) { this.assertReady(); return (await this.pool.query('SELECT * FROM panthorium_insights_incidents WHERE id=$1', [id])).rows[0] || null; }
  async savePlan(incident, plan) {
    const saved=(await this.pool.query("UPDATE panthorium_insights_incidents SET plan=$3::jsonb WHERE id=$1 AND revision=$2 AND state='observed' AND (plan IS NULL OR (plan->>'expiresAt')::timestamptz<=NOW()) RETURNING *", [incident.id,incident.revision,JSON.stringify(plan)])).rows[0];
    return saved || this.incident(incident.id);
  }
  async enqueue(incident, recipientId, kind, payload) {
    const id = hash([incident.id, incident.revision, recipientId, kind]);
    await this.pool.query('INSERT INTO panthorium_insights_outbox(id,incident_id,user_id,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING', [id,incident.id,recipientId,JSON.stringify({...payload,sourceId:id})]);
  }
  async pendingNotices() { return (await this.pool.query('SELECT * FROM panthorium_insights_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 20')).rows; }
  async delivered(id) { await this.pool.query('UPDATE panthorium_insights_outbox SET delivered_at=NOW() WHERE id=$1', [id]); }
  async claimAnalysis() {
    return (await this.pool.query("UPDATE panthorium_insights_control SET next_analysis=NOW()+INTERVAL '30 minutes',worker_status='analyzing' WHERE id=1 AND enabled=TRUE AND next_analysis<=NOW() RETURNING *")).rows[0];
  }
  async finishAnalysis(control, report, status) {
    return (await this.pool.query(`UPDATE panthorium_insights_control SET report=COALESCE($2::jsonb,report),
      report_at=CASE WHEN $2::jsonb IS NULL THEN report_at ELSE NOW() END,worker_status=$3,
      next_analysis=NOW()+CASE WHEN $2::jsonb IS NULL THEN INTERVAL '2 minutes' ELSE INTERVAL '30 minutes' END
      WHERE id=1 AND enabled=TRUE AND generation=$1 RETURNING id`, [control.generation,report ? JSON.stringify(report) : null,status])).rowCount>0;
  }
  async cleanup() {
    await this.pool.query("DELETE FROM panthorium_insights_counters WHERE day<CURRENT_DATE-30; DELETE FROM panthorium_insights_incidents WHERE first_seen<NOW()-INTERVAL '30 days'; UPDATE panthorium_insights_control SET report=NULL,report_at=NULL WHERE report_at<NOW()-INTERVAL '7 days'");
  }
}
module.exports = { LocalInsightsRepository, hash, iso };
