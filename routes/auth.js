const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");

function createAuthRouter(authService, config) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const auth = requireAuth(authService);
  const adminOnly = (req, res, next) => {
    if (!req.user?.roles?.includes("administrator")) return res.status(403).json({ ok: false, error: "forbidden" });
    next();
  };
  const cookieOptions = {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: config.refreshTokenDays * 86400000
  };

  router.post("/guest", (req, res) => {
    const session = authService.guest();
    res.json({ ok: true, accessToken: session.accessToken, user: session.principal });
  });

  router.post("/login", limiter, async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== "string" || typeof password !== "string" || username.length > 80 || password.length > 256) {
        return res.status(400).json({ ok: false, error: "invalid_credentials_format" });
      }
      const session = await authService.login(username, password);
      if (!session) return res.status(401).json({ ok: false, error: "invalid_credentials" });
      res.cookie("pt_refresh", session.refreshToken, cookieOptions);
      res.json({ ok: true, accessToken: session.accessToken, user: session.principal });
    } catch (error) { next(error); }
  });

  router.get("/me", auth, (req, res) => {
    res.json({
      ok: true,
      user: {
        id: req.user.sub,
        username: req.user.username,
        roles: req.user.roles || [],
        permissions: req.user.permissions || []
      }
    });
  });

  router.get("/users", auth, adminOnly, async (req, res, next) => {
    try {
      res.json({ ok: true, users: await authService.listUsers() });
    } catch (error) { next(error); }
  });

  router.post("/users", auth, adminOnly, async (req, res, next) => {
    try {
      const user = await authService.createManagedUser(req.body || {}, req.user.sub);
      res.status(201).json({ ok: true, user });
    } catch (error) {
      if (["invalid_username", "invalid_password", "username_exists"].includes(error.message)) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      next(error);
    }
  });

  router.patch("/users/:id/access", auth, adminOnly, async (req, res, next) => {
    try {
      const user = await authService.updateManagedUserAccess(req.params.id, req.body || {}, req.user.sub);
      res.json({ ok: true, user });
    } catch (error) {
      if (error.message === "user_not_found") return res.status(404).json({ ok: false, error: error.message });
      next(error);
    }
  });

  router.patch("/users/:id/password", auth, adminOnly, async (req, res, next) => {
    try {
      const user = await authService.resetManagedUserPassword(req.params.id, req.body?.password, req.user.sub);
      res.json({ ok: true, user });
    } catch (error) {
      if (error.message === "user_not_found") return res.status(404).json({ ok: false, error: error.message });
      if (error.message === "invalid_password") return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  router.delete("/users/:id", auth, adminOnly, async (req, res, next) => {
    try {
      await authService.deleteManagedUser(req.params.id, req.user.sub);
      res.json({ ok: true });
    } catch (error) {
      if (error.message === "user_not_found") return res.status(404).json({ ok: false, error: error.message });
      if (["cannot_delete_self", "cannot_delete_administrator"].includes(error.message)) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      next(error);
    }
  });

  router.post("/refresh", async (req, res, next) => {
    try {
      const session = await authService.refresh(req.cookies?.pt_refresh);
      if (!session) return res.status(401).json({ ok: false, error: "invalid_refresh_token" });
      res.cookie("pt_refresh", session.refreshToken, cookieOptions);
      res.json({ ok: true, accessToken: session.accessToken, user: session.principal });
    } catch (error) { next(error); }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      await authService.revoke(req.cookies?.pt_refresh);
      res.clearCookie("pt_refresh", cookieOptions);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createAuthRouter };
