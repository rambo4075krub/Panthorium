const express = require('express');
const { OAuth2Client } = require('google-auth-library');

function createInternalJobsRouter({ scheduler, audience = process.env.SCHEDULER_OIDC_AUDIENCE || '', serviceAccounts = process.env.SCHEDULER_SERVICE_ACCOUNTS || '', verifier } = {}) {
  const router = express.Router();
  const accounts = new Set((Array.isArray(serviceAccounts) ? serviceAccounts : String(serviceAccounts).split(',')).map(x => String(x).trim()).filter(x => /^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(x)));
  const client = verifier || new OAuth2Client();
  router.post('/tick', async (req, res) => {
    res.set('Cache-Control','no-store');
    if (!audience || !accounts.size || !scheduler?.tick) return res.status(503).json({ok:false,error:'scheduler_trigger_not_configured'});
    const match = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(String(req.headers.authorization || ''));
    if (!match) return res.status(401).json({ok:false,error:'scheduler_authentication_required'});
    let payload;
    try {
      const ticket = await client.verifyIdToken({idToken:match[1],audience});
      payload = ticket?.getPayload?.();
      const now = Math.floor(Date.now()/1000);
      if (!payload || !['accounts.google.com','https://accounts.google.com'].includes(payload.iss) || payload.aud !== audience || !payload.sub || !Number.isFinite(payload.exp) || payload.exp <= now || !Number.isFinite(payload.iat) || payload.iat > now+60 || payload.email_verified !== true) throw new Error('invalid_scheduler_identity');
    } catch { return res.status(401).json({ok:false,error:'invalid_scheduler_identity'}); }
    if (!accounts.has(payload.email)) return res.status(403).json({ok:false,error:'scheduler_identity_denied'});
    try { return res.json(await scheduler.tick()); }
    catch { return res.status(503).json({ok:false,error:'scheduler_tick_failed'}); }
  });
  return router;
}
module.exports = { createInternalJobsRouter };
