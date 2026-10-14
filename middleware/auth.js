function bearerToken(req) {
  const value = req.headers.authorization || "";
  const [scheme, token] = value.split(" ");
  return /^Bearer$/i.test(scheme) ? token : null;
}

function requireAuth(authService) {
  return async (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ ok: false, error: "authentication_required" });
      req.user = authService.verifyAccessToken(token);
      if (authService.validateAccountPrincipal) {
        try { req.user = await authService.validateAccountPrincipal(req.user); }
        catch (e) { const known=["account_suspended","account_access_expired","account_day_restricted","account_not_found","account_session_revoked"]; return res.status(known.includes(e.message)?e.status||403:503).json({ok:false,error:known.includes(e.message)?e.message:"account_validation_unavailable"}); }
      }
      next();
    } catch {
      return res.status(401).json({ ok: false, error: "invalid_or_expired_token" });
    }
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    const permissions = req.user?.permissions || [];
    if (!permissions.includes(permission)) {
      return res.status(403).json({ ok: false, error: "permission_denied", permission });
    }
    next();
  };
}

module.exports = { requireAuth, requirePermission };
