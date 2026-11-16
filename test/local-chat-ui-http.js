'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { createApiRouter } = require('../routes/api');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { AgentFunctionCallingService } = require('../services/agentFunctionCallingService');
async function main() {
  const saved = { ...process.env };
  process.env.PANTHORIUM_LOCAL_QWEN = '1';
  delete process.env.PANTHORIUM_LOCAL_PROFILE; delete process.env.PANTHORIUM_QWEN_DISABLED; delete process.env.LOCAL_QWEN_DISABLE_FILE;
  const admin = { sub: 'admin', sid: 'login-admin', roles: ['administrator'], permissions: ['chat'] };
  const verifiedOwner = { sub: 'owner', sid: 'login-owner', roles: ['user'], permissions: ['chat'], email: 'rambo4075krub@gmail.com', emailVerifiedAt: '2026-01-01T00:00:00Z' };
  const principals = { admin, owner: verifiedOwner, ordinary: { ...verifiedOwner, email: 'ordinary@example.test' }, unverified: { ...verifiedOwner, emailVerifiedAt: null }, guest: { ...admin, sub: 'guest:test', roles: ['guest'] }, noChat: { ...admin, permissions: [] } };
  let revoked = false, returned = false;
  const auth = { verifyAccessToken: token => { if (!principals[token]) throw Error('invalid'); return principals[token]; },
    validateAccessSession: async () => { if (revoked) throw Error('account_session_revoked'); }, validateAccountPrincipal: async user => user };
  const agent = new AgentService({ tools: new ToolRegistry() });
  const base = new AgentFunctionCallingService({ agentService: agent });
  const invocations = [];
  const sentinel = { providers: { hybrid: true }, chat: async input => {
    invocations.push(input);
    assert.equal(input.provider, 'local');
    const execution = await input.functionCalling.execute({ user: input.user, requestId: input.requestId,
      source: 'sentinel-chat', call: { name: 'panthorium_window_open', args: { appId: 'calculator' } } });
    returned = true;
    return { ok: true, text: execution.uiCompletion || 'not available', provider: 'local', toolResults: [execution], creditsCharged: 99, billable: true };
  } };
  const app = express(); app.use(express.json()); app.use('/api', createApiRouter(sentinel, auth, { record() {} }, null, agent, null, null, null, null, null, base));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, token = 'admin', accept = 'text/event-stream') => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    for (const token of ['', 'ordinary', 'unverified', 'guest', 'noChat']) {
      const response = await post('/api/local/chat', { message: 'open calculator', uiActionProtocol: 1 }, token);
      assert([401, 403].includes(response.status), token + ' denied local access');
    }
    assert.equal(invocations.length, 0);
    const media = [{ dataUrl: 'data:image/png;base64,' + Buffer.alloc(12, 1).toString('base64'), seconds: 2 }];
    const response = await post('/api/local/chat', { message: 'open calculator', uiActionProtocol: 1, thinking: true, voice: true, media, sessionId: 'conversation-local' });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader(); let text = '', envelope;
    while (!envelope) {
      const part = await reader.read(); assert(!part.done); text += new TextDecoder().decode(part.value);
      const frame = text.split('\n\n').find(f => f.startsWith('event: ui-action'));
      if (frame) envelope = JSON.parse(frame.split('\ndata: ')[1]);
    }
    assert.equal(returned, false, 'local chat must await real UI receipt');
    assert.equal(invocations[0].thinking, true); assert.equal(invocations[0].voiceMode, true);
    assert.deepEqual(invocations[0].media, media); assert.equal(invocations[0].sessionId, 'conversation-local');
    const action = '/api/chat/ui-actions/' + envelope.id;
    assert.equal((await post(action + '/claim', { nonce: envelope.nonce }, 'owner')).status, 409);
    admin.roles = ['user'];
    assert.equal((await post(action + '/claim', { nonce: envelope.nonce })).status, 409, 'local access downgrade denies claim even while chat permission remains');
    assert.equal(returned, false);
    admin.roles = ['administrator'];
    revoked = true;
    assert.equal((await post(action + '/claim', { nonce: envelope.nonce })).status, 401);
    revoked = false;
    assert.equal((await post(action + '/claim', { nonce: envelope.nonce })).status, 200);
    assert.equal(returned, false);
    admin.roles = ['user'];
    assert.equal((await post(action + '/acknowledge', { nonce: envelope.nonce, result: { ok: true, text: 'must not accept' } })).status, 409);
    assert.equal(returned, false, 'downgraded local principal cannot certify success');
    admin.roles = ['administrator'];
    assert.equal((await post(action + '/acknowledge', { nonce: envelope.nonce, result: { ok: true, text: 'opened locally' } })).status, 200);
    while (true) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); }
    assert(returned); assert(text.includes('opened locally'));
    const doneFrame = text.split('\n\n').find(f => f.startsWith('event: done'));
    assert(doneFrame);
    const done = JSON.parse(doneFrame.split('\ndata: ')[1]);
    assert.equal(done.creditsCharged, 0); assert.equal(done.billable, false);
    assert.equal(done.provider, 'local');

    // Verified-owner eligibility can be revoked independently of chat access.
    returned = false;
    const ownerStream = await post('/api/local/chat', { message: 'open calculator', uiActionProtocol: 1 }, 'owner');
    const ownerReader = ownerStream.body.getReader(); let ownerText = '', ownerEnvelope;
    while (!ownerEnvelope) {
      const part = await ownerReader.read(); assert(!part.done); ownerText += new TextDecoder().decode(part.value);
      const frame = ownerText.split('\n\n').find(f => f.startsWith('event: ui-action'));
      if (frame) ownerEnvelope = JSON.parse(frame.split('\ndata: ')[1]);
    }
    const ownerAction = '/api/chat/ui-actions/' + ownerEnvelope.id;
    verifiedOwner.emailVerifiedAt = null;
    assert.equal((await post(ownerAction + '/claim', { nonce: ownerEnvelope.nonce }, 'owner')).status, 409);
    verifiedOwner.emailVerifiedAt = '2026-01-01T00:00:00Z';
    assert.equal((await post(ownerAction + '/claim', { nonce: ownerEnvelope.nonce }, 'owner')).status, 200);
    verifiedOwner.email = 'changed@example.test';
    assert.equal((await post(ownerAction + '/acknowledge', { nonce: ownerEnvelope.nonce, result: { ok: true } }, 'owner')).status, 409);
    assert.equal(returned, false);
    verifiedOwner.email = 'rambo4075krub@gmail.com';
    assert.equal((await post(ownerAction + '/acknowledge', { nonce: ownerEnvelope.nonce, result: { ok: true, text: 'owner opened' } }, 'owner')).status, 200);
    while (!(await ownerReader.read()).done) {}

    const legacy = await post('/api/local/chat', { message: 'open calculator' }, 'owner', 'application/json');
    assert.match(legacy.headers.get('content-type'), /application\/json/);
    const json = await legacy.json();
    assert.equal(json.creditsCharged, 0); assert.equal(json.billable, false);
    assert.equal(json.toolResults[0].error, 'function_not_available', 'legacy JSON cannot expose UI effects');
    const before = invocations.length;
    assert((await post('/api/local/chat', { message: 'open calculator', uiActionProtocol: 1 }, 'admin', 'application/json')).status >= 400, 'UI opt-in requires SSE Accept');
    assert((await post('/api/local/chat', { message: 'summarize', screen: { appId: 'notes', text: 'untrusted screen text' }, uiActionProtocol: 1 })).status >= 400, 'summary cannot opt into actions');
    process.env.PANTHORIUM_LOCAL_PROFILE = '1';
    assert((await post('/api/local/chat', { message: 'open calculator', uiActionProtocol: 1 })).status >= 400, 'inference-only local profile cannot opt into actions');
    delete process.env.PANTHORIUM_LOCAL_PROFILE;
    sentinel.providers.hybrid = false;
    assert((await post('/api/local/chat', { message: 'open calculator', uiActionProtocol: 1 })).status >= 400, 'standalone runtime cannot opt into UI actions');
    assert.equal(invocations.length, before, 'capability rejection never invokes model');
    console.log('PASS local chat SSE: local-only provider, owner/admin auth, preserved media/thinking/voice, claim/ack, zero billing and restricted capability modes');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
