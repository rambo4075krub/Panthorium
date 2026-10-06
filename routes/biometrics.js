const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');

function createBiometricsRouter(authService, biometrics) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const owner = req => req.user?.sub;
  const handle = (res, error) => {
    const code = String(error?.message || 'biometric_operation_failed');
    const status = /not_configured/.test(code) ? 503
      : code === 'voice_profile_not_found' ? 404
      : code === 'voice_profile_samples_conflict' ? 409
      : code === 'administrator_role_required' ? 403
      : ['voice_audio_too_short', 'voice_audio_unclear', 'voice_audio_invalid_duration', 'voice_audio_invalid', 'invalid_voice_sample'].includes(code) ? 422
      : /required|invalid|do_not_match|liveness/.test(code) ? 400
      : code === 'inconsistent_voice_embeddings' ? 503 : 500;
    res.status(status).json({ ok: false, error: status === 500 ? 'biometric_operation_failed' : code });
  };
  router.get('/status', auth, (req, res) => res.json({ ok: true, ...biometrics.status() }));
  router.get('/voice/profiles', auth, async (req, res) => { try { res.json({ ok: true, profiles: await biometrics.list(owner(req)) }); } catch (error) { handle(res, error); } });
  router.post('/voice/profiles', auth, limiter, async (req, res) => { try { const roles = req.user?.roles || []; const subjectType = req.body?.subjectType; if (roles.includes('guest') && !['user', 'family'].includes(subjectType)) return res.status(403).json({ ok: false, error: 'administrator_role_required' }); const profile = await biometrics.enroll({ ...(req.body || {}), ownerUserId: owner(req), actorRoles: roles }); res.status(201).json({ ok: true, profile }); } catch (error) { handle(res, error); } });
  router.post('/voice/profiles/:profileId/samples', auth, limiter, async (req, res) => {
    try {
      const profile = await biometrics.addSamples({
        ownerUserId: owner(req),
        actorRoles: req.user?.roles || [],
        profileId: req.params.profileId,
        consent: req.body?.consent,
        samples: req.body?.samples
      });
      res.json({ ok: true, profile });
    } catch (error) { handle(res, error); }
  });
  router.delete('/voice/profiles/:profileId', auth, async (req, res) => { try { const removed = await biometrics.remove(owner(req), req.params.profileId); res.status(removed ? 200 : 404).json(removed ? { ok: true } : { ok: false, error: 'voice_profile_not_found' }); } catch (error) { handle(res, error); } });
  router.post('/voice/verify', auth, limiter, async (req, res) => { try { res.json(await biometrics.verify({ ownerUserId: owner(req), audio: req.body?.audio })); } catch (error) { handle(res, error); } });
  return router;
}

module.exports = { createBiometricsRouter };
