'use strict';
const { canonicalIp } = require('./securityIp');
const { createHash } = require('node:crypto');

// Run once per database, in a transaction. Preserve audit records and retain the
// longest block when several historical spellings identify the same address.
async function migrateSecurityIps(pool, kind) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('security-ip-canonical-v1',0))");
    await c.query('CREATE TABLE IF NOT EXISTS panthorium_security_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const name = 'canonical-ip-v1-' + kind;
    if (!(await c.query('SELECT 1 FROM panthorium_security_migrations WHERE name=$1', [name])).rowCount) {
      if (kind === 'audit') {
        const rows = (await c.query('SELECT DISTINCT ip FROM panthorium_audit_events WHERE ip IS NOT NULL')).rows;
        for (const row of rows) {
          const ip = canonicalIp(row.ip);
          if (!ip || ip === row.ip) continue;
          await c.query('UPDATE panthorium_audit_events SET ip=$2 WHERE ip=$1', [row.ip, ip]);
          for (const code of ['LOGIN_BRUTE_FORCE','LOGIN_FAILURE_SPIKE','AUTH_DENIED_FLOOD','AUTH_DENIED_SPIKE','RATE_LIMIT_PRESSURE']) {
            const hash = value => createHash('sha256').update(code + '|' + value).digest('hex').slice(0,24);
            await c.query(`INSERT INTO panthorium_security_alert_acknowledgements(alert_id,acknowledged_at,acknowledged_by,expires_at)
              SELECT $2,acknowledged_at,acknowledged_by,expires_at FROM panthorium_security_alert_acknowledgements WHERE alert_id=$1
              ON CONFLICT (alert_id) DO UPDATE SET expires_at=GREATEST(panthorium_security_alert_acknowledgements.expires_at,EXCLUDED.expires_at)`, [hash(row.ip),hash(ip)]);
          }
        }
      } else if (kind === 'blocks') {
        const rows = (await c.query('SELECT * FROM panthorium_security_ip_blocks FOR UPDATE')).rows;
        for (const row of rows) {
          const ip = canonicalIp(row.ip);
          if (!ip || ip === row.ip) continue;
          await c.query(`INSERT INTO panthorium_security_ip_blocks(ip,reason,source,created_at,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(ip) DO UPDATE SET expires_at=GREATEST(panthorium_security_ip_blocks.expires_at,EXCLUDED.expires_at),source='migrated'`, [ip,row.reason,row.source,row.created_at,row.expires_at,row.created_by]);
          await c.query('DELETE FROM panthorium_security_ip_blocks WHERE ip=$1', [row.ip]);
        }
      } else throw new Error('unknown_ip_migration');
      await c.query('INSERT INTO panthorium_security_migrations(name) VALUES($1)', [name]);
    }
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}
module.exports = { migrateSecurityIps };
