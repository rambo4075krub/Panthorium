const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createKnowledgeRouter(authService, knowledge) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

  router.get('/', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const out = await knowledge.list({ user: req.user, limit: Number(req.query.limit) || 50 });
      res.status(out.ok ? 200 : out.error === 'knowledge_requires_account' ? 403 : 400).json(out);
    } catch (error) { next(error); }
  });

  router.post('/', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const { title, content, source, metadata } = req.body || {};
      const out = await knowledge.ingest({ user: req.user, title, content, source, metadata, requestId: req.requestId });
      res.status(out.ok ? 201 : out.error === 'knowledge_requires_account' ? 403 : 400).json(out);
    } catch (error) { next(error); }
  });

  router.get('/search', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const out = await knowledge.search({ user: req.user, query: req.query.q, limit: Number(req.query.limit) || 8, requestId: req.requestId });
      res.status(out.ok ? 200 : out.error === 'knowledge_requires_account' ? 403 : 400).json(out);
    } catch (error) { next(error); }
  });

  router.get('/:documentId', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const out = await knowledge.get({ user: req.user, documentId: req.params.documentId });
      const status = out.ok ? 200 : out.error === 'knowledge_not_found' ? 404 : out.error === 'knowledge_requires_account' ? 403 : 400;
      res.status(status).json(out);
    } catch (error) { next(error); }
  });

  router.delete('/:documentId', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const out = await knowledge.remove({ user: req.user, documentId: req.params.documentId, requestId: req.requestId });
      const status = out.ok ? 200 : out.error === 'knowledge_not_found' ? 404 : out.error === 'knowledge_requires_account' ? 403 : 400;
      res.status(status).json(out);
    } catch (error) { next(error); }
  });

  return router;
}
module.exports = { createKnowledgeRouter };
