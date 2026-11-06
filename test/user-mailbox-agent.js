'use strict';
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { randomBytes, randomUUID } = require('node:crypto');
const { UserMailboxService } = require('../services/mailbox/service');
const { validMailboxOAuthUrl } = require('../electron/mailbox-oauth.cjs');

(async () => {
  const { Pool } = newDb().adapters.createPg(), pool = new Pool();
  const user = { sub: randomUUID(), email: 'owner@example.com', emailVerifiedAt: new Date().toISOString() };
  const env = { USER_MAILBOX_ENABLED: '1', USER_MAILBOX_AI_POLICY_VERIFIED: '1',
    USER_MAILBOX_ENCRYPTION_KEY: randomBytes(32).toString('base64'), USER_MAILBOX_PUBLIC_ORIGIN: 'https://panthorium.example',
    USER_MAILBOX_GOOGLE_CLIENT_ID: 'standard-client', USER_MAILBOX_GOOGLE_CLIENT_SECRET: 'standard-secret',
    USER_MAILBOX_GOOGLE_AGENT_CLIENT_ID: 'agent-client', USER_MAILBOX_GOOGLE_AGENT_CLIENT_SECRET: 'agent-secret' };
  let providerCalls = 0, summaries = 0;
  const exchanges = [];
  const service = new UserMailboxService({ pool, env,
    complete: async input => { summaries++; assert.equal(input.sources[0].text, 'Private fixture text'); return { ok: true, text: 'สรุปทดสอบ', provider: 'local' }; },
    fetchImpl: async (url, options) => {
      if (url.endsWith('/token')) {
        const form = new URLSearchParams(options.body), agent = form.get('client_id') === 'agent-client';
        exchanges.push({ client: form.get('client_id'), grant: form.get('grant_type') });
        assert.equal(form.get('client_secret'), agent ? 'agent-secret' : 'standard-secret');
        return Response.json({ access_token: agent ? 'agent-token' : 'standard-token', refresh_token: agent ? 'agent-refresh' : 'standard-refresh', scope: 'https://www.googleapis.com/auth/gmail.modify', expires_in: 3600 });
      }
      providerCalls++;
      if (url.endsWith('/profile')) return Response.json({ emailAddress: user.email });
      assert(url.includes('/messages/m1?'));
      assert.equal(options.headers.Authorization, 'Bearer agent-token');
      return Response.json({ id: 'm1', payload: { headers: [{ name: 'Subject', value: 'Fixture' }], mimeType: 'text/plain', body: { data: Buffer.from('Private fixture text').toString('base64url') } } });
    }
  });
  try {
    const standard = new URL((await service.connect(user, 'google')).url);
    const agent = new URL((await service.connect(user, 'google', 'agent')).url);
    assert.equal(standard.searchParams.get('client_id'), 'standard-client');
    assert.equal(agent.searchParams.get('client_id'), 'agent-client');
    assert.equal(agent.searchParams.get('redirect_uri'), standard.searchParams.get('redirect_uri'));
    assert(validMailboxOAuthUrl(agent.href, env.USER_MAILBOX_PUBLIC_ORIGIN), 'existing desktop bridge accepts the separate agent client');
    await service.callback('google', 'standard-code', standard.searchParams.get('state'));
    await service.callback('google', 'agent-code', agent.searchParams.get('state'));
    const status = await service.status(user), aiStatus = await service.agentStatus(user);
    assert.equal(status.connections.length, 2); assert.equal(status.onboardingRequired, false);
    assert.equal(aiStatus.connections.length, 1); assert.equal(aiStatus.connections[0].purpose, 'agent');
    const standardId = status.connections.find(c => c.purpose === 'standard').id;
    const agentId = aiStatus.connections[0].id;
    const before = providerCalls;
    await assert.rejects(() => service.agentRead(user, { action: 'get', connectionId: standardId, messageId: 'm1' }), /agent_connection_required/);
    await assert.rejects(() => service.manualRead(user, { action: 'get', connectionId: agentId, messageId: 'm1' }), /standard_connection_required/);
    await assert.rejects(() => service.agentRead({ ...user, sub: randomUUID() }, { action: 'get', connectionId: agentId, messageId: 'm1' }), /not_found/);
    await assert.rejects(() => service.analyze(user, { connectionId: standardId, messageIds: ['m1'] }), /agent_connection_required/);
    assert.equal(providerCalls, before, 'wrong-purpose and cross-account reads never reach the provider');
    assert.equal(summaries, 0);
    assert.equal((await service.analyze(user, { connectionId: agentId, messageIds: ['m1'], provider: 'local' })).text, 'สรุปทดสอบ');
    const saved = await service.store.get(user, 'connection', agentId);
    await service.store.put(user, 'connection', { ...saved, expiresAt: 0 }, { id: agentId });
    await service.agentRead(user, { action: 'get', connectionId: agentId, messageId: 'm1' });
    assert.deepEqual(exchanges.at(-1), { client: 'agent-client', grant: 'refresh_token' });
    await assert.rejects(() => service.callback('google', 'again', agent.searchParams.get('state')), /expired/);
    await service.disconnect(user, 'agent');
    assert.equal((await service.status(user)).connections.length, 1);
    assert.equal((await service.status(user)).onboardingRequired, false);
    assert.equal((await service.agentStatus(user)).onboardingRequired, true);
    await assert.rejects(() => service.agentRead(user, { action: 'get', connectionId: agentId, messageId: 'm1' }), /not_found/);
    await assert.rejects(() => service.connect(user, 'google', 'unsupported'), /invalid_mailbox_purpose/);
    env.USER_MAILBOX_GOOGLE_AGENT_CLIENT_ID = env.USER_MAILBOX_GOOGLE_CLIENT_ID;
    await assert.rejects(() => service.connect(user, 'google', 'agent'), /must_be_separate/);
    env.USER_MAILBOX_AI_POLICY_VERIFIED = '0';
    await assert.rejects(() => service.connect(user, 'google', 'agent'), /ai_not_enabled/);
    assert((await service.connect(user, 'google')).url, 'manual mail remains usable while AI is disabled');
  } finally { await pool.end(); }
  console.log('Mailbox agent OAuth: distinct clients and tokens, state binding, refresh isolation, cross-account/purpose denial, summary consent and independent disconnect passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
