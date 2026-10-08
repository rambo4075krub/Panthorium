'use strict';

const assert = require('node:assert/strict');
const { ProductionIntelligenceService } = require('../services/productionIntelligenceService');

async function main() {
  const names = [
    'NODE_ENV', 'AI_PRIORITY', 'SENTINEL_VERTEX_PROJECT_ID',
    'SENTINEL_VERTEX_MODEL', 'SENTINEL_VERTEX_ENDPOINT_ID',
    'SENTINEL_VERTEX_TUNING_JOB_ID'
  ];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = 'production';
    process.env.AI_PRIORITY = 'vertex';
    process.env.SENTINEL_VERTEX_PROJECT_ID = 'test-project';
    process.env.SENTINEL_VERTEX_MODEL = 'sentinel-v4';
    process.env.SENTINEL_VERTEX_ENDPOINT_ID = 'test-endpoint';
    delete process.env.SENTINEL_VERTEX_TUNING_JOB_ID;

    const service = new ProductionIntelligenceService({ databaseUrl: '' });
    service.databaseProbe = async () => ({ ok: true, mode: 'postgresql', latencyMs: 1 });
    service.storage = { probe: async () => ({ ok: true }) };

    let result = await service.readiness();
    assert.equal(result.ok, true);
    assert.deepEqual(result.checks, { database: true, storage: true, vertex: true });
    assert.equal(JSON.stringify(result).includes('test-project'), false);

    service.storage = { probe: async () => ({ ok: false, reason: 'files_storage_permission_denied' }) };
    result = await service.readiness();
    assert.equal(result.ok, false);
    assert.equal(result.status, 'not_ready');
    assert.equal(result.checks.storage, false);

    service.databaseProbe = async () => ({ ok: false, mode: 'postgresql', error: 'database_unavailable' });
    result = await service.readiness();
    assert.equal(result.checks.database, false);
    assert.equal(result.ok, false);

    process.env.SENTINEL_VERTEX_MODEL = 'sentinel-v3';
    service.databaseProbe = async () => ({ ok: true, mode: 'postgresql', latencyMs: 1 });
    service.storage = { probe: async () => ({ ok: true }) };
    result = await service.readiness();
    assert.equal(result.checks.vertex, false);
    assert.equal(result.ok, false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

main().then(() => console.log('production readiness tests passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
