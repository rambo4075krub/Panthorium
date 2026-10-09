const { URL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { ALLOWED_LOCATIONS, DEFAULT_LOCATION, connectGeminiLive } = require("./geminiLiveVertex");

const AUTH_TIMEOUT_MS = 5000;
const MAX_SESSIONS_PER_INSTANCE = 50;
const LIVE_SETUP_TIMEOUT_MS = 30000;

function safeCloseDetail(value, maxLength = 80) {
  return Array.from(String(value || ""), character => {
    const code = character.charCodeAt(0);
    return code >= 32 && code <= 126 ? character : " ";
  }).join("").replace(/ +/g, " ").trim().slice(0, maxLength);
}

function isAllowedOrigin(req, allowedOrigins = []) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (origin === "null") {
    return process.env.ALLOW_ELECTRON_ORIGIN === "1" && /\bElectron\/\d/i.test(req.headers["user-agent"] || "");
  }
  try {
    const parsed = new URL(origin);
    if (parsed.host === req.headers.host) return true;
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

function createGeminiLiveWebSocketGateway({
  authService,
  allowedOrigins = [],
  WebSocketServerImpl,
  connectLive = connectGeminiLive,
  projectId,
  location = process.env.GEMINI_LIVE_LOCATION || DEFAULT_LOCATION,
  maxSessions = MAX_SESSIONS_PER_INSTANCE,
  functionCalling = null,
  systemInstruction = "You are Sentinel, Panthorium's voice assistant. Speak naturally in Thai unless the user asks for another language. Use only the functions supplied for this session. Do not claim that an action succeeded unless its function response confirms success."
} = {}) {
  if (!authService || typeof authService.verifyAccessToken !== "function") throw new Error("gemini_live_auth_service_required");
  if (!ALLOWED_LOCATIONS.has(location)) throw new Error("gemini_live_location_unsupported");
  const Server = WebSocketServerImpl || require("ws").WebSocketServer;
  const wss = new Server({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  const sessions = new Map();

  const onConnection = client => {
    let upstream = null;
    let user = null;
    let accessToken = "";
    let userId = null;
    let settled = false;
    const pendingUiActions = new Map();
    const cancelledCallIds = new Set();
    const authTimer = setTimeout(() => client.close(4401, "authentication_required"), AUTH_TIMEOUT_MS);
    authTimer.unref?.();

    const release = () => {
      clearTimeout(authTimer);
      if (userId && sessions.get(userId) === client) sessions.delete(userId);
      for (const pending of pendingUiActions.values()) {
        clearTimeout(pending.timer);
        pending.resolve({ ok: false, error: "live_client_disconnected" });
      }
      pendingUiActions.clear();
      if (upstream && upstream.readyState < 2) upstream.close(1000, "client_closed");
    };
    client.once("close", release);
    client.once("error", release);

    const rejectAuth = (code, reason) => {
      if (settled) return;
      settled = true;
      client.close(code, reason);
    };

    client.once("message", async (data, isBinary) => {
      if (isBinary) return rejectAuth(4401, "authentication_required");
      let frame;
      try { frame = JSON.parse(String(data)); } catch { return rejectAuth(4401, "authentication_required"); }
      const token = frame?.type === "auth" && typeof frame.token === "string" ? frame.token : "";
      if (!token || token.length > 4096) return rejectAuth(4401, "authentication_required");
      try { user = authService.verifyAccessToken(token); } catch { return rejectAuth(4401, "invalid_or_expired_token"); }
      if (!(user?.permissions || []).includes("chat")) return rejectAuth(4403, "permission_denied");
      if (sessions.size >= maxSessions) return rejectAuth(4429, "live_capacity_reached");
      userId = String(user.sub || user.id || "");
      if (!userId || sessions.has(userId)) return rejectAuth(4429, "live_session_already_active");
      sessions.set(userId, client);
      accessToken = token;
      settled = true;
      clearTimeout(authTimer);
      try {
        const tools = functionCalling?.declarationsFor?.(user, { surface: "gemini-live" }) || [];
        upstream = await connectLive({ projectId, location, systemInstruction, tools, transcription: process.env.PANTHORIUM_AI_MODE === "gemini-live-only" });
      } catch (error) {
        console.warn("[Gemini Live] upstream connection failed", String(error?.message || error).slice(0, 160));
        client.close(1011, `live_upstream_unavailable:${safeCloseDetail(error?.message)}`.slice(0, 123));
        release();
        return;
      }
      if (client.readyState !== 1) return release();
      let readySent = false;
      const setupStartedAt = Date.now();
      const setupTimer = setTimeout(() => {
        if (!readySent && client.readyState < 2) {
          console.warn("[Gemini Live] setup timed out", JSON.stringify({
            elapsedMs: Date.now() - setupStartedAt,
            upstreamReadyState: upstream?.readyState,
            upstreamBufferedAmount: upstream?.bufferedAmount
          }));
          client.close(1011, "live_setup_timeout");
        }
      }, LIVE_SETUP_TIMEOUT_MS);
      setupTimer.unref?.();
      const sendClient = value => { if (client.readyState === 1) client.send(JSON.stringify(value)); };
      const currentUser = () => {
        const fresh = authService.verifyAccessToken(accessToken);
        const freshId = String(fresh?.sub || fresh?.id || "");
        if (!freshId || freshId !== userId || !(fresh.permissions || []).includes("chat")) throw new Error("live_auth_expired");
        return fresh;
      };
      const dispatchUiAction = (action, callId) => new Promise(resolve => {
        if (client.readyState !== 1) return resolve({ ok: false, error: "live_client_disconnected" });
        const requestId = randomUUID();
        const timer = setTimeout(() => {
          pendingUiActions.delete(requestId);
          resolve({ ok: false, error: "ui_action_timeout" });
        }, 10000);
        timer.unref?.();
        pendingUiActions.set(requestId, { resolve, timer });
        sendClient({ type: "uiAction", requestId, callId, action });
      });
      const sendFunctionResponses = responses => {
        if (upstream?.readyState === 1 && responses.length) {
          upstream.send(JSON.stringify({ tool_response: { function_responses: responses } }));
        }
      };
      const handleToolCall = async frame => {
        const toolCall = frame.toolCall || frame.tool_call || {};
        const calls = toolCall.functionCalls || toolCall.function_calls || [];
        if (!Array.isArray(calls) || !calls.length) return;
        const responses = [];
        for (const call of calls.slice(0, 8)) {
          const id = String(call?.id || "").slice(0, 128);
          if (id && cancelledCallIds.has(id)) {
            responses.push({ name: String(call?.name || "unknown_function"), id, response: { error: "tool_call_cancelled" } });
            cancelledCallIds.delete(id);
            continue;
          }
          let freshUser;
          try { freshUser = currentUser(); }
          catch {
            responses.push({ name: String(call?.name || "unknown_function"), ...(id ? { id } : {}), response: { error: "authentication_required" } });
            if (client.readyState < 2) client.close(4401, "invalid_or_expired_token");
            continue;
          }
          const execution = functionCalling?.execute
            ? await functionCalling.execute({ user: freshUser, call, requestId: id || undefined, source: "gemini-live", requireCallId: true })
            : { functionResponse: { name: String(call?.name || "unknown_function"), ...(id ? { id } : {}), response: { error: "function_not_available" } }, ok: false };
          let functionResponse = execution.functionResponse;
          const cancelledAfterExecution = id && cancelledCallIds.has(id);
          if (cancelledAfterExecution) {
            cancelledCallIds.delete(id);
            functionResponse = { ...functionResponse, response: { error: "tool_call_cancelled" } };
          } else if (execution.ok && execution.output?.uiAction) {
            const uiResult = await dispatchUiAction(execution.output.uiAction, id);
            functionResponse = {
              ...functionResponse,
              response: uiResult.ok
                ? { output: { ok: true, action: execution.output.uiAction, text: String(uiResult.text || "").slice(0, 240) } }
                : { error: uiResult.error || "ui_action_failed" }
            };
          }
          responses.push(functionResponse);
          sendClient({ type: "toolResult", callId: id, toolId: execution.toolId || null, ok: execution.ok === true, error: execution.error || null });
        }
        for (const call of calls.slice(8)) {
          responses.push({ name: String(call?.name || "unknown_function"), ...(call?.id ? { id: String(call.id).slice(0, 128) } : {}), response: { error: "too_many_function_calls" } });
        }
        sendFunctionResponses(responses);
      };
      client.on("message", (message, binary) => {
        if (binary || upstream?.readyState !== 1) {
          if (binary && upstream?.readyState === 1) upstream.send(message, { binary: true });
          return;
        }
        let frame;
        try { frame = JSON.parse(String(message)); } catch { return; }
        if (frame?.type === "uiActionResult") {
          const pending = pendingUiActions.get(String(frame.requestId || ""));
          if (!pending) return;
          pendingUiActions.delete(String(frame.requestId));
          clearTimeout(pending.timer);
          pending.resolve({ ok: frame.result?.ok === true, error: String(frame.result?.error || "ui_action_failed").slice(0, 120), text: String(frame.result?.text || "").slice(0, 240) });
          return;
        }
        // Tool responses and setup frames are server-owned. Only user input is
        // relayed from the browser to the provider.
        if (frame.toolResponse || frame.tool_response || frame.setup || frame.setupComplete || frame.setup_complete) return;
        upstream.send(message);
      });
      upstream.on("message", (message, binary) => {
        let frame = null;
        // Vertex can send JSON in binary WebSocket frames. The opcode does not
        // identify raw PCM: audio is base64 inside the JSON server message.
        try { frame = JSON.parse(String(message)); } catch (_) {}
        if (frame && typeof frame === "object" && !Array.isArray(frame)) {
          if (frame?.error) console.warn("[Gemini Live] upstream message error", JSON.stringify(frame.error).slice(0, 500));
          if (!readySent && (frame?.setupComplete || frame?.setup_complete)) {
            readySent = true;
            clearTimeout(setupTimer);
            console.info("[Gemini Live] setup complete", JSON.stringify({ elapsedMs: Date.now() - setupStartedAt, binary: binary === true }));
            sendClient({ type: "ready" });
          }
          const cancellation = frame?.toolCallCancellation || frame?.tool_call_cancellation;
          const cancelledIds = cancellation?.ids || [];
          for (const id of cancelledIds) {
            const key = String(id || "").slice(0, 128);
            if (key) cancelledCallIds.add(key);
          }
          if (frame?.toolCall || frame?.tool_call) {
            handleToolCall(frame).catch(error => {
              console.warn("[Gemini Live] function call failed", String(error?.message || error).slice(0, 160));
              const calls = (frame.toolCall || frame.tool_call)?.functionCalls || (frame.toolCall || frame.tool_call)?.function_calls || [];
              sendFunctionResponses(calls.filter(call => call?.name).map(call => ({ name: call.name, ...(call.id ? { id: String(call.id).slice(0, 128) } : {}), response: { error: "function_execution_failed" } })));
            });
            return;
          }
        } else {
          console.warn("[Gemini Live] invalid upstream JSON frame");
          if (client.readyState < 2) client.close(1011, "live_upstream_invalid_frame");
          return;
        }
        // Normalize provider JSON to text so browser clients can parse it.
        sendClient(frame);
      });
      upstream.once("close", (code, reason) => {
        const closeReason = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
        console.warn("[Gemini Live] upstream closed", JSON.stringify({ code, reason: closeReason.slice(0, 240) }));
        if (client.readyState < 2) client.close(1011, `live_upstream_closed:${Number(code) || 0}:${safeCloseDetail(closeReason)}`.slice(0, 123));
      });
      upstream.once("error", error => {
        console.warn("[Gemini Live] upstream socket error", String(error?.message || error).slice(0, 240));
        if (client.readyState < 2) client.close(1011, `live_upstream_error:${safeCloseDetail(error?.message)}`.slice(0, 123));
      });
    });

  };

  wss.on("connection", onConnection);
  const handleUpgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, "https://panthorium.invalid").pathname; } catch { return; }
    if (pathname !== "/api/live") return;
    if (!isAllowedOrigin(req, allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, client => wss.emit("connection", client, req));
  };

  return {
    attach(server) { server.on("upgrade", handleUpgrade); return this; },
    close() {
      for (const client of sessions.values()) client.close(1001, "server_shutdown");
      sessions.clear();
      wss.close();
    },
    activeSessions() { return sessions.size; }
  };
}

module.exports = { AUTH_TIMEOUT_MS, MAX_SESSIONS_PER_INSTANCE, isAllowedOrigin, createGeminiLiveWebSocketGateway };


