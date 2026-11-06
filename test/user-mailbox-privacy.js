'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { newDb, DataType } = require('pg-mem');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { ConversationRepository } = require('../services/conversationRepository');

(async () => {
  let pool, admin, schema;
  if (process.argv.includes('--postgres')) {
    if (!process.env.TEST_DATABASE_URL) throw Error('TEST_DATABASE_URL is required; application databases are never used');
    const { Pool } = require('pg');
    schema = 'mailbox_privacy_' + randomBytes(10).toString('hex');
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public -c statement_timeout=15000` });
  } else {
    const db = newDb(); db.public.registerFunction({ name: 'clock_timestamp', returns: DataType.timestamptz, implementation: () => new Date(), impure: true });
    const { Pool } = db.adapters.createPg(); pool = new Pool();
  }
  const key = randomBytes(32).toString('base64');
  const ledger = new ActionLedgerRepository({ pool, mailboxEncryptionKey: key });
  const conversations = new ConversationRepository({ pool, contentEncryptionKey: key, encryptContent: true });
  try {
    await ledger.init(); await conversations.init();
    const args = { action: 'send', to: ['recipient@example.com'], subject: 'Private subject', text: 'Private body' };
    const action = await ledger.propose({ userId: 'owner', requestId: 'send-once', toolId: 'mailbox.write', args, requiresConfirmation: true });
    const raw = (await pool.query('SELECT args FROM panthorium_action_ledger')).rows[0].args;
    assert(raw.mailboxEncryptedV1); assert(!JSON.stringify(raw).includes('Private')); assert(!JSON.stringify(raw).includes('recipient@'));
    assert.deepEqual((await ledger.get('owner', action.actionId)).args, args);
    assert.equal(await ledger.get('other', action.actionId), null);
    assert.deepEqual((await ledger.claim('owner', action.actionId, action.approvalHash)).action.args, args);
    const result = { ok: true, output: { status: 'draft_saved', preview: 'Private receipt' } };
    assert.deepEqual((await ledger.finish('owner', action.actionId, 'succeeded', result)).result, result);
    assert(!JSON.stringify((await pool.query('SELECT result FROM panthorium_action_ledger')).rows).includes('Private receipt'));
    assert.equal((await ledger.claim('owner', action.actionId, action.approvalHash)).claimed, false);
    assert.deepEqual((await ledger.list('owner'))[0].result, result);
    assert.throws(() => new ActionLedgerRepository({ pool, mailboxEncryptionKey: randomBytes(32).toString('base64') }).decodeMailbox({ ...action, args: raw }), /authenticate|auth/i);
    const withoutKey = new ActionLedgerRepository({ pool, mailboxEncryptionKey: '' }); withoutKey.ready = true; // Shared schema is already initialized above.
    await assert.rejects(() => withoutKey.propose({ userId: 'owner', requestId: 'no-key', toolId: 'mailbox.write', args }), /encryption_not_configured/);
    await ledger.propose({ userId: 'owner', requestId: 'ordinary', toolId: 'calendar.write', args: { title: 'Ordinary' } });
    await pool.query("UPDATE panthorium_action_ledger SET created_at=$1", [new Date(Date.now() - 31 * 86400000).toISOString()]);
    await ledger.purgeMailboxExpired();
    assert.deepEqual((await pool.query('SELECT tool_id FROM panthorium_action_ledger')).rows.map(r => r.tool_id), ['calendar.write']);

    await conversations.append({ userId: 'owner', sessionId: 'mail', role: 'user', content: 'Private email request' });
    await conversations.append({ userId: 'owner', sessionId: 'mail', role: 'assistant', content: 'Private summary' });
    const stored = (await pool.query('SELECT content,content_encrypted FROM panthorium_conversation_messages')).rows;
    assert(stored.every(row => row.content_encrypted && !row.content.includes('Private')));
    assert.deepEqual((await conversations.history('owner', 'mail')).map(row => row.content), ['Private email request', 'Private summary']);
    assert.deepEqual(await conversations.history('other', 'mail'), []);
    const disabled = new ConversationRepository({ pool, contentEncryptionKey: key, encryptContent: false });
    assert.equal((await disabled.history('owner', 'mail')).length, 2, 'disabling AI does not lose access to existing encrypted history');
    await disabled.append({ userId: 'owner', sessionId: 'mail', role: 'user', content: 'Legacy-compatible text' });
    assert.equal((await conversations.history('owner', 'mail')).at(-1).content, 'Legacy-compatible text');
    await conversations.clear('owner', 'mail'); assert.equal((await conversations.history('owner', 'mail')).length, 0);
  } finally { await pool.end(); if (admin) { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); } }
  console.log('Mailbox privacy: encrypted durable arguments, receipts and conversation content; owner-bound decryption, fail-closed key handling, replay, retention and deletion passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
