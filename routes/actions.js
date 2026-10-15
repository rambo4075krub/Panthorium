'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function statusFor(result) {
  if (result.ok) return 200;
  if (result.error === 'action_ledger_unavailable') return 503;
  if (result.error === 'action_not_found') return 404;
  if (String(result.error).includes('permission')) return 403;
  if (['action_in_progress', 'action_cancel_requested'].includes(result.error)) return 202;
  if (['action_request_conflict','action_approval_invalid','action_confirmation_expired','confirmation_required','action_outcome_unknown','action_cancelled'].includes(result.error)) return 409;
  return 400;
}
function createActionsRouter(authService, agentService) {
  const router = express.Router();
  router.use(requireAuth(authService), requirePermission('chat'));
  router.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false }));
  router.get('/', async (req, res, next) => {
    try { const result = await agentService.listActions({ user: req.user, limit: req.query.limit }); res.status(statusFor(result)).json(result); }
    catch (error) { next(error); }
  });
  router.get('/:actionId', async (req, res, next) => {
    try { const result = await agentService.getAction({ user: req.user, actionId: req.params.actionId }); res.status(statusFor(result)).json(result); }
    catch (error) { next(error); }
  });
  // Mounted behind the application's Origin checks and explicit bearer-token authentication.
  // The body cannot supply tool arguments, owner, or a model-generated "confirmed" flag.
  router.post('/:actionId/confirm', async (req, res, next) => {
    try {
      const approvalHash = req.body?.approvalHash;
      if (typeof approvalHash !== 'string' || !/^[a-f0-9]{64}$/.test(approvalHash)) return res.status(400).json({ ok: false, error: 'action_approval_invalid' });
      if (Object.keys(req.body || {}).some(key => key !== 'approvalHash')) return res.status(400).json({ ok: false, error: 'invalid_action_confirmation' });
      const result = await agentService.confirmAction({ user: req.user, actionId: req.params.actionId, approvalHash });
      res.status(statusFor(result)).json(result);
    } catch (error) { next(error); }
  });
  router.post('/:actionId/cancel', async (req, res, next) => {
    try { const result = await agentService.cancelAction({ user: req.user, actionId: req.params.actionId }); res.status(statusFor(result)).json(result); }
    catch (error) { next(error); }
  });
  return router;
}
module.exports = { createActionsRouter, statusFor };
