'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createGovernanceRouter(authService, governance) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const admin = [auth, requirePermission('settings')];
  const readLimiter = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 60000, limit: 12, standardHeaders: true, legacyHeaders: false });

  router.get('/status', ...admin, readLimiter, async (req, res, next) => {
    try {
      if (!governance) return res.status(503).json({ ok: false, error: 'governance_unavailable' });
      res.json(await governance.status({ persist: req.query.persist === 'true', execute: req.query.execute === 'true', source: 'api-status' }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/evaluate', ...admin, writeLimiter, async (req, res, next) => {
    try {
      if (!governance) return res.status(503).json({ ok: false, error: 'governance_unavailable' });
      res.json(await governance.evaluate({ persist: true, execute: req.body?.execute === true, source: req.body?.source || 'manual-evaluate' }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/history', ...admin, readLimiter, async (req, res, next) => {
    try {
      if (!governance) return res.status(503).json({ ok: false, error: 'governance_unavailable' });
      res.json({ ok: true, history: await governance.history({ limit: req.query.limit }) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/summary', ...admin, readLimiter, async (req, res, next) => {
    try {
      if (!governance) return res.status(503).json({ ok: false, error: 'governance_unavailable' });
      res.json(governance.summary());
    } catch (error) {
      next(error);
    }
  });

  router.post('/mode', ...admin, writeLimiter, async (req, res, next) => {
    try {
      if (!governance) return res.status(503).json({ ok: false, error: 'governance_unavailable' });
      res.json(await governance.setMode(req.body?.mode, { userId: req.user?.sub || 'administrator', requestId: req.requestId }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createGovernanceRouter };
