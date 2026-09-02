const express = require("express");
const rateLimit = require("express-rate-limit");

function createAuthRouter(authService, config) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
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
