'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createGeminiLiveWebSocketGateway } = require('../services/geminiLiveWebSocket');
class Socket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; }
  send(data) { this.sent.push(data); }
  close(code) { this.code = code; this.readyState = 3; this.emit('close'); }
}
class Server extends EventEmitter {
  constructor() { super(); Server.instance = this; }
  handleUpgrade(_req, _socket, _head, callback) { callback(this.client); }
  close() {}
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
(async () => {
  const client = new Socket(), upstream = new Socket(), http = new EventEmitter();
  let email = 'before@example.com', revoked = false, checks = 0, executions = 0;
  const gateway = createGeminiLiveWebSocketGateway({
    projectId: 'fixture', WebSocketServerImpl: Server,
    authService: {
      verifyAccessToken: () => ({ sub: 'owner', roles: ['user'], permissions: ['chat'] }), // No email in JWT.
      validateAccountPrincipal: async user => { checks++; if (revoked) throw Error('account_revoked'); return { ...user, email, emailVerifiedAt: '2026-11-06' }; }
    },
    connectLive: async () => upstream,
    functionCalling: {
      declarationsFor: () => [{ name: 'panthorium_mailbox_read' }],
      execute: async ({ user, call }) => {
        executions++; assert.equal(user.email, 'current@example.com'); assert.equal(user.emailVerifiedAt, '2026-11-06');
        return { ok: true, toolId: 'mailbox.read', functionResponse: { id: call.id, name: call.name, response: { output: { connections: [] } } } };
      }
    }
  });
  try {
    Server.instance.client = client; gateway.attach(http);
    http.emit('upgrade', { url: '/api/live', headers: { origin: 'https://panthorium.test', host: 'panthorium.test' } }, {}, Buffer.alloc(0));
    client.emit('message', JSON.stringify({ type: 'auth', token: 'fixture' }), false); await settle();
    upstream.emit('message', JSON.stringify({ setupComplete: {} }), false); await settle();
    email = 'current@example.com';
    upstream.emit('message', JSON.stringify({ toolCall: { functionCalls: [{ id: 'mail-1', name: 'panthorium_mailbox_read', args: { action: 'status' } }] } }), false); await settle();
    assert.equal(executions, 1); assert(checks >= 2, 'mail access revalidates current account without waiting for monitor');
    revoked = true;
    upstream.emit('message', JSON.stringify({ toolCall: { functionCalls: [{ id: 'mail-2', name: 'panthorium_mailbox_read', args: { action: 'list' } }] } }), false); await settle();
    assert.equal(executions, 1, 'revoked account cannot read email on an already-open voice session');
    assert.equal(client.code, 4401);
  } finally { client.close(1000); gateway.close(); }
  console.log('Mailbox Live: database email hydration, fresh identity and immediate account-revocation enforcement passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
