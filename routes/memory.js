const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createMemoryRouter(authService, memory) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

  router.get('/', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const out = await memory.list({ user: req.user, limit: Number(req.query.limit) || 30, kind: req.query.kind });
      res.status(out.ok ? 200 : 403).json(out);
    } catch (error) { next(error); }
  });

  router.post('/', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const { kind, title, content, tags, source, importance } = req.body || {};
      const out = await memory.remember({ user: req.user, kind, title, content, tags, source, importance, requestId: req.requestId });
      const status = out.ok ? 201 : out.error === 'memory_requires_account' ? 403 : 400;
      res.status(status).json(out);
    } catch (error) { next(error); }
  });

  router.post('/search', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const { query, limit } = req.body || {};
      const out = await memory.search({ user: req.user, query, limit, requestId: req.requestId });
      res.status(out.ok ? 200 : out.error === 'memory_requires_account' ? 403 : 400).json(out);
    } catch (error) { next(error); }
  });

  router.post('/context', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const { query, limit } = req.body || {};
      const out = await memory.context({ user: req.user, query, limit });
      res.status(out.ok ? 200 : out.error === 'memory_requires_account' ? 403 : 400).json(out);
    } catch (error) { next(error); }
  });

  router.delete('/:memoryId', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const out = await memory.remove({ user: req.user, memoryId: req.params.memoryId, requestId: req.requestId });
      const status = out.ok ? 200 : out.error === 'memory_not_found' ? 404 : out.error === 'memory_requires_account' ? 403 : 400;
      res.status(status).json(out);
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createMemoryRouter };