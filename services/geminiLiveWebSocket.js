const { URL } = require("node:url");
const { ALLOWED_LOCATIONS, connectGeminiLive } = require("./geminiLiveVertex");

const AUTH_TIMEOUT_MS = 5000;
const MAX_SESSIONS_PER_INSTANCE = 50;

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
  location = process.env.GEMINI_LIVE_LOCATION || "eu",
  maxSessions = MAX_SESSIONS_PER_INSTANCE,
  systemInstruction = "You are Sentinel, Panthorium's voice assistant. Speak naturally in Thai unless the user asks for another language. Do not claim to have performed an action; this live voice session has no action tools."
} = {}) {
  if (!authService || typeof authService.verifyAccessToken !== "function") throw new Error("gemini_live_auth_service_required");
  if (!ALLOWED_LOCATIONS.has(location)) throw new Error("gemini_live_location_unsupported");
  const Server = WebSocketServerImpl || require("ws").WebSocketServer;
  const wss = new Server({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  const sessions = new Map();

  const onConnection = client => {
    let upstream = null;
    let userId = null;
    let settled = false;
    const authTimer = setTimeout(() => client.close(4401, "authentication_required"), AUTH_TIMEOUT_MS);
    authTimer.unref?.();

    const release = () => {
      clearTimeout(authTimer);
      if (userId && sessions.get(userId) === client) sessions.delete(userId);
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
      let user;
      try { user = authService.verifyAccessToken(token); } catch { return rejectAuth(4401, "invalid_or_expired_token"); }
      if (!(user?.permissions || []).includes("chat")) return rejectAuth(4403, "permission_denied");
      if (sessions.size >= maxSessions) return rejectAuth(4429, "live_capacity_reached");
      userId = String(user.sub || user.id || "");
      if (!userId || sessions.has(userId)) return rejectAuth(4429, "live_session_already_active");
      sessions.set(userId, client);
      settled = true;
      clearTimeout(authTimer);
      try {
        upstream = await connectLive({ projectId, location, systemInstruction });
      } catch (error) {
        console.warn("[Gemini Live] upstream connection failed", String(error?.message || error).slice(0, 160));
        client.close(1011, "live_upstream_unavailable");
        release();
        return;
      }
      if (client.readyState !== 1) return release();
      let readySent = false;
      const setupTimer = setTimeout(() => {
        if (!readySent && client.readyState < 2) client.close(1011, "live_setup_timeout");
      }, 10000);
      setupTimer.unref?.();
      client.on("message", (message, binary) => {
        if (upstream?.readyState === 1) upstream.send(message, { binary });
      });
      upstream.on("message", (message, binary) => {
        if (!readySent && !binary) {
          try {
            const frame = JSON.parse(String(message));
            if (frame.setupComplete || frame.setup_complete) {
              readySent = true;
              clearTimeout(setupTimer);
              if (client.readyState === 1) client.send(JSON.stringify({ type: "ready" }));
            }
          } catch (_) {}
        }
        if (client.readyState === 1) client.send(message, { binary });
      });
      upstream.once("close", () => { if (client.readyState < 2) client.close(1011, "live_upstream_closed"); });
      upstream.once("error", () => { if (client.readyState < 2) client.close(1011, "live_upstream_error"); });
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
