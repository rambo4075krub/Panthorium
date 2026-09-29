const { requireAuth } = require('./auth');

// Back-office namespaces stay excluded from guests. Biometrics has its own
// narrow guest-safe routes for temporary user/family voice profiles; admin
// enrollment remains role-gated in the router and service.
const restrictedPaths = [
  '/api/settings', '/api/security', '/api/auth/users', '/api/ai', '/api/agent',
  '/api/training', '/api/production', '/api/governance', '/api/sentinel-control', '/api/integrations'
];
function denyGuest(req, res, next) {
  if (req.user?.roles?.includes('guest')) return res.status(403).json({ ok: false, error: 'guest_feature_restricted' });
  next();
}
function installGuestAccess(app, authService) {
  app.use(restrictedPaths, requireAuth(authService), denyGuest);
}
module.exports = { installGuestAccess, denyGuest, restrictedPaths };
