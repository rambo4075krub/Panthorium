const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireAuth } = require("../middleware/auth");

function createAuthRouter(authService, config, securityResponse, biometricRepository, biometrics, emailOtp) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
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
  const requestMeta = (req) => ({ requestId: req.requestId, ip: req.ip || null, userAgent: req.headers["user-agent"] || null });
  const sessionCookieOptions = (rememberMe) => ({ ...cookieOptions, ...(rememberMe ? {} : { maxAge: undefined }) });
  const clearSessionCookieOptions = (({ maxAge, ...options }) => options)(cookieOptions);
  const setSessionCookies = (res, session, rememberMe) => {
    res.cookie("pt_refresh", session.refreshToken, sessionCookieOptions(rememberMe));
    if (rememberMe) res.clearCookie("pt_session", clearSessionCookieOptions);
    else res.cookie("pt_session", "1", { ...cookieOptions, maxAge: undefined });
  };

  router.post("/guest", async (req, res, next) => {
    try {
      const deviceKey = String(req.body?.deviceKey || "");
      const hash = /^[0-9a-f]{64}$/i.test(deviceKey) ? crypto.createHash("sha256").update(deviceKey.toLowerCase()).digest("hex") : null;
      const recognizedOwner = hash && biometricRepository ? await biometricRepository.findGuestOwnerByDeviceKeyHash(hash) : null;
      const requestedId = String(req.body?.guestSessionId || "");
      const requestedOwner = `guest:${requestedId.toLowerCase()}`;
      const protectedOwner = !recognizedOwner && biometricRepository && await biometricRepository.isDeviceBoundGuestOwner(requestedOwner);
      const session = authService.guest({ ...requestMeta(req), guestSessionId: recognizedOwner ? recognizedOwner.slice(6) : protectedOwner ? null : requestedId });
      res.json({ ok: true, accessToken: session.accessToken, user: session.principal, deviceRecognized: Boolean(recognizedOwner) });
    } catch (error) { next(error); }
  });

  router.post("/email/otp/request", auth, otpLimiter, async (req, res, next) => {
    if (!req.user?.roles?.includes("guest")) return res.status(403).json({ ok: false, error: "guest_account_required" });
    try {
      await emailOtp.requestRegistration(req.body?.email, req.user.sub);
      res.status(202).json({ ok: true, message: "otp_sent_if_available" });
    } catch (error) {
      if (error.message === "valid_email_required") return res.status(400).json({ ok: false, error: error.message });
      if (error.message === "email_delivery_not_configured" || error.message === "email_delivery_failed") return res.status(503).json({ ok: false, error: error.message });
      next(error);
    }
  });
  router.post("/email/otp/verify", auth, limiter, async (req, res, next) => {
    if (!req.user?.roles?.includes("guest")) return res.status(403).json({ ok: false, error: "guest_account_required" });
    try { res.json({ ok: true, registrationToken: await emailOtp.verifyRegistration(req.body?.email, req.user.sub, req.body?.code) }); }
    catch (error) { if (error.message === "invalid_otp") return res.status(400).json({ ok: false, error: error.message }); next(error); }
  });

  router.post("/password/forgot", otpLimiter, async (req, res, next) => {
    try { await emailOtp.requestReset(req.body?.email); res.status(202).json({ ok: true, message: "otp_sent_if_account_exists" }); }
    catch (error) {
      if (error.message === "valid_email_required") return res.status(400).json({ ok: false, error: error.message });
      if (error.message === "email_delivery_not_configured" || error.message === "email_delivery_failed") return res.status(503).json({ ok: false, error: error.message });
      next(error);
    }
  });
  router.post("/password/reset", limiter, async (req, res, next) => {
    try { if (req.body?.password !== req.body?.confirmPassword) return res.status(400).json({ ok: false, error: "password_mismatch" }); await emailOtp.resetPassword(req.body?.email, req.body?.code, req.body?.password); res.json({ ok: true }); }
    catch (error) {
      if (["invalid_otp", "invalid_password"].includes(error.message)) return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  router.post("/register/voice", auth, limiter, async (req, res, next) => {
    if (!req.user?.roles?.includes("guest")) return res.status(403).json({ ok: false, error: "guest_account_required" });
    if (!biometrics || !biometricRepository) return res.status(503).json({ ok: false, error: "registration_unavailable" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    if (password !== req.body?.confirmPassword) return res.status(400).json({ ok: false, error: "password_mismatch" });
    if (!emailOtp?.verifyRegistrationToken(req.body?.registrationToken, req.user.sub, email)) return res.status(400).json({ ok: false, error: "email_verification_required" });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: "valid_email_required" });
    if (typeof password !== "string" || password.length < 10 || password.length > 256) return res.status(400).json({ ok: false, error: "invalid_password" });
    if (!req.body?.existingProfileId && !["user", "family"].includes(req.body?.subjectType)) return res.status(403).json({ ok: false, error: "administrator_role_required" });
    try {
      if (await authService.repository.findUserByEmail(email)) return res.status(409).json({ ok: false, error: "email_exists" });
      const guestOwnerId = req.user.sub;
      const existing = req.body?.existingProfileId ? (await biometrics.list(guestOwnerId)).find(item => item.profileId === req.body.existingProfileId && ["user", "family"].includes(item.subjectType)) : null;
      if (req.body?.existingProfileId && !existing) return res.status(404).json({ ok: false, error: "voice_profile_not_found" });
      const profile = existing || await biometrics.enroll({ ...(req.body || {}), email, ownerUserId: guestOwnerId, actorRoles: ["guest"] });
      let user;
      try { user = await authService.createVoiceAccount(email, password, guestOwnerId); }
      catch (error) { if (!existing) await biometricRepository.remove(profile.profileId, guestOwnerId); throw error; }
      await biometricRepository.transferGuestProfiles(guestOwnerId, user.id);
      const session = await authService.issueSession(user);
      setSessionCookies(res, session, req.body?.rememberMe === true);
      res.status(201).json({ ok: true, accessToken: session.accessToken, user: session.principal, profile: { ...profile, ownerUserId: user.id } });
    } catch (error) {
      if (["valid_email_required", "invalid_password", "invalid_display_name", "invalid_subject_type", "biometric_consent_required", "invalid_voice_samples", "voice_samples_do_not_match", "device_key_required"].includes(error.message)) return res.status(400).json({ ok: false, error: error.message });
      if (error.message === "email_exists") return res.status(409).json({ ok: false, error: error.message });
      console.error("[AUTH] voice registration failed (" + (req.requestId || "unknown") + "): " + error.message);
      res.status(503).json({ ok: false, error: "voice_registration_unavailable", requestId: req.requestId });
    }
  });

  router.post("/login", limiter, async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== "string" || typeof password !== "string" || username.length > 254 || password.length > 256) {
        return res.status(400).json({ ok: false, error: "invalid_credentials_format" });
      }

      if (securityResponse) {
        try {
          const block = await securityResponse.getActiveBlock(req.ip);
          if (block) {
            const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(block.expiresAt) - Date.now()) / 1000));
            res.set("Retry-After", String(retryAfterSeconds));
            authService.audit.record("security.blocked_login", { requestId: req.requestId, ip: req.ip || null, username, expiresAt: block.expiresAt, reason: block.reason });
            return res.status(429).json({ ok: false, error: "temporarily_blocked", retryAfterSeconds });
          }
        } catch (error) {
          // Security telemetry must not turn a normal authentication failure
          // into HTTP 500. The request remains rate-limited by this route.
          console.error("[AUTH] security precheck unavailable (" + req.requestId + "): " + error.message);
        }
      }

      const session = await authService.login(username, password, requestMeta(req));
      if (!session) {
        if (securityResponse) {
          try { await securityResponse.evaluateLoginFailure(req.ip); }
          catch (error) { console.error("[AUTH] security failure evaluation unavailable (" + req.requestId + "): " + error.message); }
        }
        return res.status(401).json({ ok: false, error: "invalid_credentials" });
      }
      setSessionCookies(res, session, req.body?.rememberMe !== false);
      res.json({ ok: true, accessToken: session.accessToken, user: session.principal });
    } catch (error) {
      console.error("[AUTH] login failed (" + req.requestId + "): " + error.message);
      res.status(503).json({ ok: false, error: "auth_unavailable", requestId: req.requestId });
    }
  });

  router.get("/me", auth, (req, res) => {
    res.json({ ok: true, user: { id: req.user.sub, username: req.user.username, roles: req.user.roles || [], permissions: req.user.permissions || [] } });
  });

  router.get("/users", auth, adminOnly, async (req, res, next) => {
    try { res.json({ ok: true, users: await authService.listUsers() }); } catch (error) { next(error); }
  });

  router.post("/users", auth, adminOnly, async (req, res, next) => {
    try {
      const user = await authService.createManagedUser(req.body || {}, req.user.sub);
      res.status(201).json({ ok: true, user });
    } catch (error) {
      if (["invalid_username", "invalid_password", "username_exists"].includes(error.message)) return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  router.patch("/users/:id/access", auth, adminOnly, async (req, res, next) => {
    try {
      const user = await authService.updateManagedUserAccess(req.params.id, req.body || {}, req.user.sub);
      res.json({ ok: true, user });
    } catch (error) {
      if (error.message === "user_not_found") return res.status(404).json({ ok: false, error: error.message });
      if (["cannot_demote_self", "cannot_remove_own_settings", "last_administrator_required"].includes(error.message)) return res.status(400).json({ ok: false, error: error.message });
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
      if (["cannot_delete_self", "cannot_delete_administrator"].includes(error.message)) return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  router.post("/refresh", async (req, res, next) => {
    try {
      const session = await authService.refresh(req.cookies?.pt_refresh);
      if (!session) return res.status(401).json({ ok: false, error: "invalid_refresh_token" });
      setSessionCookies(res, session, req.cookies?.pt_session !== "1");
      res.json({ ok: true, accessToken: session.accessToken, user: session.principal });
    } catch (error) { next(error); }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      await authService.revoke(req.cookies?.pt_refresh);
      res.clearCookie("pt_refresh", clearSessionCookieOptions);
      res.clearCookie("pt_session", clearSessionCookieOptions);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createAuthRouter };
