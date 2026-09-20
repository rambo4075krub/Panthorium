const { requireAuth } = require('./auth');

// These namespaces power the owner's twelve excluded back-office features.
// Chat, speech, personal conversations and permitted window commands stay public
// to authenticated guests; hiding a launcher alone is not an access boundary.
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
