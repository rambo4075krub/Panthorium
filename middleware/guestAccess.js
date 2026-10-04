const { requireAuth } = require('./auth');

// Back-office namespaces are limited to staff. Voice identity keeps its own
// narrow guest-safe routes for temporary user/family profiles.
const restrictedPaths = [
  '/api/settings', '/api/security', '/api/auth/users', '/api/ai', '/api/agent',
  '/api/training', '/api/production', '/api/governance', '/api/sentinel-control', '/api/integrations'
];
function denyGuest(req, res, next) {
  if (!(req.user?.roles || []).some(role => ['administrator', 'operator'].includes(role))) return res.status(403).json({ ok: false, error: 'user_feature_restricted' });
  next();
}
function denyGuestExceptAccountMemory(req, res, next) {
  const pathname = String(req.originalUrl || req.url || '').split('?')[0];
  if (pathname === '/api/agent/memory' || pathname.startsWith('/api/agent/memory/')) return next();
  return denyGuest(req, res, next);
}
function installGuestAccess(app, authService) {
  app.use(restrictedPaths, requireAuth(authService), denyGuestExceptAccountMemory);
}
module.exports = { installGuestAccess, denyGuest, restrictedPaths, denyGuestExceptAccountMemory };
