const express = require("express");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");
const { requireAuth, requirePermission } = require("../middleware/auth");

function validText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function createApiRouter(sentinelCore, authService, audit) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  router.get("/health", (req, res) => {
    res.json({ ok: true, service: "Panthorium Backend", core: sentinelCore.status(), time: new Date().toISOString() });
  });

  router.get("/core/status", auth, requirePermission("system:read"), (req, res) => {
    res.json({ ok: true, ...sentinelCore.status() });
  });

  router.post("/chat", auth, requirePermission("chat"), aiLimiter, async (req, res) => {
    try {
      const { message, sessionId, mode } = req.body || {};
      if (!validText(message, 8000)) return res.status(400).json({ ok: false, error: "invalid_message" });
      if (sessionId != null && (typeof sessionId !== "string" || sessionId.length > 120)) {
        return res.status(400).json({ ok: false, error: "invalid_session_id" });
      }
      const sid = sessionId || req.headers["x-session-id"] || randomUUID();
      const result = await sentinelCore.chat({ sessionId: `${req.user.sub}:${sid}`, message, mode: mode === "core" ? "core" : "default" });
      audit.record("sentinel.chat", { userId: req.user.sub, sessionId: sid, provider: result.provider || null, ok: result.ok });
      res.json({ ...result, sessionId: sid });
    } catch (err) {
      console.error("[API /chat]", err);
      res.status(500).json({ ok: false, error: "internal_error", text: "เกิดข้อผิดพลาดภายใน Sentinel Core" });
    }
  });

  router.post("/core/command", auth, requirePermission("core:command"), aiLimiter, async (req, res) => {
    try {
      const { command, sessionId } = req.body || {};
      if (!validText(command, 8000)) return res.status(400).json({ ok: false, error: "invalid_command" });
      const sid = typeof sessionId === "string" && sessionId.length <= 120 ? sessionId : randomUUID();
      const result = await sentinelCore.chat({ sessionId: `${req.user.sub}:${sid}`, message: command, mode: "core" });
      audit.record("sentinel.core_command", { userId: req.user.sub, sessionId: sid, ok: result.ok });
      res.json({ ...result, sessionId: sid });
    } catch (err) {
      console.error("[API /core/command]", err);
      res.status(500).json({ ok: false, error: "internal_error", text: "เกิดข้อผิดพลาดภายใน Sentinel Core" });
    }
  });

  router.post("/chat/clear", auth, requirePermission("chat"), (req, res) => {
    const { sessionId } = req.body || {};
    if (typeof sessionId === "string" && sessionId.length <= 120) sentinelCore.clearSession(`${req.user.sub}:${sessionId}`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createApiRouter };
