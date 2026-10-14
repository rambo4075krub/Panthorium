const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  MODEL_ID,
  DEFAULT_LOCATION,
  resolveLiveTarget,
  createSetupMessage,
  getVertexAccessToken,
  connectGeminiLive
} = require("../services/geminiLiveVertex");

// Vertex's protobuf Schema.enum is repeated string, even for INTEGER fields.
// Test every signed-in Live declaration: the guest deployment smoke omits
// account-only tools, including the video tool that previously closed with 1007.
function assertVertexSchema(schema, path) {
  if (schema.enum) {
    assert(schema.enum.every(value => typeof value === "string"), `${path}.enum must contain strings for Vertex`);
  }
  for (const [name, child] of Object.entries(schema.properties || {})) {
    assertVertexSchema(child, `${path}.properties.${name}`);
  }
  if (schema.items) assertVertexSchema(schema.items, `${path}.items`);
}

async function main() {
  assert.equal(MODEL_ID, "gemini-3.8-live");
  assert.equal(DEFAULT_LOCATION, "us-central1");
  assert.deepEqual(resolveLiveTarget({ projectId: "panthorium-staging" }), {
    model: "projects/panthorium-staging/locations/us-central1/publishers/google/models/gemini-3.8-live",
    url: "wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
  });
  assert.throws(() => resolveLiveTarget({ projectId: "panthorium-staging", location: "eu" }), /location_unsupported/);
  assert.throws(() => resolveLiveTarget({ projectId: "panthorium-staging", location: "asia-southeast1" }), /location_unsupported/);
  assert.throws(() => resolveLiveTarget({ projectId: "", location: "us-central1" }), /project_id_required/);
  assert.deepEqual(createSetupMessage({ model: "projects/demo/locations/us-central1/publishers/google/models/gemini-3.8-live", systemInstruction: "ตอบภาษาไทย" }), {
    setup: {
      model: "projects/demo/locations/us-central1/publishers/google/models/gemini-3.8-live",
      generation_config: { response_modalities: ["audio"] },
      system_instruction: { parts: [{ text: "ตอบภาษาไทย" }] }
    }
  });
  const tools = [{ name: "panthorium_ai_providers", description: "List providers", parameters: { type: "OBJECT", properties: {} } }];
  assert.deepEqual(createSetupMessage({ model: "projects/demo/locations/us-central1/publishers/google/models/gemini-3.8-live", tools }).setup.tools, [{ function_declarations: tools }]);
  const { AgentFunctionCallingService, TOOL_DEFINITIONS } = require("../services/agentFunctionCallingService");
  const functionCalling = new AgentFunctionCallingService({
    agentService: {
      catalogFor: () => TOOL_DEFINITIONS.map(tool => ({ id: tool.toolId, risk: "low" })),
      execute: async () => ({ ok: true })
    }
  });
  const accountTools = functionCalling.declarationsFor({ sub: "schema-test-account", roles: [], permissions: ["chat"] }, { surface: "gemini-live" });
  const accountSetup = createSetupMessage({ model: "test-model", tools: accountTools });
  for (const declaration of accountSetup.setup.tools[0].function_declarations) {
    assertVertexSchema(declaration.parameters, declaration.name);
  }
  const duration = accountSetup.setup.tools[0].function_declarations.find(tool => tool.name === "panthorium_video_generate").parameters.properties.durationSeconds;
  assert.equal(duration.type, "INTEGER", "video duration remains numeric in function-call arguments");
  assert.equal(duration.format, "enum");
  assert.deepEqual(duration.enum, ["4", "6", "8"]);
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
    location: "us-central1",
    systemInstruction: "Sentinel",
    tools,
    authClient: { getAccessToken: async () => ({ token: "adc-token" }) },
    WebSocketImpl: FakeWebSocket
  });
  assert.equal(socket.options.headers.Authorization, "Bearer adc-token");
  assert.equal(socket.url, "wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent");
  assert.deepEqual(JSON.parse(socket.sent[0]).setup.generation_config.response_modalities, ["audio"]);
  assert.deepEqual(JSON.parse(socket.sent[0]).setup.tools, [{ function_declarations: tools }]);
  console.log("Gemini Live Vertex adapter tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
