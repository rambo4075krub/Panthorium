function bearerToken(req) {
  const value = req.headers.authorization || "";
  const [scheme, token] = value.split(" ");
  return /^Bearer$/i.test(scheme) ? token : null;
}

function defaultFailure(res, status, error, extra = {}) { return res.status(status).json({ ok: false, error, ...extra }); }

function requireAuth(authService, failure = defaultFailure) {
  return async (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) return failure(res, 401, "authentication_required");
      req.user = authService.verifyAccessToken(token);
      if (authService.validateAccessSession) {
        try { await authService.validateAccessSession(req.user); }
        catch (e) { return failure(res, e.message === 'account_session_revoked' ? 401 : 503, e.message === 'account_session_revoked' ? e.message : 'session_validation_unavailable'); }
      }
      if (authService.validateAccountPrincipal) {
        try { req.user = await authService.validateAccountPrincipal(req.user); }
        catch (e) { const known=["account_suspended","account_access_expired","account_day_restricted","account_not_found","account_session_revoked"]; return failure(res, known.includes(e.message) ? e.status || 403 : 503, known.includes(e.message) ? e.message : "account_validation_unavailable"); }
      }
      next();
    } catch {
      return failure(res, 401, "invalid_or_expired_token");
    }
  };
}

function requirePermission(permission, failure = defaultFailure) {
  return (req, res, next) => {
    const permissions = req.user?.permissions || [];
    if (!permissions.includes(permission)) {
      return failure(res, 403, "permission_denied", { permission });
    }
    next();
  };
}

module.exports = { requireAuth, requirePermission };
