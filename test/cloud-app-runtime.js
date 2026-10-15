'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { CloudAppRuntime, LIMITS } = require('../services/cloudAppRuntime');
const { CloudAppRepository } = require('../services/cloudAppRepository');
const { createCloudAppsRouter } = require('../routes/cloudApps');
const alice = {sub:'11111111-1111-4111-8111-111111111111',permissions:['chat']};
const bob = {sub:'22222222-2222-4222-8222-222222222222',permissions:['chat']};
const success = request => ({text:JSON.stringify({draft:'ร่างจากโจทย์ที่ได้รับเพื่อให้ผู้ใช้ตรวจทาน',sourceIds:JSON.parse(request.messages[0].content).sources.map(item => item.id),unknowns:['ยังไม่ได้ตรวจยืนยันข้อมูลภายนอก'],nextActions:['ตรวจรายละเอียดก่อนนำไปใช้']}),model:'test-model'});
const make = async options => { const runtime = new CloudAppRuntime({allowMemory:true,complete:success,...options}); await runtime.init(); return runtime; };
async function postgresPersistence() {
  const {newDb,DataType} = require('pg-mem');
  const database = newDb();
  // pg-mem models persistence and SQL predicates, not PostgreSQL lock scheduling.
  database.public.registerFunction({name:'hashtext',args:[DataType.text],returns:DataType.integer,implementation:()=>1});
  database.public.registerFunction({name:'pg_advisory_xact_lock',args:[DataType.integer],returns:DataType.integer,implementation:()=>1});
  const {Pool} = database.adapters.createPg();
  const pool = new Pool();
  let calls = 0;
  const provider = async request => { calls++; return success(request); };
  try {
    const first = new CloudAppRuntime({repository:new CloudAppRepository({pool}),complete:provider});
    await first.init();
    const session = await first.launch({user:alice,packId:'profession_7'});
    const body = {user:alice,sessionId:session.id,featureId:'profession_7_f1',input:'ทบทวนโจทย์ก่อนคุยลูกค้า',idempotencyKey:'persistent_sql_001'};
    const run = await first.execute(body);
    assert.equal(run.status,'draft_ready');
    const second = new CloudAppRuntime({repository:new CloudAppRepository({pool}),complete:provider});
    // Schema already initialized; pg-mem cannot plan a repeated CREATE TABLE IF NOT EXISTS.
    second.repository.ready = true;
    assert.equal((await second.get({user:alice,runId:run.id})).result.draft,run.result.draft);
    assert.equal((await second.execute(body)).id,run.id);
    assert.equal(calls,1,'new runtime instance must not rerun a persisted idempotent request');
    await assert.rejects(second.get({user:bob,runId:run.id}),/run_not_found/);
    await assert.rejects(second.execute({...body,user:bob}),/session_not_found/);
    assert.equal((await second.list({user:bob})).length,0);
    assert.equal((await second.list({user:alice,idempotencyKey:body.idempotencyKey})).length,1);
    // A terminal persisted state cannot be overwritten by an old worker.
    const before = JSON.stringify(await second.get({user:alice,runId:run.id}));
    await first.repository.finish(alice.sub,run.id,{status:'failed',result:null,error:'late-worker'});
    assert.equal(JSON.stringify(await second.get({user:alice,runId:run.id})),before);
  } finally { await pool.end(); }
}
async function adapterIntegration() {
  const { createCloudAppCompletion } = require('../services/cloudAppCompletion');
  const naturalText = 'ร่างคำถามก่อนพบลูกค้า: ขอให้ยืนยันเป้าหมายและงบประมาณก่อน ยังขาดวันส่งมอบที่ลูกค้าต้องการ';
  let actualPrompt;
  const adapter = createCloudAppCompletion({textOutputEnabled:false,complete:async request => {
    actualPrompt = request.systemPrompt;
    assert.equal(request.textOutputEnabled,false);
    return {text:naturalText,model:'mock-native-audio',usage:{totalTokenCount:20}};
  }});
  const runtime = await make({complete:adapter});
  const session = await runtime.launch({user:alice,packId:'profession_7'});
  const result = await runtime.execute({user:alice,sessionId:session.id,featureId:'profession_7_f1',input:'เตรียมคำถามสำหรับลูกค้า',sources:[{title:'ข้อมูลที่ฉันมี',content:'ลูกค้าสนใจบริการรายเดือน'}],idempotencyKey:'adapter_audio_001'});
  assert.equal(runtime.readiness().outputFormat,'spoken_draft');
  assert.equal(runtime.readiness().providerConnectionVerified,false);
  assert.ok(!actualPrompt.includes('Return ONLY valid JSON'));
  assert.equal(result.status,'draft_ready');
  assert.equal(result.result.draft,naturalText);
  assert.equal(result.result.sources[0].cited,false,'server envelope must not fabricate citations');
  assert.equal(result.result.requiresReview,true);
}
async function main() {
  let calls = 0;
  const runtime = await make({complete:async request => { calls++; assert.equal(request.tools.length,0); assert.equal(request.maxOutputTokens,1536); assert.ok(request.signal); return success(request); }});
  const catalog = runtime.catalog(alice);
  assert.equal(catalog.catalog.packs.length,31);
  assert.equal(catalog.catalog.packs.flatMap(pack => pack.features).length,186);
  assert.equal(catalog.readiness.externalActionsEnabled,false);
  assert.equal(catalog.readiness.providerConnectionVerified,false);
  assert.equal(catalog.readiness.aiReadinessBasis,'configured_not_live_verified');
  assert.equal(catalog.catalog.packs.find(pack => pack.id==='age_13_17').blocked,true);
  assert.equal(catalog.catalog.packs.find(pack => pack.id==='age_18_24').blocked,false);
  await assert.rejects(runtime.launch({user:alice,packId:'age_6_12'}),/minor_provider_policy_not_verified/);
  await assert.rejects(runtime.launch({user:{...alice,isMinor:true},packId:'profession_7'}),/minor_provider_policy_not_verified/);
  await assert.rejects(runtime.launch({user:alice,packId:'profession_7',scope:'organisation'}),/scope_not_available/);
  const session = await runtime.launch({user:alice,packId:'profession_7'});
  assert.equal(session.userId,undefined);
  const workSession = await runtime.launch({user:alice,packId:'profession_7',scope:'work'});
  assert.equal(workSession.scope,'work');
  const workRun = await runtime.execute({user:alice,sessionId:workSession.id,featureId:'profession_7_f1',input:'บริบทงานส่วนตัว',idempotencyKey:'private_work_001'});
  assert.equal(workRun.scope,'work');
  assert.equal((await runtime.list({user:alice,scope:'personal'})).length,0);
  assert.equal((await runtime.list({user:alice,scope:'work'})).length,1);
  calls = 0;
  const voice = await runtime.voiceContext({user:alice,context:{sessionId:session.id,packId:'profession_7',featureId:'profession_7_f1',scope:'personal'}});
  assert.equal(voice.capabilities.externalActions,false);
  await assert.rejects(runtime.voiceContext({user:bob,context:{sessionId:session.id,featureId:'profession_7_f1'}}),/session_not_found/);
  await assert.rejects(runtime.voiceContext({user:alice,context:{sessionId:session.id,featureId:'profession_8_f1'}}),/feature_not_found/);
  const input = {sessionId:session.id,featureId:'profession_7_f1',input:'ช่วยเตรียมคำถามก่อนพบลูกค้า',sources:[{title:'บันทึกที่ฉันเขียน',content:'ลูกค้าต้องการข้อมูลเงื่อนไขรับประกัน'}],idempotencyKey:'test_request_0001'};
  await assert.rejects(runtime.execute({user:bob,...input}),/session_not_found/);
  const run = await runtime.execute({user:alice,...input});
  assert.equal(run.status,'draft_ready');
  assert.equal(run.userId,undefined);
  assert.equal(run.result.requiresReview,true);
  assert.deepEqual(run.result.externalActionsExecuted,[]);
  assert.equal(run.result.sources[0].provenance,'user_provided_unverified');
  assert.equal(calls,1);
  const replay = await runtime.execute({user:alice,...input});
  assert.equal(replay.id,run.id); assert.equal(calls,1);
  await assert.rejects(runtime.execute({user:alice,...input,input:'changed'}),/idempotency_conflict/);
  await assert.rejects(runtime.get({user:bob,runId:run.id}),/run_not_found/);
  await assert.rejects(runtime.cancel({user:bob,runId:run.id}),/run_not_found/);
  await assert.rejects(runtime.export({user:bob,runId:run.id}),/run_not_found/);
  assert.equal((await runtime.list({user:bob})).length,0);
  assert.equal((await runtime.list({user:alice,idempotencyKey:input.idempotencyKey}))[0].id,run.id);
  assert.equal((await runtime.export({user:alice,runId:run.id})).kind,'panthorium_assisted_draft');
  await assert.rejects(runtime.execute({user:alice,...input,idempotencyKey:'feature_error',featureId:'profession_8_f1'}),/feature_not_found/);
  await assert.rejects(runtime.execute({user:alice,...input,idempotencyKey:'connector_error',connectorId:'gmail'}),/connector_unavailable/);
  await assert.rejects(runtime.execute({user:alice,...input,idempotencyKey:'external_error',mode:'external_execute'}),/external_execution_unavailable/);
  await assert.rejects(runtime.execute({user:alice,...input,idempotencyKey:'size_error_1',input:'x'.repeat(4001)}),/invalid_input/);
  await assert.rejects(runtime.execute({user:alice,...input,idempotencyKey:'size_error_2',sources:Array(6).fill({title:'a',content:'b'})}),/invalid_sources/);
  assert.equal(calls,1,'rejected jobs must never call AI');

  // Every catalog feature executes a distinct workflow prompt; gated minors are
  // enabled only in this test fixture, never by client input or runtime defaults.
  const all = await make({allowMinorProfiles:true,minorPolicyVerified:true});
  let generated = 0;
  all.complete = async request => { generated++; assert.match(request.systemPrompt,/Selected workflow:/); return success(request); };
  for (const pack of all.catalog(alice).catalog.packs) {
    for (const feature of pack.features) {
      const user = {sub:'test-owner-'+feature.id};
      const launched = await all.launch({user,packId:pack.id});
      const out = await all.execute({user,sessionId:launched.id,featureId:feature.id,input:'วิเคราะห์ข้อมูลตัวอย่างที่ให้ไว้และระบุสิ่งที่ต้องถามเพิ่ม',sources:[],idempotencyKey:'request_'+feature.id});
      assert.equal(out.status,'draft_ready',feature.id);
    }
  }
  assert.equal(generated,186);

  // No placeholder completion: provider failure, unparseable/empty output and
  // fabricated source IDs must remain failed with no apparent successful draft.
  for (const provider of [async()=>{throw new Error('secret: provider token must not leak');},async()=>({text:''}),async()=>({text:'looks useful but is not structured output'}),async()=>({text:JSON.stringify({draft:'test',unknowns:[],nextActions:[],sourceIds:['fake-source']})}),async()=>({functionCalls:[{name:'send_email'}],text:'{}'})]) {
    const rt = await make({complete:provider});
    const s = await rt.launch({user:alice,packId:'profession_1'});
    const out = await rt.execute({user:alice,sessionId:s.id,featureId:'profession_1_f1',input:'ตัวอย่างงาน',idempotencyKey:'failure_0001'});
    assert.equal(out.status,'failed'); assert.equal(out.result,null); assert.ok(!JSON.stringify(out).includes('secret:'));
  }

  // A local cancel aborts the adapter; the durable cancelled state also wins
  // if a provider ignores cancellation and resolves later.
  let release; let providerSignal;
  const pending = await make({complete:request=>{providerSignal=request.signal; return new Promise(resolve=>{release=resolve;});}});
  const pendingSession = await pending.launch({user:alice,packId:'profession_10'});
  const promise = pending.execute({user:alice,sessionId:pendingSession.id,featureId:'profession_10_f1',input:'ตรวจสอบงาน',idempotencyKey:'pending_0001'});
  await new Promise(resolve=>setImmediate(resolve));
  const running = (await pending.list({user:alice}))[0];
  assert.equal(running.status,'running');
  await assert.rejects(pending.execute({user:alice,sessionId:pendingSession.id,featureId:'profession_10_f1',input:'อีกงาน',idempotencyKey:'pending_0002'}),/run_in_progress/);
  const cancelled = await pending.cancel({user:alice,runId:running.id});
  assert.equal(cancelled.status,'cancelled'); assert.equal(providerSignal.aborted,true);
  release({text:JSON.stringify({draft:'late response',sourceIds:[],unknowns:[],nextActions:[]})});
  assert.equal((await promise).status,'cancelled');
  assert.equal((await pending.get({user:alice,runId:running.id})).result,null);

  let clock = Date.now();
  const limits = await make({clock:()=>clock});
  const expired = await limits.launch({user:alice,packId:'profession_1'});
  clock += LIMITS.sessionTtlMs+1;
  await assert.rejects(limits.execute({user:alice,sessionId:expired.id,featureId:'profession_1_f1',input:'test',idempotencyKey:'expired_001'}),/session_expired/);
  const fresh = await limits.launch({user:alice,packId:'profession_1'});
  for(let i=0;i<3;i++) await limits.execute({user:alice,sessionId:fresh.id,featureId:'profession_1_f1',input:'test',idempotencyKey:'rate_limit_'+i});
  await assert.rejects(limits.execute({user:alice,sessionId:fresh.id,featureId:'profession_1_f1',input:'test',idempotencyKey:'rate_limit_4'}),/rate_limit/);
  const prodMissing = new CloudAppRuntime({required:true,allowMemory:true,complete:success});
  await assert.rejects(prodMissing.init(),/database_required/);
  const closed = new CloudAppRuntime({complete:success}); await closed.init();
  await assert.rejects(closed.launch({user:alice,packId:'profession_1'}),/storage_unavailable/);
  const unavailable = await make({complete:null}); const unavailableSession = await unavailable.launch({user:alice,packId:'profession_1'});
  await assert.rejects(unavailable.execute({user:alice,sessionId:unavailableSession.id,featureId:'profession_1_f1',input:'test',idempotencyKey:'no_provider_1'}),/ai_unavailable/);

  // HTTP auth/CSRF-style boundaries match the existing Bearer-only API.
  const app = express(); app.use(express.json({limit:'32kb'}));
  app.use('/api/cloud-apps',createCloudAppsRouter({verifyAccessToken(token){if(token!=='alice')throw new Error('invalid');return alice;}},runtime));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const base = 'http://127.0.0.1:'+server.address().port+'/api/cloud-apps';
  try {
    assert.equal((await fetch(base+'/catalog')).status,401);
    assert.equal((await fetch(base+'/catalog',{headers:{Authorization:'Bearer alice'}})).status,200);
    assert.equal((await fetch(base+'/sessions',{method:'POST',headers:{Authorization:'Bearer alice','Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},body:JSON.stringify({packId:'profession_1'})})).status,403);
    assert.equal((await fetch(base+'/sessions',{method:'POST',headers:{Authorization:'Bearer alice','Content-Type':'text/plain'},body:'test'})).status,415);
  } finally { await new Promise(resolve=>server.close(resolve)); }
  await postgresPersistence();
  await adapterIntegration();
  console.log('Cloud apps: SQL persistence across instances, all 186 feature workflows, owner isolation, durable idempotency contract, minor gates, cancellation, provider failures, no external execution, expiry, input/rate limits and HTTP auth passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
