'use strict';
// The local pilot exposes inference and existing authentication only.
// Product actions, cloud integrations and background execution stay unavailable.
function localProfileGuard(req, res, next) {
  if (process.env.PANTHORIUM_LOCAL_PROFILE !== '1') return next();
  const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  if (path.startsWith('/internal')) return res.status(503).json({ok:false,error:'local_profile_action_disabled'});
  if (!path.startsWith('/api')) return ['GET','HEAD'].includes(req.method) ? next() : res.status(405).end();
  const read = ['/api/health','/api/auth/me','/api/ai/providers'];
  const write = ['/api/auth/login','/api/auth/guest','/api/auth/refresh','/api/auth/logout','/api/local/chat'];
  if ((['GET','HEAD'].includes(req.method) && read.includes(path)) || (req.method === 'POST' && write.includes(path))) return next();
  return res.status(503).json({ok:false,error:'local_profile_action_disabled'});
}
module.exports = {localProfileGuard};
