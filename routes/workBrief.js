'use strict';
const { Router } = require('express');
const { STATUS_CODES } = require('node:http');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function problem(res, status, code) {
  // Keep the established error key for existing Panthorium API clients.
  return res.status(status).type('application/problem+json').json({ type: 'about:blank', title: STATUS_CODES[status], status, error: code, ok: false });
}
function createWorkBriefRouter(auth, service) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(rateLimit({ windowMs: 60000, limit: 90, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => problem(res, 429, 'brief_rate_limited') }));
  router.use(requireAuth(auth, problem), requirePermission('chat', problem));
  router.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) return problem(res, 415, 'brief_json_required');
    next();
  });
  const run = fn => async (req, res, next) => {
    try { res.json({ ok: true, ...await fn(req) }); } catch (e) { next(e); }
  };
  router.get('/access', run(req => service.access(req.user)));
  router.get('/board', run(req => service.board(req.user)));
  router.get('/:id/handover', run(req => service.handover(req.user, req.params.id)));
  for (const action of ['baseline', 'reviews', 'quotes', 'status']) {
    router.post('/:id/' + action, run(req => service.change({ user: req.user, projectId: req.params.id, action, body: req.body })));
  }
  router.use((_req, res) => problem(res, 404, 'brief_route_not_found'));
  router.use((e, _req, res, next) => {
    if (res.headersSent) return next(e);
    const known = Number.isInteger(e.status) && e.status >= 400 && e.status < 600 && /^[a-z][a-z0-9_]+$/.test(e.code || '');
    problem(res, known ? e.status : 500, known ? e.code : 'brief_unavailable');
  });
  return router;
}
function bodyProblem(e, _req, res, next) {
  if (e.type === 'entity.parse.failed' || e.type === 'entity.too.large') {
    res.set('Cache-Control', 'private, no-store');
    return problem(res, e.type === 'entity.too.large' ? 413 : 400, 'brief_invalid_request');
  }
  next(e);
}
module.exports = { createWorkBriefRouter, bodyProblem };
