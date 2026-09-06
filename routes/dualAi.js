'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createDualAiRouter(authService, dualAi) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const admin = [auth, requirePermission('settings')];
  const readLimiter = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 60000, limit: 12, standardHeaders: true, legacyHeaders: false });

  router.get('/status', ...admin, readLimiter, async (req, res, next) => {
    try {
      if (!dualAi) return res.status(503).json({ ok: false, error: 'dual_ai_unavailable' });
      res.json(await dualAi.status());
    } catch (error) {
      next(error);
    }
  });

  router.get('/frontier', ...admin, readLimiter, async (req, res, next) => {
    try {
      if (!dualAi) return res.status(503).json({ ok: false, error: 'dual_ai_unavailable' });
      const status = await dualAi.status();
      res.json({ ok: true, frontier: status.frontier, architecturePatterns: status.architecturePatterns, learningChannels: status.learningChannels, boundaries: status.boundaries });
    } catch (error) {
      next(error);
    }
  });

  router.get('/history', ...admin, readLimiter, async (req, res, next) => {
    try {
      if (!dualAi) return res.status(503).json({ ok: false, error: 'dual_ai_unavailable' });
      res.json({ ok: true, history: await dualAi.history({ limit: req.query.limit }) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/cycle', ...admin, writeLimiter, async (req, res, next) => {
    try {
      if (!dualAi) return res.status(503).json({ ok: false, error: 'dual_ai_unavailable' });
      res.json(await dualAi.cycle({ execute: req.body?.execute === true, persist: true, source: req.body?.source || 'manual-cycle', scope: req.body?.scope || 'dual-ai-manual' }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/mode', ...admin, writeLimiter, async (req, res, next) => {
    try {
      if (!dualAi) return res.status(503).json({ ok: false, error: 'dual_ai_unavailable' });
      res.json(await dualAi.setMode(req.body?.mode, { userId: req.user?.sub || 'administrator', requestId: req.requestId }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createDualAiRouter };
