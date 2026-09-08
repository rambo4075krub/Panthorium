const express = require("express");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { transformSentinelMaleVoice } = require("../services/sentinelSpeechAudio");
function validText(value, max) { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function validChatBody(body = {}) {
  if (!validText(body.message, 8000)) return "invalid_message";
  if (body.sessionId != null && (typeof body.sessionId !== "string" || body.sessionId.length > 120)) return "invalid_session_id";
  if (body.provider != null && (typeof body.provider !== "string" || body.provider.length > 40)) return "invalid_provider";
  if (body.model != null && (typeof body.model !== "string" || body.model.length > 120)) return "invalid_model";
  return null;
}
function createApiRouter(sentinel, authService, audit, aiOperations, agentService, agentPlanner, agentWorkflow, agentRuns, agentScheduler) {
  const router = express.Router(); const auth = requireAuth(authService);
  const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const speechLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false });
  const agentLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  router.get("/health", (req, res) => res.json({ ok: true, service: "Panthorium Backend", sentinel: sentinel.status(), time: new Date().toISOString() }));
  router.get("/sentinel/status", auth, requirePermission("system:read"), (req, res) => res.json({ ok: true, ...sentinel.status() }));
  router.get("/ai/providers", auth, requirePermission("chat"), (req, res) => res.json({ ok: true, providers: sentinel.providerCatalog() }));
  router.get("/ai/operations", auth, requirePermission("chat"), async (req, res, next) => { try { res.json({ ok: true, metrics: await aiOperations.overview(req.user.sub, req.query.hours) }); } catch (error) { next(error); } });
  router.post("/speech", auth, requirePermission("chat"), speechLimiter, async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const lang = typeof req.body?.lang === "string" ? req.body.lang : "";
    const allowedLanguages = new Set(["th-TH", "en-US", "ja-JP", "ko-KR", "ar-SA", "ru-RU", "zh-CN"]);
    if (!text || text.length > 180 || !allowedLanguages.has(lang)) return res.status(400).json({ ok: false, error: "invalid_speech_request" });
    try {
      const upstreamUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
      const upstream = await fetch(upstreamUrl, { headers: { Accept: "audio/mpeg", "User-Agent": "Panthorium-Sentinel/15" }, signal: AbortSignal.timeout(12000) });
      if (!upstream.ok) throw new Error(`speech_upstream_${upstream.status}`);
      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("audio/")) throw new Error("speech_upstream_invalid_content");
      const sourceAudio = Buffer.from(await upstream.arrayBuffer());
      if (!sourceAudio.length || sourceAudio.length > 1024 * 1024) throw new Error("speech_upstream_invalid_size");
      let audio = sourceAudio;
      let voiceProfile = "source-fallback";
      try {
        audio = await transformSentinelMaleVoice(sourceAudio);
        voiceProfile = "sentinel-male-reference-v3";
      } catch (transformError) {
        audit.record("sentinel.speech_transform_failed", { userId: req.user.sub, lang, error: transformError.message });
      }
      res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "Content-Length": String(audio.length), "X-Sentinel-Voice-Profile": voiceProfile }).send(audio);
    } catch (error) {
      audit.record("sentinel.speech_failed", { userId: req.user.sub, lang, error: error.message });
      res.status(502).json({ ok: false, error: "speech_unavailable" });
    }
  });
  router.get("/agent/tools", auth, agentLimiter, (req, res) => res.json({ ok: true, tools: agentService.catalogFor(req.user) }));
  router.get("/agent/runs", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { res.json({ ok: true, runs: await agentRuns.list(req.user.sub, Number(req.query.limit) || 30) }); } catch (error) { next(error); } });
  router.get("/agent/runs/:workflowId", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { if (!validText(req.params.workflowId, 80)) return res.status(400).json({ ok: false, error: "invalid_workflow_id" }); const run = await agentRuns.get(req.user.sub, req.params.workflowId); if (!run) return res.status(404).json({ ok: false, error: "agent_run_not_found" }); res.json({ ok: true, run }); } catch (error) { next(error); } });
  router.get("/agent/jobs", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { res.json({ ok: true, jobs: await agentScheduler.list(req.user.sub, Number(req.query.limit) || 30) }); } catch (error) { next(error); } });
  router.get("/agent/jobs/:jobId", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { if (!validText(req.params.jobId, 80)) return res.status(400).json({ ok: false, error: "invalid_job_id" }); const job = await agentScheduler.get(req.user.sub, req.params.jobId); if (!job) return res.status(404).json({ ok: false, error: "agent_job_not_found" }); res.json({ ok: true, job }); } catch (error) { next(error); } });
  router.post("/agent/jobs", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { const { request, message, provider, runAt } = req.body || {}; const input = request || message; if (!validText(input, 8000)) return res.status(400).json({ ok: false, error: "invalid_agent_request" }); const result = await agentScheduler.schedule({ user: req.user, request: input, provider, runAt, requestId: req.requestId }); if (!result.ok) return res.status(400).json(result); res.status(201).json(result); } catch (error) { next(error); } });
  router.delete("/agent/jobs/:jobId", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { if (!validText(req.params.jobId, 80)) return res.status(400).json({ ok: false, error: "invalid_job_id" }); const result = await agentScheduler.cancel({ user: req.user, jobId: req.params.jobId, requestId: req.requestId }); if (result.error === "agent_job_not_found") return res.status(404).json(result); if (!result.ok) return res.status(409).json(result); res.json(result); } catch (error) { next(error); } });
  router.post("/agent/execute", auth, agentLimiter, async (req, res, next) => { try { const { toolId, args, confirmed } = req.body || {}; if (!validText(toolId, 100)) return res.status(400).json({ ok: false, error: "invalid_tool_id" }); if (args != null && (typeof args !== "object" || Array.isArray(args))) return res.status(400).json({ ok: false, error: "invalid_tool_args" }); const result = await agentService.execute({ user: req.user, toolId, args: args || {}, confirmed: confirmed === true, requestId: req.requestId }); if (result.error === "tool_not_found") return res.status(404).json(result); if (result.error === "tool_permission_denied") return res.status(403).json(result); if (result.error === "confirmation_required") return res.status(409).json(result); res.status(result.ok ? 200 : 400).json(result); } catch (error) { next(error); } });
  router.post("/agent/plan", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { const { request, message, provider } = req.body || {}; const input = request || message; if (!validText(input, 8000)) return res.status(400).json({ ok: false, error: "invalid_agent_request" }); if (provider != null && !validText(provider, 40)) return res.status(400).json({ ok: false, error: "invalid_provider" }); const result = await agentPlanner.plan({ user: req.user, request: input, preferredProvider: provider?.toLowerCase(), requestId: req.requestId }); res.status(result.ok ? 200 : 422).json(result); } catch (error) { next(error); } });
  router.post("/agent/run", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { const { request, message, provider, confirmed } = req.body || {}; const input = request || message; if (!validText(input, 8000)) return res.status(400).json({ ok: false, error: "invalid_agent_request" }); if (provider != null && !validText(provider, 40)) return res.status(400).json({ ok: false, error: "invalid_provider" }); const result = await agentPlanner.run({ user: req.user, request: input, preferredProvider: provider?.toLowerCase(), confirmed: confirmed === true, requestId: req.requestId }); if (result.confirmationRequired) return res.status(409).json(result); res.status(result.ok ? 200 : 422).json(result); } catch (error) { next(error); } });
  router.post("/agent/workflow/run", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { const { request, message, provider } = req.body || {}; const input = request || message; if (!validText(input, 8000)) return res.status(400).json({ ok: false, error: "invalid_agent_request" }); if (provider != null && !validText(provider, 40)) return res.status(400).json({ ok: false, error: "invalid_provider" }); const result = await agentWorkflow.run({ user: req.user, request: input, preferredProvider: provider?.toLowerCase(), requestId: req.requestId }); if (result.confirmationRequired) return res.status(409).json(result); res.status(result.ok ? 200 : 422).json(result); } catch (error) { next(error); } });
  router.post("/agent/workflow/:workflowId/confirm", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { if (!validText(req.params.workflowId, 80)) return res.status(400).json({ ok: false, error: "invalid_workflow_id" }); const result = await agentWorkflow.confirm({ user: req.user, workflowId: req.params.workflowId, requestId: req.requestId }); if (result.error === "workflow_not_found") return res.status(404).json(result); if (result.error === "workflow_permission_denied") return res.status(403).json(result); if (result.confirmationRequired) return res.status(409).json(result); res.status(result.ok ? 200 : 422).json(result); } catch (error) { next(error); } });
  router.post("/agent/workflow/:workflowId/cancel", auth, requirePermission("chat"), agentLimiter, async (req, res, next) => { try { if (!validText(req.params.workflowId, 80)) return res.status(400).json({ ok: false, error: "invalid_workflow_id" }); const result = await agentWorkflow.cancel({ user: req.user, workflowId: req.params.workflowId, requestId: req.requestId }); if (result.error === "workflow_not_found") return res.status(404).json(result); if (result.error === "workflow_permission_denied") return res.status(403).json(result); res.json(result); } catch (error) { next(error); } });
  router.get("/conversations", auth, requirePermission("chat"), async (req, res) => res.json({ ok: true, sessions: await sentinel.conversationSessions(req.user.sub, Number(req.query.limit) || 30) }));
  router.get("/conversations/:sessionId", auth, requirePermission("chat"), async (req, res) => { if (!validText(req.params.sessionId, 120)) return res.status(400).json({ ok: false, error: "invalid_session_id" }); res.json({ ok: true, sessionId: req.params.sessionId, messages: await sentinel.conversationHistory(req.user.sub, req.params.sessionId, Number(req.query.limit) || 40) }); });
  router.delete("/conversations/:sessionId", auth, requirePermission("chat"), async (req, res) => { if (!validText(req.params.sessionId, 120)) return res.status(400).json({ ok: false, error: "invalid_session_id" }); await sentinel.clearConversation(req.user.sub, req.params.sessionId); audit.record("ai.conversation_deleted", { userId: req.user.sub, sessionId: req.params.sessionId }); res.json({ ok: true }); });
  router.post("/chat/stream", auth, requirePermission("chat"), aiLimiter, async (req, res) => {
    const error = validChatBody(req.body || {});
    if (error) return res.status(400).json({ ok: false, error });
    const { message, sessionId, provider, model } = req.body || {};
    const sid = sessionId || req.headers["x-session-id"] || randomUUID();
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    const event = (name, payload) => { if (!res.writableEnded) res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`); };
    event("start", { sessionId: sid, sentinel: "Sentinel" });
    try {
      const result = await sentinel.streamChat({
        sessionId: sid,
        userId: req.user.sub,
        message,
        mode: "default",
        provider: provider?.toLowerCase(),
        model,
        onProvider: (meta) => event("provider", meta),
        onDelta: (delta) => event("delta", { delta })
      });
      if (!result.ok) event("error", { error: result.error || "stream_failed" });
      else event("done", { sessionId: sid, provider: result.provider || null, model: result.model || null, usage: result.usage || null, latencyMs: result.latencyMs || null, streaming: result.streaming || null });
    } catch (streamError) {
      event("error", { error: "internal_error" });
      audit.record("sentinel.stream_failed", { userId: req.user.sub, sessionId: sid, error: streamError.message });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
  router.post("/chat", auth, requirePermission("chat"), aiLimiter, async (req, res) => { try { const error = validChatBody(req.body || {}); if (error) return res.status(400).json({ ok: false, error }); const { message, sessionId, provider, model } = req.body || {}; const sid = sessionId || req.headers["x-session-id"] || randomUUID(); const result = await sentinel.chat({ sessionId: sid, userId: req.user.sub, message, mode: "default", provider: provider?.toLowerCase(), model }); audit.record("sentinel.chat", { userId: req.user.sub, sessionId: sid, provider: result.provider || null, model: result.model || null, usage: result.usage || null, latencyMs: result.latencyMs || null, ok: result.ok }); res.json({ ...result, sessionId: sid }); } catch (err) { res.status(500).json({ ok: false, error: "internal_error" }); } });
  router.post("/sentinel/command", auth, requirePermission("sentinel:command"), aiLimiter, async (req, res) => { try { const { command, sessionId, provider, model } = req.body || {}; if (!validText(command, 8000)) return res.status(400).json({ ok: false, error: "invalid_command" }); const sid = typeof sessionId === "string" && sessionId.length <= 120 ? sessionId : randomUUID(); const result = await sentinel.chat({ sessionId: sid, userId: req.user.sub, message: command, mode: "admin", provider: provider?.toLowerCase(), model }); res.json({ ...result, sessionId: sid }); } catch (err) { res.status(500).json({ ok: false, error: "internal_error" }); } });
  router.post("/chat/clear", auth, requirePermission("chat"), async (req, res) => { const { sessionId } = req.body || {}; if (typeof sessionId === "string" && sessionId.length <= 120) await sentinel.clearConversation(req.user.sub, sessionId); res.json({ ok: true }); });
  return router;
}
module.exports = { createApiRouter };
