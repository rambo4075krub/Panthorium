const MODEL_ID = "gemini-3.8-live";
const { VOICE_STYLE_INSTRUCTION } = require('./voiceStyle');
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

function createSetupMessage({ model, systemInstruction = "", tools = [], transcription = false, responseModality = 'audio', sessionResumption = null, contextCompression = null, maxOutputTokens = null } = {}) {
  const modality = String(responseModality).toLowerCase();
  if (!['audio', 'text'].includes(modality)) throw new Error('gemini_live_modality_unsupported');
  const setup = {
    model,
    generation_config: {
      response_modalities: [modality]
    }
  };
  if (maxOutputTokens != null) {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 65536) throw new Error('invalid_live_output_limit');
    setup.generation_config.max_output_tokens = maxOutputTokens;
  }
  if (transcription) { setup.input_audio_transcription = {}; if (modality === 'audio') setup.output_audio_transcription = {}; }
  // Official Vertex BidiGenerateContentSetup fields. Callers opt in: resumption
  // retains provider context and must not be enabled for zero-retention users.
  // https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/start-manage-session
  if (sessionResumption) {
    setup.session_resumption = {};
    if (sessionResumption.handle) {
      if (typeof sessionResumption.handle !== 'string' || sessionResumption.handle.length > 16384) throw new Error('invalid_live_resumption_handle');
      setup.session_resumption.handle = sessionResumption.handle;
    }
  }
  if (contextCompression) {
    const trigger = Number(contextCompression.triggerTokens);
    const target = Number(contextCompression.targetTokens);
    if (!Number.isInteger(trigger) || trigger < 5000 || trigger > 128000 || !Number.isInteger(target) || target < 0 || target >= trigger) throw new Error('invalid_live_context_compression');
    setup.context_window_compression = { trigger_tokens: trigger, sliding_window: { target_tokens: target } };
  }
  if (Array.isArray(tools) && tools.length) setup.tools = [{ function_declarations: tools }];
  const instruction = [String(systemInstruction || "").trim(), VOICE_STYLE_INSTRUCTION].filter(Boolean).join('\n\n');
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
  transcription = false,
  responseModality = 'audio',
  sessionResumption = null,
  contextCompression = null,
  maxOutputTokens = null,
  signal = null,
  authClient,
  WebSocketImpl,
  handshakeTimeoutMs = 10000,
  connectionTimeoutMs = 15000
} = {}) {
  require('./aiModePolicy').assertCloudAiAllowed();
  if (signal?.aborted) throw new Error('gemini_live_connection_aborted');
  if (!Number.isFinite(connectionTimeoutMs) || connectionTimeoutMs <= 0) throw new Error('invalid_live_connection_timeout');
  // The WebSocket handshake timeout does not cover ADC/token acquisition.
  // Bound the whole connection and discard late credentials after cancellation.
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket = null;
    let setup;
    const cleanup = () => {
      clearTimeout(deadline);
      socket?.removeListener("open", onOpen);
      socket?.removeListener("error", onError);
      socket?.removeListener("close", onClose);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      if (socket) {
        socket.on('error', () => {});
        if (socket.readyState == null || socket.readyState < 2) {
          try { if (socket.terminate) socket.terminate(); else socket.close(1000, 'connection_abandoned'); } catch (_) {}
        }
      }
      reject(error);
    };
    const onOpen = () => {
      if (settled) return;
      // Keep an error listener after the handshake so a network error cannot
      // become an unhandled EventEmitter error if the caller has not attached
      // its relay handler yet.
      socket.on("error", () => {});
      try {
        socket.send(JSON.stringify(setup), error => {
          if (!error) return;
          if (!settled) fail(error);
          else if (socket.readyState < 2) socket.close(1011, 'setup_failed');
        });
      } catch (error) { fail(error); return; }
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };
    const onError = error => fail(error);
    const onClose = () => fail(new Error('gemini_live_closed_before_open'));
    const onAbort = () => fail(new Error('gemini_live_connection_aborted'));
    const deadline = setTimeout(() => fail(new Error('gemini_live_connection_timeout')), connectionTimeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    const connect = async () => {
      let client = authClient;
      let resolvedProjectId = projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
      if (!client) {
        const { GoogleAuth } = require("google-auth-library");
        const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
        client = await auth.getClient();
        if (settled) return;
        if (!resolvedProjectId) resolvedProjectId = await auth.getProjectId();
      } else if (!resolvedProjectId && typeof client.getProjectId === 'function') {
        resolvedProjectId = await client.getProjectId();
      }
      if (settled) return;
      const target = resolveLiveTarget({ projectId: resolvedProjectId, location });
      setup = createSetupMessage({ model: target.model, systemInstruction, tools, transcription, responseModality, sessionResumption, contextCompression, maxOutputTokens });
      const token = await getVertexAccessToken(client);
      if (settled) return;
      const Socket = WebSocketImpl || require('ws');
      socket = new Socket(target.url, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: handshakeTimeoutMs,
        maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
      socket.once('open', onOpen);
      socket.once('error', onError);
      socket.once('close', onClose);
    };
    connect().catch(fail);
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
