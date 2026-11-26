'use strict';
const { Router } = require('express');

// Share a dependency check across simultaneous probes. A stalled check can never
// create a growing queue of database or storage requests.
function createHealthProbes(check, { timeoutMs = 5000, ttlMs = 1000 } = {}) {
  const router = Router();
  let draining = false, pending, cached, validUntil = 0;
  const unavailable = { ok: false, status: 'not_ready' };
  function readiness() {
    if (draining) return unavailable;
    if (pending) return pending;
    if (Date.now() < validUntil) return cached;
    let timer;
    const work = Promise.resolve().then(check).then(result => result?.ok === true ? { ok: true, status: 'ready' } : unavailable, () => unavailable);
    pending = Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve(unavailable), timeoutMs); })]);
    work.then(result => { clearTimeout(timer); cached = result; validUntil = Date.now() + ttlMs; pending = null; });
    return pending;
  }
  router.get('/health/live', (_req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, status: 'alive' }));
  router.get(['/health', '/health/ready'], async (_req, res) => {
    const result = await readiness();
    const body = draining ? unavailable : result;
    res.set('Cache-Control', 'no-store').status(body.ok ? 200 : 503).json(body);
  });
  return { router, drain() { draining = true; } };
}
module.exports = { createHealthProbes };
