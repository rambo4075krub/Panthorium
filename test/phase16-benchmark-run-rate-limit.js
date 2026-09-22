const assert = require('node:assert/strict');
const express = require('express');
const { AuthService } = require('../services/authService');
const { createTrainingRouter } = require('../routes/training');

// Regression guard: POST /api/training/benchmark/run fans out to every paid
// provider for up to 20 cases. Single-flight and cooldown only collapse
// identical payloads, so the route must also stay rate limited to bound cost
// when each request carries different cases.
process.env.SENTINEL_BENCHMARK_RATE_LIMIT = '3';

(async () => {
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'benchmark-rate-limit-secret', accessTokenTtl: '1h' }, audit });
  const admin = { id: 'admin-test', roles: ['administrator'], permissions: ['settings'] };
  let runs = 0;
  const benchmark = {
    status: () => ({ ok: true }),
    run: async () => { runs++; return { ok: true, runId: `run-${runs}`, leaderboard: [], cases: [] }; }
  };
  const training = { list: async () => ({ ok: true, examples: [] }) };

  const app = express();
  app.use(express.json());
  app.set('trust proxy', false);
  app.use('/api/training', createTrainingRouter(auth, training, benchmark, null));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = auth.signAccessToken(admin);
  const call = (i) => fetch(`${base}/api/training/benchmark/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cases: [{ prompt: `unique prompt ${i}` }], providers: ['a', 'b'] })
  });

  try {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await call(i)).status);
    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200], 'admin must get the configured budget of real runs');
    assert.equal(statuses[3], 429, 'distinct payloads beyond the budget must be rate limited');
    assert.equal(statuses[4], 429, 'rate limit must stay closed inside the window');
    assert.equal(runs, 3, 'rate limited requests must never reach the paid providers');

    const unauthorized = await fetch(`${base}/api/training/benchmark/run`, { method: 'POST' });
    assert.equal(unauthorized.status, 401, 'benchmark run must stay behind authentication');
    console.log('Phase 16 benchmark run rate limit tests passed');
  } finally {
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
