'use strict';

// Uses only the dedicated, disposable PostgreSQL database supplied by CI.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
if (!process.env.DATABASE_POOL_TEST_URL) throw new Error('DATABASE_POOL_TEST_URL is required (disposable test database)');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'pool-integration-test-only-jwt-secret';
process.env.DATABASE_URL = process.env.DATABASE_POOL_TEST_URL;
process.env.DATABASE_SSL_MODE = 'disable';
process.env.DB_POOL_MAX = '2';
process.env.DB_POOL_CONNECTION_TIMEOUT_MS = '500';
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.SENTINEL_AUTO_TRAINING = '0';
process.env.PANTHORIUM_GOVERNANCE_MODE = 'off';
process.env.PANTHORIUM_SENTINEL_CONTROL_MODE = 'off';
for (const name of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'ADMIN_PASSWORD']) delete process.env[name];
const directory = mkdtempSync(join(tmpdir(), 'panthorium-pool-test-'));
process.env.AUDIT_FILE = join(directory, 'audit.log');
process.env.DATA_FILE = join(directory, 'data.json');
const runtime = require('../server');
const { getDatabasePool, closeDatabasePools } = require('../services/databasePool');
const { once } = require('node:events');

(async () => {
  const observer = new Client({ connectionString: process.env.DATABASE_POOL_TEST_URL, application_name: 'pool-test-observer' });
  let server;
  try {
    await observer.connect();
    server = await runtime.start();
    if (!server.listening) await once(server, 'listening');
    runtime.agentScheduler.stop();
    const pool = getDatabasePool({ connectionString: process.env.DATABASE_URL, ssl: false });
    const consumers = [
      runtime.authService.repository, runtime.conversations, runtime.aiOperations.audit,
      runtime.securityResponse, runtime.agentRuns, runtime.agentPending, runtime.agentJobs,
      runtime.agentAutomationRepository, runtime.agentKnowledgeRepository, runtime.agentMemoryRepository,
      runtime.multiAgentRuns, runtime.integrationRepository, runtime.integrations.executions,
      runtime.autonomousGovernance.production, runtime.sentinelTrainingRepository, runtime.sentinelLearningRepository,
      runtime.sentinelBenchmark, runtime.sentinelActiveLearning, runtime.autonomousGovernance, runtime.sentinelOrchestrator
    ];
    for (const consumer of consumers) assert.equal(consumer?.pool, pool, 'every database module must borrow the shared pool after boot');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(response.status, 200, 'full PostgreSQL startup must reach HTTP readiness');

    const held = await Promise.all([pool.connect(), pool.connect()]);
    try {
      await assert.rejects(runtime.conversations.listSessions('test-user'), /timeout/i);
    } finally {
      for (const client of held) client.release();
    }
    // After an exhausted queue times out, releasing clients must restore service.
    await runtime.conversations.listSessions('test-user');

    // Run queries from all modules at once. Check the actual PostgreSQL sessions.
    const queries = consumers.map((consumer) => consumer.pool.query('SELECT pg_sleep(0.01)'));
    const { rows } = await observer.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'panthorium-backend'");
    await Promise.all(queries);
    assert.ok(rows[0].count <= 2 && pool.totalCount <= 2, 'all modules together must stay within the process connection budget');

    // Exercise an actual transaction error, rollback, and client release.
    await assert.rejects(runtime.agentKnowledgeRepository.create({ userId: null, title: 'invalid', chunks: [] }), /null/i);
    assert.equal(await runtime.authService.repository.consumeRefreshToken('missing-token'), null);
    assert.equal(pool.waitingCount, 0);

    const idle = await pool.connect();
    const pid = idle.processID;
    idle.release();
    const idleError = once(pool, 'error');
    await observer.query('SELECT pg_terminate_backend($1)', [pid]);
    await idleError;
    await pool.query('SELECT 1');
    console.log('Database pool integration passed: 20 modules, full boot, bounded connections, queue recovery, rollback, idle disconnect');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeDatabasePools();
    if (observer._connected) {
      let connections;
      for (let attempt = 0; attempt < 20; attempt++) {
        const { rows } = await observer.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'panthorium-backend'");
        connections = rows[0].count;
        if (connections === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(connections, 0, 'shutdown must release all application connections');
    }
    await observer.end();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
