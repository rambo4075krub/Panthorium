'use strict';

const { Pool } = require('pg');

// One pool per database/TLS configuration in this Node process. Repositories
// borrow it; only the process shutdown path owns pool.end().
const pools = new Map();

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function getDatabasePool({ connectionString, ssl } = {}) {
  if (!connectionString) return null;
  const key = JSON.stringify([connectionString, ssl]);
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl,
      max: positiveInteger('DB_POOL_MAX', 2),
      idleTimeoutMillis: positiveInteger('DB_POOL_IDLE_TIMEOUT_MS', 10000),
      connectionTimeoutMillis: positiveInteger('DB_POOL_CONNECTION_TIMEOUT_MS', 5000),
      application_name: 'panthorium-backend'
    });
    // pg discards the failed idle client. Handle the event without logging
    // connection strings, passwords, or query data.
    pool.on('error', (error) => {
      const code = String(error.code || 'unknown').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
      console.error(`[DB POOL] idle connection failed (${code})`);
    });
    pools.set(key, pool);
  }
  return pool;
}

async function closeDatabasePools() {
  const active = [...pools.values()];
  await Promise.all(active.map((pool) => pool.end()));
  pools.clear();
}

module.exports = { getDatabasePool, closeDatabasePools };
