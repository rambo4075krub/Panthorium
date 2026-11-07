'use strict';
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { newDb } = require('pg-mem');
const { UserMailboxService } = require('../services/mailbox/service');
const { MailProvider, PROVIDERS, mimeMessage } = require('../services/mailbox/providers');

(async () => {
  const { Pool } = newDb().adapters.createPg(), pool = new Pool();
  const user = { sub: randomUUID(), email: 'owner@workspace.example', emailVerifiedAt: new Date().toISOString() };
  const env = { USER_MAILBOX_ENABLED: '1', USER_MAILBOX_AI_POLICY_VERIFIED: '1', USER_MAILBOX_ENCRYPTION_KEY: randomBytes(32).toString('base64'), USER_MAILBOX_PUBLIC_ORIGIN: 'https://panthorium.example', USER_MAILBOX_GOOGLE_CLIENT_ID: 'standard', USER_MAILBOX_GOOGLE_CLIENT_SECRET: 'fixture', USER_MAILBOX_GOOGLE_AGENT_CLIENT_ID: 'agent', USER_MAILBOX_GOOGLE_AGENT_CLIENT_SECRET: 'fixture', USER_MAILBOX_MICROSOFT_CLIENT_ID: 'retired', USER_MAILBOX_MICROSOFT_CLIENT_SECRET: 'retired' };
  let calls = 0, profile = user.email, revoked = false;
  const fetchImpl = async url => {
    calls++;
    assert(!url.includes('microsoft') && !url.includes('graph.'), 'no retired provider request');
    if (url.endsWith('/token')) return revoked ? Response.json({}, { status: 400 }) : Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.modify' });
    if (url.endsWith('/profile')) return Response.json(profile ? { emailAddress: profile } : {});
    throw Error('unexpected URL');
  };
  const service = new UserMailboxService({ pool, env, fetchImpl, complete: async () => { throw Error('unexpected AI call'); } });
  try {
    assert.deepEqual(Object.keys(PROVIDERS), ['google']);
    assert.deepEqual(service.configured(), ['google']);
    assert.deepEqual(service.configured('agent'), ['google']);
    for (const provider of ['microsoft', 'outlook', 'toString', '__proto__', null]) {
      assert.throws(() => new MailProvider({ provider, token: 'fixture' }), /unsupported_mail_provider/);
      await assert.rejects(() => service.connect(user, provider), /unsupported_mail_provider/);
      await assert.rejects(() => service.callback(provider, 'code', 'a'.repeat(43)), /unsupported_mail_provider/);
    }
    assert.equal(calls, 0);
    for (const purpose of ['standard', 'agent']) {
      for (const expiresAt of [Date.now() - 1, Date.now() + 3600000]) {
        const id = 'legacy-' + purpose + expiresAt;
        await service.store.put(user, 'connection', { provider: 'microsoft', purpose, email: user.email, token: { access_token: 'unused', refresh_token: 'unused' }, expiresAt }, { id });
        await assert.rejects(() => service.read(user, { action: 'list', connectionId: id }), /unsupported_mail_provider/);
        await assert.rejects(() => service.prepare(user, { action: 'send', connectionId: id }), /unsupported_mail_provider/);
        if (purpose === 'agent') await assert.rejects(() => service.analyze(user, { connectionId: id, messageIds: ['message'] }), /unsupported_mail_provider/);
      }
    }
    const before = await service.status(user);
    assert.equal(before.providerPolicy, 'gmail_only');
    assert.equal(before.onboardingRequired, true);
    assert.deepEqual(before.connections, []);
    assert.equal(calls, 0, 'status never reads or refreshes legacy connections');

    // Unsupported callbacks cannot consume a valid Gmail state. A custom-domain Gmail address is supported.
    const state = new URL((await service.connect(user, 'google')).url).searchParams.get('state');
    await assert.rejects(() => service.callback('microsoft', 'code', state), /unsupported_mail_provider/);
    await service.callback('google', 'code', state);
    assert.equal((await service.status(user)).onboardingRequired, false);
    const cid = 'google:' + user.sub;
    profile = 'different@workspace.example';
    assert.equal((await service.status(user)).connections[0].reconnectRequired, true, 'profile must still match verified registration address');
    await assert.rejects(() => service.read(user, { action: 'list', connectionId: cid }), /reconnect_required/);

    // A Google identity without a usable Gmail profile must never create a connection.
    await service.disconnect(user); profile = null;
    const noGmail = new URL((await service.connect(user, 'google')).url).searchParams.get('state');
    await assert.rejects(() => service.callback('google', 'code', noGmail), /gmail_required/);
    assert.equal((await service.status(user)).connections.length, 0);
    profile = user.email;
    const again = new URL((await service.connect(user, 'google')).url).searchParams.get('state');
    await service.callback('google', 'code', again);
    const expired = await service.store.get(user, 'connection', cid);
    await service.store.put(user, 'connection', { ...expired, expiresAt: 0 }, { id: cid });
    revoked = true;
    assert.equal((await service.status(user)).connections[0].reconnectRequired, true);
    const afterRevocation = calls;
    await service.status(user);
    assert.equal(calls, afterRevocation, 'known revoked grants are not refreshed repeatedly');
  } finally { await pool.end(); }

  let active = 0, peak = 0, listUrl;
  const provider = new MailProvider({ provider: 'google', token: 'fixture', fetchImpl: async url => {
    listUrl = new URL(url);
    return Response.json({ messages: Array.from({ length: 11 }, (_, n) => ({ id: String(n) })), nextPageToken: 'page-2' });
  } });
  provider.read = async id => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { id, text: 'body', attachments: [] };
  };
  const listed = await provider.list({ folder: 'TRASH', cursor: 'page-1', query: 'from:sender@example.com' });
  assert.deepEqual(listed.items.map(m => m.id), Array.from({ length: 11 }, (_, n) => String(n)));
  assert.equal(peak, 4); assert.equal(listUrl.searchParams.get('includeSpamTrash'), 'true');
  assert.equal(listUrl.searchParams.get('labelIds'), 'TRASH'); assert.equal(listUrl.searchParams.get('pageToken'), 'page-1');
  assert.equal(listed.nextCursor, 'page-2'); assert.equal(listed.complete, false);
  await provider.list({ query: 'in:anywhere hello' }); assert.equal(listUrl.searchParams.get('includeSpamTrash'), 'true');
  await provider.list({ folder: 'INBOX' }); assert.equal(listUrl.searchParams.has('includeSpamTrash'), false);
  provider.read = async () => { throw Error('provider failure'); };
  await assert.rejects(() => provider.list(), /provider failure/, 'failed fetch is not an empty inbox');
  assert.doesNotThrow(() => mimeMessage({ to: ['to@example.com'], cc: [], bcc: [], subject: 'Empty attachment', text: 'body', attachments: [{ name: 'empty.txt', mime: 'text/plain', content: '' }] }, user.email));
  console.log('Gmail-only: legacy/API/native isolation, real-mailbox identity gate, custom domains, revoked grants, bounded ordered reads and Trash search passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
