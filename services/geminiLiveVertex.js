const MODEL_ID = "gemini-3.8-live";
const DEFAULT_LOCATION = "us-central1";
const ALLOWED_LOCATIONS = new Set([DEFAULT_LOCATION]);
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function resolveLiveTarget({ projectId, location = DEFAULT_LOCATION } = {}) {
  const resolvedProjectId = String(projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "").trim();
  const resolvedLocation = String(location || "").trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(resolvedProjectId)) {
    throw new Error("gemini_live_project_id_required");
  }
  if (!ALLOWED_LOCATIONS.has(resolvedLocation)) {
    throw new Error("gemini_live_location_unsupported");
  }
  return {
    model: `projects/${resolvedProjectId}/locations/${resolvedLocation}/publishers/google/models/${MODEL_ID}`,
    url: `wss://${resolvedLocation}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`
  };
}

function createSetupMessage({ model, systemInstruction = "", tools = [] } = {}) {
  const setup = {
    model,
    generation_config: {
      response_modalities: ["audio"]
    }
  };
  if (Array.isArray(tools) && tools.length) setup.tools = [{ function_declarations: tools }];
  const instruction = String(systemInstruction || "").trim();
  if (instruction) setup.system_instruction = { parts: [{ text: instruction }] };
  return { setup };
}

async function getVertexAccessToken(authClient) {
  let client = authClient;
  if (!client) {
    const { GoogleAuth } = require("google-auth-library");
    client = await new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] }).getClient();
  }
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result?.token;
  if (!token) throw new Error("gemini_live_vertex_auth_unavailable");
  return token;
}

async function connectGeminiLive({
  projectId,
  location = process.env.GEMINI_LIVE_LOCATION || DEFAULT_LOCATION,
  systemInstruction,
  tools = [],
  authClient,
  WebSocketImpl,
  handshakeTimeoutMs = 10000
} = {}) {
  let client = authClient;
  let resolvedProjectId = projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!client) {
    const { GoogleAuth } = require("google-auth-library");
    const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
    client = await auth.getClient();
    if (!resolvedProjectId) resolvedProjectId = await auth.getProjectId();
  } else if (!resolvedProjectId && typeof client.getProjectId === "function") {
    resolvedProjectId = await client.getProjectId();
  }
  const target = resolveLiveTarget({ projectId: resolvedProjectId, location });
  const token = await getVertexAccessToken(client);
  const Socket = WebSocketImpl || require("ws");
  const socket = new Socket(target.url, {
    headers: { Authorization: `Bearer ${token}` },
    handshakeTimeout: handshakeTimeoutMs,
    maxPayload: 8 * 1024 * 1024,
    perMessageDeflate: false
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      socket.removeListener("open", onOpen);
      socket.removeListener("error", onError);
    };
    const onOpen = () => {
      if (settled) return;
      settled = true;
      // Keep an error listener after the handshake so a network error cannot
      // become an unhandled EventEmitter error if the caller has not attached
      // its relay handler yet.
      socket.on("error", () => {});
      cleanup();
      socket.send(JSON.stringify(createSetupMessage({ model: target.model, systemInstruction, tools })), error => {
        if (error) socket.close(1011, "setup_failed");
      });
      resolve(socket);
    };
    const onError = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

module.exports = {
  MODEL_ID,
  DEFAULT_LOCATION,
  ALLOWED_LOCATIONS,
  resolveLiveTarget,
  createSetupMessage,
  getVertexAccessToken,
  connectGeminiLive
};

