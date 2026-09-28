const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');

function createBiometricsRouter(authService, biometrics) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const owner = req => req.user?.sub;
  const handle = (res, error) => {
    const status = /not_configured/.test(error.message) ? 503 : /required|invalid|do_not_match|liveness/.test(error.message) ? 400 : 500;
    res.status(status).json({ ok: false, error: status === 500 ? 'biometric_operation_failed' : error.message });
  };
  router.get('/status', auth, (req, res) => res.json({ ok: true, ...biometrics.status() }));
  router.get('/voice/profiles', auth, async (req, res) => { try { res.json({ ok: true, profiles: await biometrics.list(owner(req)) }); } catch (error) { handle(res, error); } });
  router.post('/voice/profiles', auth, limiter, async (req, res) => { try { const profile = await biometrics.enroll({ ownerUserId: owner(req), actorRoles: req.user?.roles || [], ...(req.body || {}) }); res.status(201).json({ ok: true, profile }); } catch (error) { handle(res, error); } });
  router.delete('/voice/profiles/:profileId', auth, async (req, res) => { try { const removed = await biometrics.remove(owner(req), req.params.profileId); res.status(removed ? 200 : 404).json(removed ? { ok: true } : { ok: false, error: 'voice_profile_not_found' }); } catch (error) { handle(res, error); } });
  router.post('/voice/verify', auth, limiter, async (req, res) => { try { res.json(await biometrics.verify({ ownerUserId: owner(req), audio: req.body?.audio })); } catch (error) { handle(res, error); } });
  return router;
}

module.exports = { createBiometricsRouter };
