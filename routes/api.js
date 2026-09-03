const express = require("express");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");
const { requireAuth, requirePermission } = require("../middleware/auth");
function validText(value, max) { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function createApiRouter(sentinelCore, authService, audit) {
  const router = express.Router(); const auth = requireAuth(authService);
  const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  router.get("/health", (req, res) => res.json({ ok: true, service: "Panthorium Backend", core: sentinelCore.status(), time: new Date().toISOString() }));
  router.get("/core/status", auth, requirePermission("system:read"), (req, res) => res.json({ ok: true, ...sentinelCore.status() }));
  router.get("/ai/providers", auth, requirePermission("chat"), (req, res) => res.json({ ok: true, providers: sentinelCore.providerCatalog() }));
  router.get("/conversations", auth, requirePermission("chat"), async (req, res) => res.json({ ok: true, sessions: await sentinelCore.conversationSessions(req.user.sub, Number(req.query.limit) || 30) }));
  router.get("/conversations/:sessionId", auth, requirePermission("chat"), async (req, res) => {
    if (!validText(req.params.sessionId, 120)) return res.status(400).json({ ok: false, error: "invalid_session_id" });
    res.json({ ok: true, sessionId: req.params.sessionId, messages: await sentinelCore.conversationHistory(req.user.sub, req.params.sessionId, Number(req.query.limit) || 40) });
  });
  router.post("/chat", auth, requirePermission("chat"), aiLimiter, async (req, res) => {
    try {
      const { message, sessionId, mode, provider, model } = req.body || {};
      if (!validText(message, 8000)) return res.status(400).json({ ok: false, error: "invalid_message" });
      if (sessionId != null && (typeof sessionId !== "string" || sessionId.length > 120)) return res.status(400).json({ ok: false, error: "invalid_session_id" });
      if (provider != null && (typeof provider !== "string" || provider.length > 40)) return res.status(400).json({ ok: false, error: "invalid_provider" });
      if (model != null && (typeof model !== "string" || model.length > 120)) return res.status(400).json({ ok: false, error: "invalid_model" });
      const sid = sessionId || req.headers["x-session-id"] || randomUUID();
      const result = await sentinelCore.chat({ sessionId: sid, userId: req.user.sub, message, mode: mode === "core" ? "core" : "default", provider: provider?.toLowerCase(), model });
      audit.record("sentinel.chat", { userId: req.user.sub, sessionId: sid, provider: result.provider || null, model: result.model || null, usage: result.usage || null, latencyMs: result.latencyMs || null, ok: result.ok });
      res.json({ ...result, sessionId: sid });
    } catch (err) { console.error("[API /chat]", err); res.status(500).json({ ok: false, error: "internal_error", text: "เกิดข้อผิดพลาดภายใน Sentinel Core" }); }
  });
  router.post("/core/command", auth, requirePermission("core:command"), aiLimiter, async (req, res) => {
    try { const { command, sessionId, provider, model } = req.body || {}; if (!validText(command, 8000)) return res.status(400).json({ ok: false, error: "invalid_command" }); const sid = typeof sessionId === "string" && sessionId.length <= 120 ? sessionId : randomUUID(); const result = await sentinelCore.chat({ sessionId: sid, userId: req.user.sub, message: command, mode: "core", provider: provider?.toLowerCase(), model }); audit.record("sentinel.core_command", { userId: req.user.sub, sessionId: sid, provider: result.provider || null, model: result.model || null, ok: result.ok }); res.json({ ...result, sessionId: sid }); }
    catch (err) { console.error("[API /core/command]", err); res.status(500).json({ ok: false, error: "internal_error", text: "เกิดข้อผิดพลาดภายใน Sentinel Core" }); }
  });
  router.post("/chat/clear", auth, requirePermission("chat"), async (req, res) => { const { sessionId } = req.body || {}; if (typeof sessionId === "string" && sessionId.length <= 120) await sentinelCore.clearConversation(req.user.sub, sessionId); res.json({ ok: true }); });
  return router;
}
module.exports = { createApiRouter };
