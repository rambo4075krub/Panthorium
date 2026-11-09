'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { only } = require('../services/workAssistantService');
const { error } = require('../services/workAssistantRepository');

function createWorkAssistantRouter(authService, service) {
  const router = express.Router();
  router.use(requireAuth(authService), requirePermission('chat'));
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(rateLimit({ windowMs: 60000, limit: 90, standardHeaders: true, legacyHeaders: false }));
  const expensive = rateLimit({ windowMs: 60000, limit: 4, standardHeaders: true, legacyHeaders: false });
  const run = handler => async (req, res, next) => { try { res.json({ ok: true, ...await handler(req, res) }); } catch (failure) { next(failure); } };
  const body = (req, keys) => { if (!only(req.body, keys)) throw error('work_invalid_request'); return req.body; };
  router.get('/', run(req => service.list({ user: req.user })));
  router.post('/import', run(req => service.importRun({ ...body(req, ['runId']), user: req.user })));
  router.get('/:projectId', run(req => service.get({ user: req.user, projectId: req.params.projectId })));
  router.put('/:projectId', run(req => service.save({ ...body(req, ['expectedVersion', 'patch', 'operationId']), user: req.user, projectId: req.params.projectId })));
  router.post('/:projectId/analyze', expensive, run(async (req, res) => {
    const input = body(req, ['expectedVersion', 'mode', 'instruction']);
    const controller = new AbortController(), abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try { return await service.analyze({ ...input, user: req.user, projectId: req.params.projectId, signal: controller.signal }); }
    finally { req.removeListener('aborted', abort); res.removeListener('close', abort); }
  }));
  router.post('/:projectId/export', run(req => service.export({ ...body(req, ['expectedVersion', 'pluginId', 'operationId']), user: req.user, projectId: req.params.projectId })));
  router.post('/:projectId/tasks', run(req => service.changeTask({ ...body(req, ['expectedVersion', 'operationId', 'taskId', 'action', 'task', 'confirmed']), user: req.user, projectId: req.params.projectId })));
  router.use((failure, req, res, next) => {
    if (res.headersSent) return next(failure);
    const status = Number(failure.status) || 500;
    res.status(status >= 400 && status <= 599 ? status : 500).json({ ok: false, error: failure.code || 'work_unavailable' });
  });
  return router;
}
module.exports = { createWorkAssistantRouter };
