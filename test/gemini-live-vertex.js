const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  MODEL_ID,
  resolveLiveTarget,
  createSetupMessage,
  getVertexAccessToken,
  connectGeminiLive
} = require("../services/geminiLiveVertex");

async function main() {
  assert.equal(MODEL_ID, "gemini-3.8-live");
  assert.deepEqual(resolveLiveTarget({ projectId: "panthorium-staging", location: "eu" }), {
    model: "projects/panthorium-staging/locations/eu/publishers/google/models/gemini-3.8-live",
    url: "wss://eu-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
  });
  assert.throws(() => resolveLiveTarget({ projectId: "panthorium-staging", location: "asia-southeast1" }), /location_unsupported/);
  assert.throws(() => resolveLiveTarget({ projectId: "", location: "eu" }), /project_id_required/);
  assert.deepEqual(createSetupMessage({ model: "projects/demo/locations/eu/publishers/google/models/gemini-3.8-live", systemInstruction: "ตอบภาษาไทย" }), {
    setup: {
      model: "projects/demo/locations/eu/publishers/google/models/gemini-3.8-live",
      generation_config: { response_modalities: ["audio", "text"] },
      system_instruction: { parts: [{ text: "ตอบภาษาไทย" }] }
    }
  });
  const tools = [{ name: "panthorium_ai_providers", description: "List providers", parameters: { type: "OBJECT", properties: {} } }];
  assert.deepEqual(createSetupMessage({ model: "projects/demo/locations/eu/publishers/google/models/gemini-3.8-live", tools }).setup.tools, [{ function_declarations: tools }]);
  assert.equal(await getVertexAccessToken({ getAccessToken: async () => ({ token: "adc-token" }) }), "adc-token");
  await assert.rejects(() => getVertexAccessToken({ getAccessToken: async () => ({}) }), /auth_unavailable/);

  class FakeWebSocket extends EventEmitter {
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.sent = [];
      queueMicrotask(() => this.emit("open"));
    }
    send(value, callback) { this.sent.push(value); callback?.(); }
    close() {}
  }
  const socket = await connectGeminiLive({
    projectId: "panthorium-staging",
    location: "eu",
    systemInstruction: "Sentinel",
    tools,
    authClient: { getAccessToken: async () => ({ token: "adc-token" }) },
    WebSocketImpl: FakeWebSocket
  });
  assert.equal(socket.options.headers.Authorization, "Bearer adc-token");
  assert.deepEqual(JSON.parse(socket.sent[0]).setup.generation_config.response_modalities, ["audio", "text"]);
  assert.deepEqual(JSON.parse(socket.sent[0]).setup.tools, [{ function_declarations: tools }]);
  console.log("Gemini Live Vertex adapter tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
