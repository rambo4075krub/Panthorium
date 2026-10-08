const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createGeminiLiveWebSocketGateway, isAllowedOrigin } = require("../services/geminiLiveWebSocket");

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; this.closeInfo = null; }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closeInfo = { code, reason }; this.readyState = 3; this.emit("close"); }
}
class FakeWebSocketServer extends EventEmitter {
  constructor(options) { super(); this.options = options; FakeWebSocketServer.instance = this; }
  handleUpgrade(_req, _socket, _head, callback) { callback(this.client); }
  close() {}
}

async function main() {
  assert.equal(isAllowedOrigin({ headers: { origin: "https://panthorium.test", host: "panthorium.test" } }), true);
  assert.equal(isAllowedOrigin({ headers: { origin: "https://evil.test", host: "panthorium.test" } }), false);
  let upstream;
  let liveOptions;
  const client = new FakeSocket();
  const gateway = createGeminiLiveWebSocketGateway({
    authService: { verifyAccessToken: token => token === "valid" ? { sub: "user-1", permissions: ["chat"] } : (() => { throw new Error("bad_token"); })() },
    WebSocketServerImpl: FakeWebSocketServer,
    functionCalling: {
      declarationsFor: user => { assert.equal(user.sub, 'user-1'); return [{ name: 'panthorium_ai_providers' }, { name: 'panthorium_window_open' }]; },
      execute: async ({ user, call, source, requireCallId }) => {
        assert.equal(user.sub, 'user-1');
        assert.equal(source, 'gemini-live');
        assert.equal(requireCallId, true);
        const action = call.name === 'panthorium_window_open' ? 'open_calculator' : null;
        return {
          id: call.id,
          name: call.name,
          toolId: action ? 'window.open' : 'ai.providers',
          ok: true,
          output: action ? { ok: true, uiAction: action } : { providers: ['vertex'] },
          functionResponse: { name: call.name, id: call.id, response: { output: action ? { uiAction: action } : { providers: ['vertex'] } } }
        };
      }
    },
    connectLive: async options => { liveOptions = options; upstream = new FakeSocket(); return upstream; },
    projectId: "panthorium-staging"
  });
  FakeWebSocketServer.instance.client = client;
  const server = new EventEmitter();
  gateway.attach(server);
  server.emit("upgrade", { url: "/api/live", headers: { origin: "https://panthorium.test", host: "panthorium.test" } }, {}, Buffer.alloc(0));
  client.emit("message", JSON.stringify({ type: "auth", token: "valid" }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gateway.activeSessions(), 1);
  assert.deepEqual(liveOptions.tools, [{ name: 'panthorium_ai_providers' }, { name: 'panthorium_window_open' }]);
  upstream.emit("message", JSON.stringify({ setupComplete: {} }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(client.sent[0]).type, "ready");
  const audioFrame = JSON.stringify({ realtimeInput: { text: "hello" } });
  client.emit("message", audioFrame, false);
  assert.equal(upstream.sent[0], audioFrame);
  const responseFrame = JSON.stringify({ serverContent: { turnComplete: true } });
  upstream.emit("message", responseFrame, false);
  assert.equal(client.sent[2], responseFrame);
  upstream.emit("message", JSON.stringify({ toolCall: { functionCalls: [{ id: 'call-1', name: 'panthorium_ai_providers', args: {} }] } }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(upstream.sent.at(-1)), { tool_response: { function_responses: [{ name: 'panthorium_ai_providers', id: 'call-1', response: { output: { providers: ['vertex'] } } }] } });
  upstream.emit("message", JSON.stringify({ tool_call: { function_calls: [{ id: 'call-2', name: 'panthorium_window_open', args: { appId: 'calculator' } }] } }), false);
  await new Promise(resolve => setImmediate(resolve));
  const actionFrame = client.sent.map(value => JSON.parse(value)).find(value => value.type === 'uiAction');
  assert.equal(actionFrame.action, 'open_calculator');
  client.emit('message', JSON.stringify({ type: 'uiActionResult', requestId: actionFrame.requestId, result: { ok: true, text: 'เปิดเครื่องคิดเลข' } }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(upstream.sent.at(-1)).tool_response.function_responses[0].response.output, { ok: true, action: 'open_calculator', text: 'เปิดเครื่องคิดเลข' });
  client.close(1000, "done");
  assert.equal(gateway.activeSessions(), 0);

  const failedClient = new FakeSocket();
  FakeWebSocketServer.instance.client = failedClient;
  server.emit("upgrade", { url: "/api/live", headers: { origin: "https://panthorium.test", host: "panthorium.test" } }, {}, Buffer.alloc(0));
  failedClient.emit("message", JSON.stringify({ type: "auth", token: "valid" }), false);
  await new Promise(resolve => setImmediate(resolve));
  upstream.emit("close", 1008, Buffer.from("model/location rejected"));
  assert.equal(failedClient.closeInfo.code, 1011);
  assert.equal(failedClient.closeInfo.reason, "live_upstream_closed:1008:model/location rejected");
  assert.equal(gateway.activeSessions(), 0);
  const deniedClient = new FakeSocket();
  FakeWebSocketServer.instance.client = deniedClient;
  server.emit("upgrade", { url: "/api/live", headers: { origin: "https://panthorium.test", host: "panthorium.test" } }, {}, Buffer.alloc(0));
  deniedClient.emit("message", JSON.stringify({ type: "auth", token: "invalid" }), false);
  assert.equal(deniedClient.closeInfo.code, 4401);
  gateway.close();
  console.log("Gemini Live WebSocket gateway tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
