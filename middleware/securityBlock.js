'use strict';
function securityBlock(security) {
  return async (req, res, next) => {
    // Static recovery UI and readiness remain reachable; their APIs still require
    // authentication. No token, administrator role or guest flow bypasses a block.
    if (!/^\/(api|mcp|oauth)(\/|$)/i.test(req.path) || ['/api/health'].includes(req.path)) return next();
    try {
      const block = await security.getActiveBlock(req.ip);
      if (!block) return next();
      await security.audit?.record(req.path === '/api/auth/login' ? 'security.blocked_login' : 'security.blocked_request', {ip:req.ip,requestId:req.requestId,path:req.path,method:req.method,source:block.source});
      res.set('Retry-After', String(Math.max(1, Math.ceil((new Date(block.expiresAt).getTime() - Date.now()) / 1000))));
      res.set('Cache-Control', 'no-store');
      return res.status(429).json({ ok: false, error: 'ip_temporarily_blocked' });
    } catch {
      return res.status(503).json({ ok: false, error: 'security_validation_unavailable' });
    }
  };
}
module.exports = { securityBlock };
