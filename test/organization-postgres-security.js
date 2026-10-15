'use strict';

const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { OrganizationRepository } = require('../services/organizationRepository');
const { runSecurityScenarios } = require('./organization-integration-security');

async function main() {
  // Never fall back to DATABASE_URL: only an explicitly selected disposable
  // database may host this test. Each invocation also isolates its own schema.
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (process.env.CI) throw new Error('TEST_DATABASE_URL is required for organization PostgreSQL integration in CI');
    console.log('SKIP organization PostgreSQL integration: TEST_DATABASE_URL is not set. No real database concurrency was tested.');
    return;
  }
  const schema = 'panthorium_org_ci_' + randomBytes(10).toString('hex');
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const pools = [];
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (let i = 0; i < 2; i++) pools.push(new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema},public -c statement_timeout=15000 -c lock_timeout=10000`, application_name: 'panthorium-org-integration-' + i }));
    const versions = await pools[0].query('SHOW server_version_num');
    assert(Number(versions.rows[0].server_version_num) >= 120000, 'This gate requires PostgreSQL 12 or later');
    const pids = await Promise.all(pools.map(pool => pool.query('SELECT pg_backend_pid() AS id')));
    assert.notEqual(pids[0].rows[0].id, pids[1].rows[0].id, 'Independent instances must use distinct PostgreSQL connections');
    const repositories = pools.map(pool => new OrganizationRepository({ pool, required: true }));
    for (const repository of repositories) await repository.init();
    await runSecurityScenarios(repositories);

    // The creator quota also needs a database lock across workers. A race may
    // create three organizations in total, never three per application instance.
    const creator = randomUUID();
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => {
      const id = randomUUID();
      return repositories[i % 2].createOrganization({ id, name: 'Creator limit race', profile: 'micro', status: 'active', policy: {} },
        { id: creator, userId: creator, role: 'owner', status: 'active', clearance: 'internal', compartments: [] });
    }));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 3);
    assert(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'org_creation_limit'));
    const saved = await pools[1].query('SELECT COUNT(*) AS count FROM panthorium_organizations WHERE creator_id=$1', [creator]);
    assert.equal(Number(saved.rows[0].count), 3);
    const audit = await pools[1].query("SELECT COUNT(*) AS count FROM panthorium_org_entities WHERE kind='audit' AND data->>'event'='test.audit_capacity'");
    assert.equal(Number(audit.rows[0].count), 2001, 'The audit-capacity fix must retain history rather than silently evict it');
    console.log('Organization PostgreSQL integration passed across independent repositories/pools: tenant isolation, approval races, fresh membership/ACL/policy, late AI denial, last-owner preservation, rollback, creator quota and append-only audit beyond the former capacity limit.');
  } finally {
    const closed = await Promise.allSettled(pools.map(pool => pool.end()));
    let cleanupError = closed.find(result => result.status === 'rejected')?.reason;
    try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    catch (error) { cleanupError ||= error; }
    finally { await admin.end(); }
    if (cleanupError) throw cleanupError;
  }
}
main().catch(error => { console.error('Organization PostgreSQL integration failed:', error.message); process.exitCode = 1; });
