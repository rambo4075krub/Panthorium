'use strict';
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { VoiceSessionRepository } = require('../services/voiceSessionRepository');
const { CloudAppRepository } = require('../services/cloudAppRepository');
const { AgentJobRepository } = require('../services/agentJobRepository');
const { AgentAutomationRepository } = require('../services/agentAutomationRepository');
const { AgentAutomationService } = require('../services/agentAutomationService');
const { SentinelTrainingRepository } = require('../services/sentinelTrainingRepository');
const { SentinelTrainingService } = require('../services/sentinelTrainingService');
const { ReminderRepository } = require('../services/reminderRepository');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');

async function main() {
  // Intentionally never fall back to DATABASE_URL: this gate must not touch an application database accidentally.
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (process.env.CI) throw new Error('TEST_DATABASE_URL is required for the PostgreSQL integration gate in CI');
    console.log('SKIP PostgreSQL integration: TEST_DATABASE_URL is not set. No real database concurrency was tested.');
    return;
  }
  const schema = 'panthorium_ci_' + randomBytes(10).toString('hex');
  const admin = new Pool({connectionString,max:1,connectionTimeoutMillis:5000});
  let pool, created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    pool = new Pool({connectionString,max:12,connectionTimeoutMillis:5000,options:`-c search_path=${schema},public -c statement_timeout=15000`});
    const version = await pool.query('SHOW server_version_num');
    assert(Number(version.rows[0].server_version_num) >= 120000,'This gate requires PostgreSQL 12 or later');

    // Exercise additive migration against real PostgreSQL, including preexisting rows.
    await pool.query(`CREATE TABLE panthorium_agent_memories (
      memory_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,
      content TEXT NOT NULL,tags JSONB NOT NULL DEFAULT '[]',source TEXT,importance INTEGER NOT NULL DEFAULT 50,
      confidence REAL NOT NULL DEFAULT 0.8,expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      INSERT INTO panthorium_agent_memories(memory_id,user_id,kind,title,content)
      VALUES('legacy','memory-owner','fact','legacy','private memory');`);
    const memories = new AgentMemoryRepository(); memories.pool = pool; await memories.init();
    assert.equal((await memories.get('memory-owner','legacy','personal')).scope,'personal');
    assert.equal(await memories.get('memory-owner','legacy','work'),null);
    assert.equal(await memories.get('other-owner','legacy','personal'),null);

    for (const [userId,scope,title] of [['memory-owner','personal','mine'],['memory-owner','work','work'],['other-owner','personal','other']]) {
      await memories.create({userId,scope,kind:'calendar-event',title,content:JSON.stringify({version:1,startsAt:'2030-01-01T00:00:00Z'})});
    }
    assert.deepEqual((await memories.calendarRecords('memory-owner')).map(x=>x.title),['mine'],'Calendar SQL stays within the owner and personal scope');

    const ledger = new ActionLedgerRepository({pool,required:true}); await ledger.init();
    const proposal = {userId:'action-owner',requestId:'same-logical-action',toolId:'test.draft',args:{value:'immutable payload'},requiresConfirmation:true};
    const proposed = await Promise.all(Array.from({length:12},()=>ledger.propose(proposal)));
    assert.equal(new Set(proposed.map(x=>x.actionId)).size,1,'Concurrent INSERTs must create one durable action');
    const action=proposed[0];
    let effects=0;
    const claimed=await Promise.all(Array.from({length:12},async()=>{
      const result=await ledger.claim(proposal.userId,action.actionId,action.approvalHash);
      if(result.claimed){effects++;await ledger.finish(proposal.userId,action.actionId,'succeeded',{receipt:'one-effect'});}
      return result.claimed;
    }));
    assert.equal(claimed.filter(Boolean).length,1); assert.equal(effects,1,'Only the PostgreSQL claim winner may produce an effect');
    const ledgerAfterRestart=new ActionLedgerRepository({pool,required:true}); await ledgerAfterRestart.init();
    assert.equal((await ledgerAfterRestart.propose(proposal)).actionId,action.actionId);
    assert.equal((await ledgerAfterRestart.claim(proposal.userId,action.actionId,action.approvalHash)).claimed,false);
    assert.equal((await ledgerAfterRestart.get(proposal.userId,action.actionId)).state,'succeeded');
    assert.equal(await ledger.get('other-owner',action.actionId),null);
    await assert.rejects(()=>ledger.claim('other-owner',action.actionId,action.approvalHash),/action_not_found/);
    await assert.rejects(()=>ledger.propose({...proposal,args:{value:'different payload'}}),/action_request_conflict/);

    const voices=[new VoiceSessionRepository({pool,required:true,secret:'integration-test-key'}),new VoiceSessionRepository({pool,required:true,secret:'integration-test-key'})];
    await voices[0].init();await voices[1].init();
    const leaseClaims=await Promise.all(Array.from({length:12},(_,i)=>voices[i%2].claim({userId:'voice-owner',sessionId:`session-${i}`,ownerId:`worker-${i}`})));
    assert.equal(leaseClaims.filter(Boolean).length,1,'One account may have only one active voice owner across workers');
    const winner=leaseClaims.indexOf(true);
    assert.equal(await voices[1].renew({userId:'voice-owner',ownerId:'wrong-worker'}),false);
    await voices[1].release({userId:'voice-owner',ownerId:'wrong-worker'});
    assert.equal(await voices[1].claim({userId:'voice-owner',sessionId:'takeover',ownerId:'other-worker'}),false);
    await voices[0].put({userId:'voice-owner',sessionId:`session-${winner}`,handle:'secret-provider-handle',actionPending:true});
    const stored=(await pool.query('SELECT encrypted_handle FROM panthorium_voice_checkpoints WHERE user_id=$1',['voice-owner'])).rows[0];
    assert(!stored.encrypted_handle.includes('secret-provider-handle'));
    assert.equal((await voices[1].get({userId:'voice-owner',sessionId:`session-${winner}`})).handle,'secret-provider-handle');
    assert.equal(await voices[1].get({userId:'different-owner',sessionId:`session-${winner}`}),null);
    await voices[0].release({userId:'voice-owner',ownerId:`worker-${winner}`});
    assert.equal(await voices[1].claim({userId:'voice-owner',sessionId:'takeover',ownerId:'other-worker'}),true);

    const apps=[new CloudAppRepository({pool}),new CloudAppRepository({pool})];await apps[0].init();await apps[1].init();
    const now=new Date().toISOString(), limits={timeoutMs:45000,maxRunsPerMinute:100,maxRunsPerDay:100};
    const session={id:randomUUID(),userId:'app-owner',scope:'work',packId:'office',expiresAt:new Date(Date.now()+600000).toISOString()};
    await apps[0].createSession(session);
    const run={id:randomUUID(),userId:session.userId,scope:session.scope,packId:session.packId,featureId:'draft',sessionId:session.id,idempotencyKey:'same-request',fingerprint:'same-fingerprint',status:'running',createdAt:now,updatedAt:now};
    const reserved=await Promise.all(Array.from({length:12},(_,i)=>apps[i%2].reserve({...run,id:randomUUID()},limits)));
    assert.equal(reserved.filter(x=>x.created).length,1,'Cloud-app idempotency must survive concurrent workers');
    const runId=reserved[0].run.id; assert(reserved.every(x=>x.run.id===runId));
    await assert.rejects(()=>apps[0].reserve({...run,id:randomUUID(),fingerprint:'changed'},limits),/cloud_apps_idempotency_conflict/);
    assert.equal(await apps[1].getSession('another-owner',session.id),null);
    assert.equal(await apps[1].get('another-owner',runId),null);
    assert.equal(await apps[1].finish('another-owner',runId,{status:'cancelled'}),null);
    await apps[0].finish('app-owner',runId,{status:'draft_ready',result:{draft:'review me'}});
    const afterRestart=new CloudAppRepository({pool});await afterRestart.init();
    assert.equal((await afterRestart.get('app-owner',runId)).result.draft,'review me');
    assert.equal((await afterRestart.reserve({...run,id:randomUUID()},limits)).created,false);
    const newRun={...run,userId:'second-app-owner',id:randomUUID(),idempotencyKey:'new-running-1'};
    const races=await Promise.allSettled([apps[0].reserve(newRun,limits),apps[1].reserve({...newRun,id:randomUUID(),idempotencyKey:'new-running-2'},limits)]);
    assert.equal(races.filter(x=>x.status==='fulfilled').length,1,'Per-owner advisory locking must enforce one in-flight draft');
    assert.equal(races.find(x=>x.status==='rejected').reason.message,'cloud_apps_run_in_progress');
    const runningId=races.find(x=>x.status==='fulfilled').value.run.id;
    await apps[0].finish('second-app-owner',runningId,{status:'cancelled',result:null});
    await apps[1].finish('second-app-owner',runningId,{status:'draft_ready',result:{draft:'late response'}});
    assert.equal((await apps[0].get('second-app-owner',runningId)).status,'cancelled','Late completion must not overwrite cancellation');

    const jobs=new AgentJobRepository({requireDatabase:true}); jobs.pool=pool; await jobs.init();
    const automations=new AgentAutomationRepository({requireDatabase:true}); automations.pool=pool; await automations.init();
    // Quota counts and inserts must serialize across distinct worker instances.
    const quotaWorkerRepository=new AgentAutomationRepository({requireDatabase:true}); quotaWorkerRepository.pool=pool;
    const quotaServices=[automations,quotaWorkerRepository].map(repository=>new AgentAutomationService({repository,jobs}));
    const quotaUser={sub:'automation-quota-owner',roles:[],permissions:['chat']};
    const quotaInput={user:quotaUser,request:'prepare a draft',everyMinutes:15,firstRunAt:new Date(Date.now()+600000).toISOString()};
    const quotaRaces=await Promise.all(Array.from({length:24},(_,i)=>quotaServices[i%2].createSchedule(quotaInput)));
    assert.equal(quotaRaces.filter(result=>result.ok).length,10,'PostgreSQL lock must admit only 10 concurrent schedules across workers');
    assert(quotaRaces.filter(result=>result.ok).every(result=>result.schedule.maxRuns===100));
    assert(quotaRaces.filter(result=>!result.ok).every(result=>result.error==='automation_schedule_limit_reached'));
    await quotaServices[0].disableSchedule({user:quotaUser,scheduleId:quotaRaces.find(result=>result.ok).schedule.scheduleId});
    for(let i=0;i<15;i++){
      const created=await quotaServices[i%2].createSchedule(quotaInput); assert(created.ok);
      await quotaServices[0].disableSchedule({user:quotaUser,scheduleId:created.schedule.scheduleId});
    }
    assert((await quotaServices[0].createSchedule(quotaInput)).ok);
    assert.equal((await quotaServices[1].createSchedule(quotaInput)).error,'automation_schedule_limit_reached','Disabled history cannot hide older active schedules');
    const triggerRaces=await Promise.all(Array.from({length:24},(_,i)=>quotaServices[i%2].createTrigger({user:quotaUser,eventKey:'audit.event',request:'prepare a draft'})));
    assert.equal(triggerRaces.filter(result=>result.ok).length,10,'PostgreSQL lock must enforce concurrent trigger limit');
    const legacyLast=await automations.createSchedule({userId:'legacy-schedule-owner',userContext:{sub:'legacy-schedule-owner',permissions:['chat']},request:'legacy bounded task',everyMinutes:15,nextRunAt:new Date(Date.now()-60000).toISOString(),maxRuns:null,runCount:99});
    const legacyOverrun=await automations.createSchedule({userId:'legacy-schedule-owner',request:'legacy exhausted task',everyMinutes:15,nextRunAt:new Date(Date.now()-60000).toISOString(),maxRuns:null,runCount:150});
    const legacyOccurrences=await Promise.all([automations.materializeDueJobs(jobs),quotaWorkerRepository.materializeDueJobs(jobs)]);
    assert.equal(legacyOccurrences.flat().length,1,'Concurrent workers must stop legacy NULL schedules at the effective cap');
    assert.equal(legacyOccurrences.flat()[0].result.occurrence,100);
    const legacyRows=await automations.listSchedules('legacy-schedule-owner');
    assert(legacyRows.every(row=>row.maxRuns===100&&row.enabled===false));
    assert.equal(legacyRows.find(row=>row.scheduleId===legacyOverrun.scheduleId).runCount,150,'An exhausted legacy row must not create one extra job');
    assert.equal(legacyRows.find(row=>row.scheduleId===legacyLast.scheduleId).runCount,100);

    // Additive training privacy column must preserve existing records and reject
    // private examples in both shared prompt retrieval and fine-tuning exports.
    const trainingRepository=new SentinelTrainingRepository(); trainingRepository.pool=pool; await trainingRepository.init();
    const trainingService=new SentinelTrainingService({repository:trainingRepository,providers:{available:()=>[]}});
    const privateTraining=await trainingService.addExample({prompt:'Canary protected source',answer:'PRIVATE-SQL-CANARY should remain owner-scoped',source:'conversation:auto',user:{sub:'training-owner'}});
    const curatedTraining=await trainingService.addExample({prompt:'Canary curated source',answer:'PUBLIC-SQL-CANARY is a reviewed educational answer',source:'human',user:{sub:'curator'}});
    await trainingRepository.review(privateTraining.example.exampleId,'approved','reviewer');
    await trainingRepository.review(curatedTraining.example.exampleId,'approved','reviewer');
    assert.equal((await trainingRepository.getById(privateTraining.example.exampleId)).globalPublication,null);
    for(const output of [await trainingService.contextFor('Canary'),await trainingService.exportJsonl()]){
      assert(!output.includes('PRIVATE-SQL-CANARY'));assert(output.includes('PUBLIC-SQL-CANARY'));
    }

    const originalDue=new Date(Date.now()-1000).toISOString();
    const schedule=await automations.createSchedule({userId:'automation-owner',userContext:{sub:'automation-owner',permissions:['chat']},request:'prepare a draft',everyMinutes:5,nextRunAt:originalDue,maxRuns:2});
    let failAdvance=true;
    const rollbackPool={connect:async()=>{
      const client=await pool.connect();
      return {query:async(sql,values)=>{if(failAdvance && sql.startsWith('UPDATE panthorium_agent_schedules')){failAdvance=false;throw new Error('injected_after_job_insert');}return client.query(sql,values);},release:()=>client.release()};
    }};
    jobs.pool=rollbackPool; automations.pool=rollbackPool;
    await assert.rejects(()=>automations.materializeDueJobs(jobs),/injected_after_job_insert/);
    jobs.pool=pool;automations.pool=pool;
    assert.equal((await automations.listSchedules('automation-owner'))[0].runCount,0);
    assert.equal((await jobs.list('automation-owner')).length,0,'PostgreSQL rollback must remove the inserted job as well as preserving the occurrence');
    const secondAutomations=new AgentAutomationRepository({requireDatabase:true});secondAutomations.pool=pool;
    const made=await Promise.all([automations.materializeDueJobs(jobs),secondAutomations.materializeDueJobs(jobs)]);
    assert.equal(made[0].length+made[1].length,1);
    assert.equal((await jobs.list('automation-owner'))[0].jobId,`schedule:${schedule.scheduleId}:1`);
    assert.equal((await automations.listSchedules('automation-owner'))[0].runCount,1);
    assert.equal((await automations.materializeDueJobs(jobs)).length,0);

    const uncertain=await automations.createSchedule({userId:'commit-owner',userContext:{sub:'commit-owner',permissions:['chat']},request:'prepare another draft',everyMinutes:5,nextRunAt:originalDue,maxRuns:2});
    let loseCommitAck=true;
    const uncertainPool={connect:async()=>{
      const client=await pool.connect();
      return {query:async(sql,values)=>{const result=await client.query(sql,values);if(sql==='COMMIT' && loseCommitAck){loseCommitAck=false;throw new Error('injected_lost_commit_ack');}return result;},release:()=>client.release()};
    }};
    jobs.pool=uncertainPool;automations.pool=uncertainPool;
    await assert.rejects(()=>automations.materializeDueJobs(jobs),/injected_lost_commit_ack/);
    jobs.pool=pool;automations.pool=pool;
    assert.equal((await automations.listSchedules('commit-owner'))[0].runCount,1);
    assert.equal((await jobs.list('commit-owner')).length,1);
    assert.equal((await jobs.list('commit-owner'))[0].jobId,`schedule:${uncertain.scheduleId}:1`);
    assert.equal((await automations.materializeDueJobs(jobs)).length,0,'Retry after a committed-but-unacknowledged transaction must not duplicate the occurrence');
    const jobClaims=await Promise.all([jobs.claimDue('worker-a',20),jobs.claimDue('worker-b',20)]);
    const claimedJobs=jobClaims.flat();
    const expectedJobIds=[`schedule:${legacyLast.scheduleId}:100`,`schedule:${schedule.scheduleId}:1`,`schedule:${uncertain.scheduleId}:1`];
    assert.equal(claimedJobs.length,expectedJobIds.length,'Each materialized job must be claimed by exactly one worker');
    assert.deepEqual(new Set(claimedJobs.map(x=>x.jobId)),new Set(expectedJobIds),'Claims must include the bounded legacy occurrence and both transaction fixtures');

    const reminders=new ReminderRepository({requireDatabase:true});reminders.pool=pool;await reminders.init();
    const reminder=await reminders.create({userId:'reminder-owner',kind:'study',title:'review',dueAt:originalDue,timeZone:'Asia/Bangkok',accountVersion:3});
    const deliveries=await Promise.all([reminders.claimDue(10),reminders.claimDue(10)]);
    assert.equal(deliveries.flat().length,1);assert.equal(deliveries.flat()[0].accountVersion,3);
    await reminders.finish(reminder.reminderId,{status:'delivery_unknown',occurrence:1,lastError:'connection_lost'});
    assert.equal((await reminders.claimDue()).length,0,'Unknown email outcomes must not be automatically retried');
    assert.equal(await reminders.snooze('different-owner',reminder.reminderId,new Date(Date.now()+60000).toISOString()),null);
    console.log('PostgreSQL integration passed: unique actions, single-effect claims, voice leases, durable app idempotency/isolation, atomic automation rollback/replay, and reminder outbox claims.');
  } finally {
    if(pool)await pool.end();
    if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch(error=>{console.error('PostgreSQL integration failed:',error.message);process.exitCode=1;});
