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
  const client = new FakeSocket();
  const gateway = createGeminiLiveWebSocketGateway({
    authService: { verifyAccessToken: token => token === "valid" ? { sub: "user-1", permissions: ["chat"] } : (() => { throw new Error("bad_token"); })() },
    WebSocketServerImpl: FakeWebSocketServer,
    connectLive: async () => { upstream = new FakeSocket(); return upstream; },
    projectId: "panthorium-staging"
  });
  FakeWebSocketServer.instance.client = client;
  const server = new EventEmitter();
  gateway.attach(server);
  server.emit("upgrade", { url: "/api/live", headers: { origin: "https://panthorium.test", host: "panthorium.test" } }, {}, Buffer.alloc(0));
  client.emit("message", JSON.stringify({ type: "auth", token: "valid" }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gateway.activeSessions(), 1);
  assert.deepEqual(JSON.parse(client.sent[0]), { type: "ready" });
  const audioFrame = JSON.stringify({ realtimeInput: { text: "hello" } });
  client.emit("message", audioFrame, false);
  assert.equal(upstream.sent[0], audioFrame);
  const responseFrame = JSON.stringify({ serverContent: { turnComplete: true } });
  upstream.emit("message", responseFrame, false);
  assert.equal(client.sent[1], responseFrame);
  client.close(1000, "done");
  assert.equal(gateway.activeSessions(), 0);
  gateway.close();
  console.log("Gemini Live WebSocket gateway tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
