'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createReleaseGateRouter(authService, releaseGate) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const admin = [auth, requirePermission('settings')];
  const limiter = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false });

  router.get('/status', ...admin, limiter, async (req, res, next) => {
    try {
      if (!releaseGate) return res.status(503).json({ ok: false, error: 'release_gate_unavailable' });
      res.json(await releaseGate.status({ record: req.query.record === 'true' }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/check', ...admin, limiter, async (req, res, next) => {
    try {
      if (!releaseGate) return res.status(503).json({ ok: false, error: 'release_gate_unavailable' });
      res.json(await releaseGate.status({ record: true }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createReleaseGateRouter };
