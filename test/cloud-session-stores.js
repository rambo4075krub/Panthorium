'use strict';
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { VoiceSessionRepository } = require('../services/voiceSessionRepository');
const { UsageLedgerRepository, scrubUsage } = require('../services/usageLedgerRepository');

const future = () => new Date(Date.now()+60000).toISOString();
const past = () => new Date(Date.now()-60000).toISOString();
async function main() {
  await assert.rejects(()=>new VoiceSessionRepository({ required:true }).init(),/voice_session_database_required/);
  await assert.rejects(()=>new UsageLedgerRepository({ required:true }).init(),/usage_database_required/);
  const unavailable=new VoiceSessionRepository(); await unavailable.init();
  assert.equal(await unavailable.get({ userId:'alice',sessionId:'session-1' }),null);
  await assert.rejects(()=>unavailable.claim({ userId:'alice',sessionId:'session-1',ownerId:'replica-a' }),/voice_session_store_unavailable/);
  const unavailableUsage=new UsageLedgerRepository({ required:true });
  await assert.rejects(()=>unavailableUsage.record({ userId:'alice' }),/usage_store_unavailable/);

  // pg-mem verifies query predicates and conflict behavior, not PostgreSQL
  // transaction scheduling or lock contention between actual processes. It also
  // returns an unchanged conflict row when UPSERT WHERE is false; claim verifies
  // the returned owner and session rather than relying solely on row count.
  const db=newDb({ noAstCoverageCheck:true });
  const pool=new (db.adapters.createPg().Pool)();
  const one=new VoiceSessionRepository({ pool,required:true,secret:'test-only-secret' });
  const two=new VoiceSessionRepository({ pool,required:true,secret:'test-only-secret' });
  const wrongKey=new VoiceSessionRepository({ pool,required:true,secret:'different-test-secret' });
  try {
    await one.init(); await two.init(); await wrongKey.init();
    const secretHandle='provider-resume-handle-do-not-log';
    await one.put({ userId:'alice',sessionId:'session-1',handle:secretHandle,expiresAt:future(),actionPending:true });
    const row=(await pool.query('SELECT * FROM panthorium_voice_checkpoints')).rows[0];
    assert(!JSON.stringify(row).includes(secretHandle),'database never stores plaintext handle');
    assert.equal(row.action_pending,true);
    assert.equal((await two.get({ userId:'alice',sessionId:'session-1' })).handle,secretHandle,'another replica can decrypt');
    assert.equal((await two.get({ userId:'alice',sessionId:'session-1' })).actionPending,true);
    assert.equal(await two.get({ userId:'bob',sessionId:'session-1' }),null);
    assert.equal(await two.get({ userId:'alice',sessionId:'session-2' }),null);
    assert.equal(await wrongKey.get({ userId:'alice',sessionId:'session-1' }),null,'wrong encryption key fails closed');
    await two.delete({ userId:'bob',sessionId:'session-1' });
    assert(await one.get({ userId:'alice',sessionId:'session-1' }),'cross-owner delete cannot erase handle');
    await one.put({ userId:'alice',sessionId:'session-1',handle:secretHandle,expiresAt:future() });
    const changed=(await pool.query('SELECT encrypted_handle FROM panthorium_voice_checkpoints')).rows[0].encrypted_handle;
    assert.notEqual(changed,row.encrypted_handle,'fresh random IV for repeated handle');
    // Bind ciphertext authentication to row identity, not only the common key.
    await pool.query('INSERT INTO panthorium_voice_checkpoints(user_id,session_id,encrypted_handle,expires_at) VALUES($1,$2,$3,$4)',['bob','session-1',changed,future()]);
    assert.equal(await two.get({ userId:'bob',sessionId:'session-1' }),null,'copied ciphertext cannot cross user');
    await pool.query('INSERT INTO panthorium_voice_checkpoints(user_id,session_id,encrypted_handle,expires_at) VALUES($1,$2,$3,$4)',['alice','session-2',changed,future()]);
    assert.equal(await two.get({ userId:'alice',sessionId:'session-2' }),null,'copied ciphertext cannot cross session');
    await pool.query('UPDATE panthorium_voice_checkpoints SET encrypted_handle=$1 WHERE user_id=$2 AND session_id=$3',['corrupt','alice','session-1']);
    assert.equal(await one.get({ userId:'alice',sessionId:'session-1' }),null,'corrupt ciphertext fails closed');
    await one.put({ userId:'alice',sessionId:'session-1',handle:secretHandle,expiresAt:new Date(Date.now()+86400000).toISOString() });
    const capped=await one.get({ userId:'alice',sessionId:'session-1' });
    assert(Date.parse(capped.expiresAt)<=Date.now()+15*60000,'resumption expires within configured maximum');
    await pool.query('UPDATE panthorium_voice_checkpoints SET expires_at=$1 WHERE user_id=$2',[past(),'alice']);
    assert.equal(await one.get({ userId:'alice',sessionId:'session-1' }),null,'expired checkpoint is inaccessible before purge');
    await one.purgeExpired();
    assert.equal((await pool.query('SELECT * FROM panthorium_voice_checkpoints WHERE user_id=$1',['alice'])).rows.length,0);
    await one.put({ userId:'alice',sessionId:'delete-me',handle:'temporary',expiresAt:future() });
    await one.delete({ userId:'alice',sessionId:'delete-me' });
    assert.equal(await one.get({ userId:'alice',sessionId:'delete-me' }),null);
    for (const invalid of ['', 'x'.repeat(16385), null, {}]) await assert.rejects(()=>one.put({ userId:'alice',sessionId:'session-1',handle:invalid,expiresAt:future() }),/invalid_voice_session_handle/);
    for (const invalid of [past(),'not-a-date',0,null,'']) await assert.rejects(()=>one.put({ userId:'alice',sessionId:'session-1',handle:'valid',expiresAt:invalid }),/invalid_voice_session_expiry/);
    await assert.rejects(()=>one.get({ userId:'../alice',sessionId:'session-1' }),/invalid_voice_session_identity/);
    const noKey=new VoiceSessionRepository({ pool }); await noKey.init();
    await assert.rejects(()=>noKey.put({ userId:'alice',sessionId:'session-1',handle:'valid' }),/voice_session_encryption_unavailable/);

    assert.equal(await one.claim({ userId:'alice',sessionId:'session-a',ownerId:'replica-a' }),true);
    assert.equal(await two.claim({ userId:'alice',sessionId:'session-b',ownerId:'replica-b' }),false,'distinct owner cannot take active lease');
    assert.equal(await two.renew({ userId:'alice',ownerId:'replica-b' }),false,'wrong owner cannot renew');
    await two.release({ userId:'alice',ownerId:'replica-b' });
    assert.equal(await one.renew({ userId:'alice',ownerId:'replica-a' }),true,'wrong release did not remove lease');
    assert.equal(await two.renew({ userId:'bob',ownerId:'replica-a' }),false,'same owner id cannot renew another user lease');
    await two.release({ userId:'bob',ownerId:'replica-a' });
    assert.equal(await two.claim({ userId:'bob',sessionId:'session-c',ownerId:'replica-b' }),true,'another user has independent lease');
    await pool.query('UPDATE panthorium_voice_leases SET expires_at=$1 WHERE user_id=$2',[past(),'alice']);
    assert.equal(await one.renew({ userId:'alice',ownerId:'replica-a' }),false,'expired owner cannot renew');
    assert.equal(await two.claim({ userId:'alice',sessionId:'session-b',ownerId:'replica-b' }),true,'expired lease may be taken over');
    assert.equal(await one.renew({ userId:'alice',ownerId:'replica-a' }),false,'old replica cannot renew after handoff');
    await one.release({ userId:'alice',ownerId:'replica-a' });
    assert.equal(await two.renew({ userId:'alice',ownerId:'replica-b' }),true,'old replica cannot release successor lease');
    await two.release({ userId:'alice',ownerId:'replica-b' });
    assert.equal(await one.claim({ userId:'alice',sessionId:'session-new',ownerId:'replica-a' }),true);
    await pool.query('UPDATE panthorium_voice_leases SET expires_at=$1',[past()]);
    await one.purgeExpired();
    assert.equal((await pool.query('SELECT * FROM panthorium_voice_leases')).rows.length,0);

    const usageOne=new UsageLedgerRepository({ pool,required:true });
    const usageTwo=new UsageLedgerRepository({ pool,required:true });
    await usageOne.init(); await usageTwo.init();
    const unsafe={ promptTokenCount:12,responseTokenCount:3,totalTokenCount:15,prompt_token_count:7,thoughtsTokenCount:-4,cachedContentTokenCount:'secret-in-counter',toolUsePromptTokenCount:{ secret:'secret-in-object' },transcript:'secret-transcript',prompt:'secret-prompt',apiKey:'secret-key',promptTokensDetails:[{ modality:'AUDIO',tokenCount:12,transcript:'nested-secret',secret:'nested-key' },{ modality:'TEXT',tokenCount:4.2 },{ modality:'SECRET TEXT',tokenCount:2 }],response_tokens_details:[{ modality:'TEXT',token_count:3,content:'nested-content' }] };
    const expected={ promptTokenCount:12,responseTokenCount:3,totalTokenCount:15,prompt_token_count:7,promptTokensDetails:[{ modality:'AUDIO',tokenCount:12 }],response_tokens_details:[{ modality:'TEXT',token_count:3 }] };
    assert.deepEqual(scrubUsage(unsafe),expected);
    await usageOne.record({ eventId:'event-1',userId:'alice',sessionId:'session-a',provider:'gemini-live',model:'model-v1',usage:unsafe,elapsedMs:23.8 });
    await usageTwo.record({ eventId:'event-1',userId:'alice',usage:{ totalTokenCount:99999 },outcome:'failed' });
    const rows=await usageTwo.list('alice'); assert.equal(rows.length,1,'retry does not duplicate or replace usage event');
    assert.deepEqual(rows[0].usage,expected); assert.equal(rows[0].elapsed_ms,23); assert.equal(rows[0].outcome,'completed');
    assert(!JSON.stringify(rows).includes('secret'),'nested and scalar unknown content is not persisted');
    assert.deepEqual(await usageTwo.list('bob'),[],'ledger is owner filtered');
    await usageTwo.record({ eventId:'event-1',userId:'bob',usage:{ totalTokenCount:88888 } });
    assert.deepEqual(await usageTwo.list('bob'),[],'event collision does not transfer ownership');
    assert.equal((await usageOne.list('alice'))[0].usage.totalTokenCount,15);
    await usageTwo.record({ eventId:'event-bob',userId:'bob',usage:{ totalTokenCount:0 },elapsedMs:-100 });
    assert.equal((await usageTwo.list('bob'))[0].elapsed_ms,0);
    for (const input of [{ userId:'',eventId:'event-invalid' },{ userId:{ id:'alice' },eventId:'event-invalid' },{ userId:'alice',eventId:'' },{ userId:'alice',eventId:null }]) await assert.rejects(()=>usageOne.record(input),/invalid_usage_identity/);
    const circular={}; circular.promptTokenCount=circular;
    assert.deepEqual(scrubUsage(circular),{},'scrubbing does not stringify untrusted objects');
    assert.deepEqual(scrubUsage({ totalTokenCount:Infinity,responseTokenCount:NaN,promptTokenCount:2**54 }),{});
    assert.deepEqual(scrubUsage(null),{});
    console.log('PASS cloud session stores: encrypted identity-bound checkpoints, expiry, replica lease ownership, idempotent scrubbed owner-scoped usage');
  } finally { await pool.end(); }
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
