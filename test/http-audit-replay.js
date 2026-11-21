'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
const { AuditService } = require('../services/auditService');
const { closeDatabasePools } = require('../services/databasePool');

async function until(check) {
  const end = Date.now() + 8000;
  while (!await check()) {
    assert(Date.now() < end, 'HTTP audit replay timed out');
    await delay(15);
  }
}

async function run() {
  assert(process.env.TEST_DATABASE_URL, 'test database required');
  const url = new URL(process.env.TEST_DATABASE_URL);
  const schema = 'http_audit_' + randomUUID().replaceAll('-', '');
  const root = new Pool({connectionString: url.href});
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pt-audit-'));
  url.searchParams.set('options', '-c search_path=' + schema);
  const options = {file: path.join(dir, 'audit.log'), databaseUrl: url.href};
  const first = new AuditService(options);
  const second = new AuditService(options);
  try {
    await root.query('CREATE SCHEMA ' + schema);
    await first.init();
    const persist = first.persist.bind(first);
    let failBeforeCommit = true;
    let attempts = 0;
    first.persist = async rows => {
      attempts++;
      if (failBeforeCommit) throw new Error('offline fixture');
      await persist(rows);
      throw new Error('lost acknowledgement fixture');
    };
    const requests = Array.from({length: 300}, () =>
      first.record('http.request', {requestId: 'same-client-id', path: '/', status: 200}, {journalHttp: true}));
    await Promise.all(requests);
    await until(() => attempts > 0);
    assert.equal(first.httpQueue.stats().pending, requests.length);
    failBeforeCommit = false;
    await until(async () => (await first.pool.query('SELECT 1 FROM panthorium_audit_events LIMIT 1')).rowCount);
    await first.close();
    await second.init();
    await until(() => second.httpQueue.stats().pending === 0);
    const {rows} = await second.pool.query('SELECT count(*)::int AS total, count(DISTINCT event_id)::int AS ids FROM panthorium_audit_events');
    assert.deepEqual(rows[0], {total:300, ids:300});
    const entries = (await fs.readFile(options.file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(new Set(entries.map(e => e.eventId)).size, 300);
    assert.equal((await second.pool.query('SELECT 1 FROM panthorium_audit_events WHERE event_id=ANY($1::uuid[])', [entries.map(e=>e.eventId)])).rowCount,300);
    console.log('HTTP audit replay: 300 distinct events survived database failure, lost commit acknowledgement and journal reopen');
  } finally {
    await first.close();
    await second.close();
    await closeDatabasePools();
    await root.query('DROP SCHEMA ' + schema + ' CASCADE');
    await root.end();
    await fs.rm(dir,{recursive:true,force:true});
  }
}
run().catch(error => { console.error(error); process.exitCode=1; });
