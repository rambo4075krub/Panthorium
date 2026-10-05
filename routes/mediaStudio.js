const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { CloudFilesError } = require('../services/cloudFilesService');
const { MediaStudioError, MAX_SRT_BYTES, isAccountUser } = require('../services/mediaStudioService');

function createMediaStudioRouter(authService, mediaStudio) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const transcribeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
  const renderLimiter = rateLimit({ windowMs: 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false });

  function account(req, res, next) {
    if (!isAccountUser(req.user)) {
      return res.status(403).json({ ok: false, error: 'account_required' });
    }
    return next();
  }

  router.get('/files', auth, account, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...(await mediaStudio.videoFiles(req.user)) });
    } catch (error) { next(error); }
  });

  router.post('/transcribe', auth, account, transcribeLimiter, async (req, res, next) => {
    try {
      const { fileId, language } = req.body || {};
      if (typeof fileId !== 'string' || fileId.length > 80) return res.status(400).json({ ok: false, error: 'invalid_file_id' });
      if (language != null && !['th', 'en'].includes(language)) return res.status(400).json({ ok: false, error: 'invalid_language' });
      res.set('Cache-Control', 'private, no-store');
      res.json(await mediaStudio.transcribe({ user: req.user, fileId, language: language || 'th' }));
    } catch (error) { next(error); }
  });

  router.post('/render', auth, account, renderLimiter, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (typeof body.fileId !== 'string' || body.fileId.length > 80) return res.status(400).json({ ok: false, error: 'invalid_file_id' });
      if (body.captionsSrt != null && (typeof body.captionsSrt !== 'string' || Buffer.byteLength(body.captionsSrt, 'utf8') > MAX_SRT_BYTES)) {
        return res.status(413).json({ ok: false, error: 'captions_too_large' });
      }
      const result = await mediaStudio.render({
        user: req.user,
        fileId: body.fileId,
        startSeconds: body.startSeconds,
        endSeconds: body.endSeconds,
        captionsSrt: body.captionsSrt || '',
        aspect: body.aspect || 'original',
        name: body.name || ''
      });
      res.set('Cache-Control', 'private, no-store').json(result);
    } catch (error) { next(error); }
  });

  router.use((error, req, res, next) => {
    if (error instanceof MediaStudioError || error instanceof CloudFilesError) {
      return res.status(error.status || 500).json({ ok: false, error: error.code || 'media_operation_failed' });
    }
    next(error);
  });
  return router;
}

module.exports = { createMediaStudioRouter };
