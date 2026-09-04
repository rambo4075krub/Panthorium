const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate: uuidValidate } = require('uuid');
const { requireAuth, requirePermission } = require('../middleware/auth');

function validText(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }

function createOrchestrationRouter(authService, multiAgent) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const chat = requirePermission('chat');
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  router.get('/roles', auth, chat, limiter, (req, res) => {
    const result = multiAgent.listRoles(req.user);
    res.status(result.ok ? 200 : 403).json(result);
  });

  router.get('/runs', auth, chat, limiter, async (req, res, next) => {
    try { res.json(await multiAgent.history(req.user, Number(req.query.limit) || 30)); }
    catch (error) { next(error); }
  });

  router.get('/runs/:orchestrationId', auth, chat, limiter, async (req, res, next) => {
    try {
      if (!uuidValidate(req.params.orchestrationId)) return res.status(400).json({ ok: false, error: 'invalid_orchestration_id' });
      const result = await multiAgent.get(req.user, req.params.orchestrationId);
      res.status(result.ok ? 200 : 404).json(result);
    } catch (error) { next(error); }
  });

  router.post('/run', auth, chat, limiter, async (req, res, next) => {
    try {
      const { request, message, roles, provider } = req.body || {};
      const input = request || message;
      if (!validText(input, 4000)) return res.status(400).json({ ok: false, error: 'invalid_multi_agent_request' });
      if (roles != null && !Array.isArray(roles)) return res.status(400).json({ ok: false, error: 'invalid_multi_agent_roles' });
      if (provider != null && !validText(provider, 40)) return res.status(400).json({ ok: false, error: 'invalid_provider' });
      const result = await multiAgent.run({ user: req.user, request: input, roles, provider, requestId: req.requestId });
      if (result.status === 'waiting_confirmation') return res.status(409).json(result);
      res.status(result.ok ? 200 : 422).json(result);
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createOrchestrationRouter };
