const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createReminderRouter(authService, reminders) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const statusFor = result => result.ok ? 200 : result.error === 'reminder_requires_account' ? 403 :
    result.error === 'reminder_email_unavailable' ? 503 :
    result.error === 'verified_email_required' ? 409 :
    result.error === 'reminder_not_found_or_already_started' ? 409 :
    result.error === 'invalid_reminder_id' ? 400 : 422;

  router.get('/', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const result = await reminders.list({ user: req.user, limit: req.query.limit });
      res.status(statusFor(result)).json(result);
    } catch (error) { next(error); }
  });
  router.post('/', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const { kind, title, details, dueAt, timeZone, emailConsent } = req.body || {};
      const result = await reminders.create({ user: req.user, kind, title, details, dueAt, timeZone, emailConsent });
      res.status(result.ok ? 201 : statusFor(result)).json(result);
    } catch (error) { next(error); }
  });
  router.delete('/:reminderId', auth, requirePermission('chat'), limiter, async (req, res, next) => {
    try {
      const result = await reminders.cancel({ user: req.user, reminderId: req.params.reminderId });
      res.status(statusFor(result)).json(result);
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createReminderRouter };