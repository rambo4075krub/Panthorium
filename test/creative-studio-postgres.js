'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { PostgresCreativeStudioRepository } = require('../services/creativeStudioRepository');

(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (process.env.CI) throw Error('TEST_DATABASE_URL required for the Studio PostgreSQL gate');
    console.log('SKIP real Studio PostgreSQL concurrency: TEST_DATABASE_URL not set');
    return;
  }
  const schema = 'studio_ci_' + crypto.randomBytes(10).toString('hex');
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool, created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    pool = new Pool({ connectionString, max: 12, options: `-c search_path=${schema},public -c statement_timeout=15000` });
    const repository = new PostgresCreativeStudioRepository({ pool }); await repository.init();
    const ownerId = crypto.randomUUID(), other = crypto.randomUUID();
    const input = { id: crypto.randomUUID(), ownerId, idempotencyKey: 'concurrent-studio-job', fingerprint: 'same-payload', status: 'queued', currentStep: 0, files: [], steps: [{ pluginId: 'document', status: 'queued', input: { prompt: 'ทดสอบ' } }] };
    const results = await Promise.all(Array.from({ length: 12 }, () => repository.create({ ...input, id: crypto.randomUUID() })));
    assert.equal(results.filter(value => value.created).length, 1, 'one create winner across database clients');
    assert.equal(new Set(results.map(value => value.job.id)).size, 1);
    const id = results[0].job.id;
    const claimed = await Promise.all(Array.from({ length: 12 }, () => repository.claim(ownerId, id)));
    const winner = claimed.find(Boolean);
    assert.equal(claimed.filter(Boolean).length, 1, 'one lease winner across database clients');
    assert.equal(await repository.get(other, id), null);
    await repository.save(winner, { release: true, delayMs: 30000 });
    assert.equal(await repository.claim(ownerId, id), null, 'manual advance respects persisted backoff');
    await pool.query("UPDATE panthorium_studio_jobs SET next_run_at=NOW()-INTERVAL '1 second' WHERE id=$1", [id]);
    const resumed = await new PostgresCreativeStudioRepository({ pool }).claim(ownerId, id);
    assert.ok(resumed);
    await assert.rejects(repository.save({ ...winner, status: 'completed' }), /studio_lease_lost/);
    resumed.status = 'completed'; await repository.save(resumed, { release: true });
    assert.equal(await repository.claim(ownerId, id), null);
    await repository.setMode(ownerId, 'image', 'never');
    assert.equal((await new PostgresCreativeStudioRepository({ pool }).modes(ownerId)).image, 'never');
    assert.deepEqual(await repository.modes(other), {});
    const limited = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => repository.create({ ...input, id: crypto.randomUUID(), idempotencyKey: 'parallel-cap-' + index })));
    assert.equal(limited.filter(value => value.status === 'fulfilled').length, 2, 'active-job cap is atomic across simultaneous submissions');
    assert.ok(limited.filter(value => value.status === 'rejected').every(value => value.reason.code === 'studio_active_limit'));
    console.log('PASS real PostgreSQL Studio: concurrent idempotency, leases, backoff, stale-worker rejection and account policies');
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
