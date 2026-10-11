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
  const executionCalls = [];
  const client = new FakeSocket();
  const gateway = createGeminiLiveWebSocketGateway({
    authService: { verifyAccessToken: token => token === "valid" ? { sub: "user-1", permissions: ["chat"] } : (() => { throw new Error("bad_token"); })() },
    WebSocketServerImpl: FakeWebSocketServer,
    functionCalling: {
      declarationsFor: user => { assert.equal(user.sub, 'user-1'); return [{ name: 'panthorium_ai_providers' }, { name: 'panthorium_window_open' }, { name: 'panthorium_calendar_write' }]; },
      execute: async ({ user, call, source, requireCallId, confirmed }) => {
        assert.equal(user.sub, 'user-1');
        assert.equal(source, 'gemini-live');
        assert.equal(requireCallId, true);
        executionCalls.push({ name: call.name, confirmed: confirmed === true });
        if (call.name === 'panthorium_calendar_write' && confirmed !== true) {
          return {
            id: call.id,
            name: call.name,
            toolId: 'calendar.write',
            ok: false,
            requiresConfirmation: true,
            confirmation: { toolId: 'calendar.write', description: 'Create calendar event', risk: 'medium', mutates: true, args: call.args },
            functionResponse: { name: call.name, id: call.id, response: { error: 'awaiting_user_confirmation' } }
          };
        }
        const action = call.name === 'panthorium_window_open' ? 'open_calculator' : null;
        return {
          id: call.id,
          name: call.name,
          toolId: action ? 'window.open' : call.name === 'panthorium_calendar_write' ? 'calendar.write' : 'ai.providers',
          ok: true,
          output: action ? { ok: true, uiAction: action } : call.name === 'panthorium_calendar_write' ? { event: { title: call.args.title } } : { providers: ['vertex'] },
          functionResponse: { name: call.name, id: call.id, response: { output: action ? { uiAction: action } : call.name === 'panthorium_calendar_write' ? { event: { title: call.args.title } } : { providers: ['vertex'] } } }
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
  assert.deepEqual(liveOptions.tools, [{ name: 'panthorium_ai_providers' }, { name: 'panthorium_window_open' }, { name: 'panthorium_calendar_write' }]);
  upstream.emit("message", JSON.stringify({ setupComplete: {} }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(client.sent[0]).type, "ready");
  const audioFrame = JSON.stringify({ realtimeInput: { text: "hello" } });
  client.emit("message", audioFrame, false);
  assert.equal(upstream.sent[0], audioFrame);
  const responseFrame = JSON.stringify({ serverContent: { turnComplete: true } });
  upstream.emit("message", responseFrame, false);
  assert.equal(client.sent[2], responseFrame);
  upstream.emit("message", Buffer.from(JSON.stringify({ toolCall: { functionCalls: [{ id: 'call-1', name: 'panthorium_ai_providers', args: {} }] } })), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(upstream.sent.at(-1)), { tool_response: { function_responses: [{ name: 'panthorium_ai_providers', id: 'call-1', response: { output: { providers: ['vertex'] } } }] } });
  upstream.emit("message", JSON.stringify({ tool_call: { function_calls: [{ id: 'call-2', name: 'panthorium_window_open', args: { appId: 'calculator' } }] } }), false);
  await new Promise(resolve => setImmediate(resolve));
  const actionFrame = client.sent.map(value => JSON.parse(value)).find(value => value.type === 'uiAction');
  assert.equal(actionFrame.action, 'open_calculator');
  client.emit('message', JSON.stringify({ type: 'uiActionResult', requestId: actionFrame.requestId, result: { ok: true, text: 'เปิดเครื่องคิดเลข' } }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(upstream.sent.at(-1)).tool_response.function_responses[0].response.output, { ok: true, action: 'open_calculator', text: 'เปิดเครื่องคิดเลข' });
  const createEventArgs = { action: 'create', title: 'ทดสอบนัดหมาย', startsAt: '2026-10-12T10:00:00.000Z', timeZone: 'Asia/Bangkok' };
  upstream.emit('message', JSON.stringify({ toolCall: { functionCalls: [{ id: 'calendar-call-1', name: 'panthorium_calendar_write', args: createEventArgs }] } }), false);
  await new Promise(resolve => setImmediate(resolve));
  const approvalFrame = client.sent.map(value => JSON.parse(value)).find(value => value.type === 'toolApprovalRequired');
  assert.equal(approvalFrame.callId, 'calendar-call-1');
  assert.deepEqual(approvalFrame.args, createEventArgs);
  assert.equal(executionCalls.at(-1).confirmed, false);
  const sentBeforeBlockedAudio = upstream.sent.length;
  client.emit('message', JSON.stringify({ realtimeInput: { text: 'do something else' } }), false);
  assert.equal(upstream.sent.length, sentBeforeBlockedAudio, 'live input is held while approval is pending');
  client.emit('message', JSON.stringify({ type: 'toolApprovalResult', approvalRequestId: approvalFrame.approvalRequestId, callId: approvalFrame.callId, approved: true }), false);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executionCalls.at(-1).confirmed, true, 'mutating tools execute only after explicit approval');
  assert.deepEqual(JSON.parse(upstream.sent.at(-1)).tool_response.function_responses[0].response.output, { event: { title: 'ทดสอบนัดหมาย' } });
  upstream.emit('message', JSON.stringify({ tool_call: { function_calls: [{ id: 'calendar-call-2', name: 'panthorium_calendar_write', args: { ...createEventArgs, title: 'นัดที่ยกเลิก' } }] } }), false);
  await new Promise(resolve => setImmediate(resolve));
  const deniedFrame = client.sent.map(value => JSON.parse(value)).find(value => value.type === 'toolApprovalRequired' && value.callId === 'calendar-call-2');
  client.emit('message', JSON.stringify({ type: 'toolApprovalResult', approvalRequestId: deniedFrame.approvalRequestId, callId: deniedFrame.callId, approved: false }), false);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executionCalls.filter(call => call.name === 'panthorium_calendar_write' && call.confirmed).length, 1, 'denied actions are never executed');
  assert.deepEqual(JSON.parse(upstream.sent.at(-1)).tool_response.function_responses[0].response, { error: 'user_denied' });
  client.close(1000, "done");
  assert.equal(gateway.activeSessions(), 0);

  const binaryClient = new FakeSocket();
  FakeWebSocketServer.instance.client = binaryClient;
  server.emit("upgrade", { url: "/api/live", headers: { origin: "https://panthorium.test", host: "panthorium.test" } }, {}, Buffer.alloc(0));
  binaryClient.emit("message", JSON.stringify({ type: "auth", token: "valid" }), false);
  await new Promise(resolve => setImmediate(resolve));
  upstream.emit("message", Buffer.from(JSON.stringify({ setup_complete: {} })), true);
  assert.equal(JSON.parse(binaryClient.sent[0]).type, "ready", "binary JSON setup must acknowledge readiness");
  assert.equal(typeof binaryClient.sent[1], "string", "provider JSON is relayed as text for the browser");
  const binaryAudioFrame = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }] } } };
  upstream.emit("message", Buffer.from(JSON.stringify(binaryAudioFrame)), true);
  assert.equal(typeof binaryClient.sent.at(-1), "string");
  assert.deepEqual(JSON.parse(binaryClient.sent.at(-1)), binaryAudioFrame);
  const providerError = { error: { code: 403, message: 'test provider rejection' } };
  upstream.emit("message", Buffer.from(JSON.stringify(providerError)), true);
  assert.deepEqual(JSON.parse(binaryClient.sent.at(-1)), providerError, "binary provider errors remain visible");
  binaryClient.close(1000, "done");

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

