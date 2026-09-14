const express = require("express");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { synthesizeSentinelMaleVoice } = require("../services/sentinelSpeechAudio");
function validText(value, max) { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function validChatBody(body = {}) {
  if (!validText(body.message, 8000)) return "invalid_message";
  if (body.sessionId != null && (typeof body.sessionId !== "string" || body.sessionId.length > 120)) return "invalid_session_id";
  if (body.provider != null && (typeof body.provider !== "string" || body.provider.length > 40)) return "invalid_provider";
  if (body.model != null && (typeof body.model !== "string" || body.model.length > 120)) return "invalid_model";
  if (body.voice != null && typeof body.voice !== "boolean") return "invalid_voice_mode";
  return null;
}
const windowCatalog = require("../voice-window-catalog");
function hasVoicePermission(user, permission) { return (user?.permissions || []).includes(permission); }

function createApiRouter(sentinel, authService, audit, aiOperations, agentService, agentPlanner, agentWorkflow, agentRuns, agentScheduler) {
  const router = express.Router(); const auth = requireAuth(authService);
  const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const speechLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false });
  const agentLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  router.get("/health", (req, res) => res.json({ ok: true, service: "Panthorium Backend", release: process.env.K_REVISION || process.env.PANTHORIUM_RELEASE || require("../package.json").version, sentinel: sentinel.status(), time: new Date().toISOString() }));
  router.get("/sentinel/status", auth, requirePermission("system:read"), (req, res) => res.json({ ok: true, ...sentinel.status() }));
  router.get("/ai/providers", auth, requirePermission("chat"), (req, res) => res.json({ ok: true, providers: sentinel.providerCatalog() }));
  router.get("/ai/operations", auth, requirePermission("chat"), async (req, res, next) => { try { res.json({ ok: true, metrics: await aiOperations.overview(req.user.sub, req.query.hours) }); } catch (error) { next(error); } });
  router.post("/speech", auth, requirePermission("chat"), speechLimiter, async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const lang = typeof req.body?.lang === "string" ? req.body.lang : "";
    const allowedLanguages = new Set(["th-TH", "en-US", "ja-JP", "ko-KR", "ar-SA", "ru-RU", "zh-CN"]);
    if (!text || text.length > 180 || !allowedLanguages.has(lang)) return res.status(400).json({ ok: false, error: "invalid_speech_request" });
    try {
      let audio;
      let voiceProfile;
      let neuralError;
      for (let attempt = 0; attempt < 2 && !audio; attempt += 1) {
        try {
          const neural = await synthesizeSentinelMaleVoice(text, lang);
          audio = neural.audio;
          voiceProfile = neural.voice;
        } catch (error) {
          neuralError = error;
        }
      }
      if (!audio) {
        audit.record("sentinel.neural_speech_failed", { userId: req.user.sub, lang, error: String(neuralError?.message || neuralError) });
        // The generic source voice is not guaranteed to be male. For Thai and
        // English fail closed so the client can use only a confirmed male
        // system voice instead of mixing a female fallback into Sentinel.
        if (lang === "th-TH" || lang === "en-US") throw neuralError || new Error("male_neural_speech_unavailable");
        const upstreamUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
        const upstream = await fetch(upstreamUrl, { headers: { Accept: "audio/mpeg", "User-Agent": "Panthorium-Sentinel/15" }, signal: AbortSignal.timeout(12000) });
        if (!upstream.ok) throw new Error(`speech_upstream_${upstream.status}`);
        audio = Buffer.from(await upstream.arrayBuffer());
        if (!audio.length || audio.length > 1024 * 1024) throw new Error("speech_upstream_invalid_size");
        voiceProfile = "standard-source-fallback";
      }
      res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "Content-Length": String(audio.length), "X-Sentinel-Voice-Profile": voiceProfile }).send(audio);
    } catch (error) {
      audit.record("sentinel.speech_failed", { userId: req.user.sub, lang, error: error.message });
      res.status(502).json({ ok: false, error: "speech_unavailable" });
    }
  });
  router.get("/agent/tools", auth, agentLimiter, (req, res) => res.json({ ok: true, tools: agentService.catalogFor(req.user) }));
  router.post("/speech/transcribe", auth, requirePermission("chat"), speechLimiter, async (req, res) => {
    try {
      const value = typeof req.body?.audio === "string" ? req.body.audio : "";
      const match = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/i.exec(value);
      if (!match || match[2].length > 700000) return res.status(400).json({ ok: false, error: "invalid_audio" });
      const audio = Buffer.from(match[2], "base64");
      if (!audio.length || audio.length > 512 * 1024) return res.status(413).json({ ok: false, error: "audio_too_large" });
      const result = await sentinel.providers.transcribeAudio(audio, match[1], req.body?.language);
      res.json({ ok: true, text: result.text, provider: result.provider, model: result.model });
    } catch (error) {
      audit.record("sentinel.transcription_failed", { userId: req.user?.sub, error: error.message });
      res.status(502).json({ ok: false, error: "transcription_unavailable" });
    }
  });
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
      audit.record("sentinel.chat_stream", { userId: req.user.sub, sessionId: sid, provider: result.provider || null, model: result.model || null, usage: result.usage || null, latencyMs: result.latencyMs || null, ok: result.ok });
      if (!result.ok) event("error", { error: result.error || "stream_failed" });
      else event("done", { sessionId: sid, provider: result.provider || null, model: result.model || null, usage: result.usage || null, latencyMs: result.latencyMs || null, streaming: result.streaming || null });
    } catch (streamError) {
      event("error", { error: "internal_error" });
      audit.record("sentinel.chat_stream", { userId: req.user.sub, sessionId: sid, ok: false });
      audit.record("sentinel.stream_failed", { userId: req.user.sub, sessionId: sid, error: streamError.message });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
  router.post("/chat", auth, requirePermission("chat"), aiLimiter, async (req, res) => { try { const error = validChatBody(req.body || {}); if (error) return res.status(400).json({ ok: false, error }); const { message, sessionId, provider, model, voice } = req.body || {}; const sid = sessionId || req.headers["x-session-id"] || randomUUID(); const result = await sentinel.chat({ sessionId: sid, userId: req.user.sub, message, mode: "default", provider: provider?.toLowerCase(), model, voiceMode: voice === true }); audit.record("sentinel.chat", { userId: req.user.sub, sessionId: sid, provider: result.provider || null, model: result.model || null, usage: result.usage || null, latencyMs: result.latencyMs || null, ok: result.ok }); res.json({ ...result, sessionId: sid }); } catch (err) { res.status(500).json({ ok: false, error: "internal_error" }); } });
  router.post("/sentinel/command", auth, aiLimiter, async (req, res, next) => {
    try {
      const { command, provider } = req.body || {};
      if (!validText(command, 8000)) return res.status(400).json({ ok: false, error: "invalid_command" });
      if (provider != null && !validText(provider, 40)) return res.status(400).json({ ok: false, error: "invalid_provider" });
      const functionCommand = windowCatalog.parseFunction(command);
      if (functionCommand) {
        if (!windowCatalog.allowed(windowCatalog.apps.find(app => app.id === functionCommand.appId), req.user)) return res.status(403).json({ ok: false, error: 'voice_action_permission_denied', action: functionCommand.action });
        if (functionCommand.requiresConfirmation && req.body?.confirmed !== true) return res.status(409).json({ ok: true, confirmationRequired: true, voiceAction: true, pendingAction: { action: functionCommand.action, command, reason: 'การทำงานนี้อาจใช้ทรัพยากรหรือเปลี่ยนข้อมูล', requiresConfirmation: true } });
        return res.json({ ok: true, executed: false, completed: false, uiPending: true, voiceAction: true, results: [{ toolId: 'window.function', ok: true, output: { ok: true, uiAction: functionCommand.action } }] });
      }
      if (/^(ปิดทุกหน้าต่าง|ปิดหน้าต่างทั้งหมด|ปิดทั้งหมด|closeallwindows)$/.test(windowCatalog.normalize(command))) {
        if (!hasVoicePermission(req.user, 'chat')) return res.status(403).json({ ok: false, error: 'voice_command_permission_denied' });
        const results = windowCatalog.apps.filter(app => windowCatalog.allowed(app, req.user)).map(app => ({ toolId: 'window.close', ok: true, output: { ok: true, uiAction: `close_${app.key}` } }));
        audit.record('sentinel.close_all_windows', { userId: req.user.sub, requestId: req.requestId });
        return res.json({ ok: true, executed: false, completed: false, uiPending: true, action: 'close_all_windows', results });
      }
      const direct = windowCatalog.parse(command);
      if (direct?.error) return res.status(422).json({ ok: false, error: direct.error });
      if (direct) {
        if (!windowCatalog.allowed(direct.app, req.user)) return res.status(403).json({ ok: false, error: "voice_action_permission_denied", action: direct.action });
        const execution = await agentService.execute({ user: req.user, toolId: `window.${direct.operation}`, args: { appId: direct.app.id }, requestId: req.requestId });
        if (!execution.ok) return res.status(403).json(execution);
        // Only the browser can confirm a window was actually opened or closed.
        return res.json({ ok: true, executed: false, completed: false, uiPending: true, voiceAction: true, results: [execution] });
      }
      const text = command.trim();
      const statusCommand = /^(?:ขอ|ช่วย)?(?:แสดง|ตรวจ|ตรวจสอบ|เช็ค|เช็ก)?สถานะระบบ(?:หน่อย|ครับ|ค่ะ)?$/.test(windowCatalog.normalize(text)) || /^(?:show |check )?system status[.!]?$/i.test(text);
      const search = /^(?:ค้นความรู้|ค้นหาความรู้|ค้นในคลังความรู้|search knowledge)\s+(.+)$/i.exec(text);
      if (statusCommand || search) {
        const execution = await agentService.execute({ user: req.user, toolId: statusCommand ? 'system.status' : 'knowledge.search', args: statusCommand ? {} : { query: search[1].trim() }, requestId: req.requestId });
        return res.status(execution.ok ? 200 : execution.error === 'tool_permission_denied' ? 403 : 422).json({ ok: execution.ok, error: execution.error, executed: execution.ok, completed: execution.ok, results: [execution] });
      }
      if (!hasVoicePermission(req.user, "sentinel:command")) return res.status(403).json({ ok: false, error: "voice_command_permission_denied" });
      const result = await agentWorkflow.run({ user: req.user, request: command, preferredProvider: provider?.toLowerCase(), requestId: req.requestId });
      if (result.confirmationRequired) return res.status(409).json({ ...result, voiceAction: true });
      res.status(result.ok ? 200 : 422).json({ ...result, voiceAction: true });
    } catch (error) { next(error); }
  });
  router.post("/chat/clear", auth, requirePermission("chat"), async (req, res) => { const { sessionId } = req.body || {}; if (typeof sessionId === "string" && sessionId.length <= 120) await sentinel.clearConversation(req.user.sub, sessionId); res.json({ ok: true }); });
  return router;
}
module.exports = { createApiRouter };
