'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const backend = require('../services/commandSpeech');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createCommandSpeechRouter({ authService, biometrics, speech = backend }) {
  const router = express.Router();
  const limit = rateLimit({ windowMs:60000, limit:12, standardHeaders:true, legacyHeaders:false });
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/', (_req, res) => res.json({ available:speech.available() }));
  router.post('/commands', requireAuth(authService), requirePermission('chat'));
  router.post(['/commands', '/search'], limit, express.raw({ type:'audio/wav', limit:384044 }), async (req, res) => {
    if (!backend.validAudio(req.body)) return res.status(400).json({ error:'invalid_audio' });
    if (!speech.available()) return res.status(503).json({ error:'speech_unavailable' });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      // An unsigned command turn may request command vocabulary, never command access.
      const requested = req.path === '/commands' ? 'command' : req.query.purpose;
      const purpose = ['command','reader','results'].includes(requested) ? requested : 'search';
      const text = await speech.transcribe(req.body, req.query.lang === 'en' ? 'en' : 'th', controller.signal, purpose, req.query.spelling === '1');
      // Public dictation can only dispatch search. Authenticated command access
      // observes the existing voice identity policy, including for future apps.
      let commands = req.path === '/commands';
      if (commands && biometrics.gateEnabled) {
        commands = false;
        try {
          if ((await biometrics.list(req.user.sub)).length) {
            const verified = await biometrics.verify({ ownerUserId:req.user.sub, audio:'data:audio/wav;base64,' + req.body.toString('base64') });
            commands = verified.matched === true;
          }
        } catch { /* Public search stays available if identity verification is unavailable. */ }
      }
      if (!res.destroyed) res.json({ text, commands });
    } catch (error) {
      if (!res.destroyed) res.status(error.message === 'speech_busy' ? 429 : error.message === 'no_speech' ? 422 : 503)
        .json({ error:['speech_busy','no_speech'].includes(error.message) ? error.message : 'speech_unavailable' });
    }
  }, (error, _req, res, next) => error.type === 'entity.too.large' ? res.status(413).json({error:'audio_too_large'}) : next(error));
  return router;
}
module.exports = { createCommandSpeechRouter };
