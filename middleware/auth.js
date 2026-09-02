function bearerToken(req) {
  const value = req.headers.authorization || "";
  const [scheme, token] = value.split(" ");
  return /^Bearer$/i.test(scheme) ? token : null;
}

function requireAuth(authService) {
  return (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ ok: false, error: "authentication_required" });
      req.user = authService.verifyAccessToken(token);
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
