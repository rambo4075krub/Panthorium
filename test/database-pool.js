'use strict';

const assert = require('node:assert/strict');
const { getDatabasePool, closeDatabasePools } = require('../services/databasePool');

(async () => {
  delete process.env.DB_POOL_MAX;
  delete process.env.DB_POOL_IDLE_TIMEOUT_MS;
  delete process.env.DB_POOL_CONNECTION_TIMEOUT_MS;
  const options = { connectionString: 'postgresql://test:unused@127.0.0.1/pool_test', ssl: false };
  assert.equal(getDatabasePool(), null);
  const pool = getDatabasePool(options);
  assert.equal(pool.options.max, 2);
  assert.equal(pool.options.connectionTimeoutMillis, 5000);
  assert.equal(pool.totalCount, 0, 'constructing repositories must not eagerly connect');

  const { ConversationRepository } = require('../services/conversationRepository');
  const { AgentKnowledgeRepository } = require('../services/agentKnowledgeRepository');
  const { createAuthRepository } = require('../repositories/authRepository');
  const config = { databaseUrl: options.connectionString, databaseSslMode: 'disable' };
  const consumers = [new ConversationRepository(config), new AgentKnowledgeRepository(config), createAuthRepository(config)];
  for (const consumer of consumers) assert.equal(consumer.pool, pool);
  assert.equal(new ConversationRepository().pool, null);

  const tls = { ...options, ssl: { rejectUnauthorized: false } };
  assert.notEqual(getDatabasePool(tls), pool, 'TLS settings must not be shared across incompatible clients');
  assert.equal(getDatabasePool({ ...tls, ssl: { rejectUnauthorized: false } }), getDatabasePool(tls));
  assert.notEqual(getDatabasePool({ ...options, connectionString: options.connectionString + '_other' }), pool);
  await closeDatabasePools();
  assert.equal(pool.ended, true);

  for (const name of ['DB_POOL_MAX', 'DB_POOL_IDLE_TIMEOUT_MS', 'DB_POOL_CONNECTION_TIMEOUT_MS']) {
    for (const value of ['0', '-1', '1.5', 'NaN']) {
      process.env[name] = value;
      assert.throws(() => getDatabasePool(options), new RegExp(name));
    }
    delete process.env[name];
  }
  process.env.DB_POOL_MAX = '3';
  const configured = getDatabasePool(options);
  assert.equal(configured.options.max, 3);
  assert.notEqual(configured, pool);
  await closeDatabasePools();
  console.log('Database pool unit tests passed');
})().catch(async (error) => { console.error(error); await closeDatabasePools(); process.exitCode = 1; });
