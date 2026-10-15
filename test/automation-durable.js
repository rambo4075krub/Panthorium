const assert = require('node:assert/strict');
const { AgentAutomationRepository } = require('../services/agentAutomationRepository');
const { AgentAutomationService } = require('../services/agentAutomationService');
const { AgentJobRepository } = require('../services/agentJobRepository');

(async () => {
  const jobs=new AgentJobRepository(), repository=new AgentAutomationRepository();
  const service=new AgentAutomationService({repository,jobs});
  await service.init();
  const schedule=await repository.createSchedule({userId:'alice',userContext:{sub:'alice',permissions:['chat']},request:'prepare a draft',everyMinutes:5,maxRuns:2,nextRunAt:new Date(Date.now()-1000).toISOString()});
  // Inject a failure after the job has been written, at the schedule advancement boundary.
  const set=repository.schedules.set.bind(repository.schedules); let fail=true;
  repository.schedules.set=(key,value)=>{if(fail && value.runCount===1){fail=false;throw new Error('injected_materialization_crash');}return set(key,value);};
  await assert.rejects(()=>service.materializeDue(),/injected_materialization_crash/);
  assert.equal(repository.schedules.get(schedule.scheduleId).runCount,0,'A failed occurrence must remain due');
  assert.equal((await jobs.list('alice')).length,0,'A failed transaction must not leave a detached job');
  const [first,second]=await Promise.all([service.materializeDue(),service.materializeDue()]);
  assert.equal(first.length+second.length,1,'Concurrent ticks produce one occurrence');
  const made=(await jobs.list('alice'))[0];
  assert.equal(made.jobId,`schedule:${schedule.scheduleId}:1`);
  assert.equal(repository.schedules.get(schedule.scheduleId).runCount,1);
  assert.equal((await service.materializeDue()).length,0,'Replay after commit does not duplicate a job');
  set(schedule.scheduleId,{...repository.schedules.get(schedule.scheduleId),nextRunAt:new Date(Date.now()-1000).toISOString()});
  const final=await service.materializeDue(); assert.equal(final.length,1);
  assert.equal(final[0].jobId,`schedule:${schedule.scheduleId}:2`);
  assert.equal(repository.schedules.get(schedule.scheduleId).enabled,false);
  assert.equal((await service.materializeDue()).length,0);

  // Production SQL transaction protocol: fault after INSERT must roll back before releasing.
  // Real database execution remains an integration gate; this adapter checks failure handling.
  const commands=[]; const state={job:null,scheduleCount:0}; let snapshot, inject=true, active=false, loseCommitAck=false;
  const sqlSchedule={...schedule,runCount:0,enabled:true};
  const client={
    async query(sql,values){
      commands.push(sql.split(/\s+/).slice(0,3).join(' '));
      if(sql==='BEGIN'){snapshot={...state};active=true;return{rows:[]};}
      if(sql==='ROLLBACK'){if(active)Object.assign(state,snapshot);active=false;return{rows:[]};}
      if(sql==='COMMIT'){active=false;if(loseCommitAck){loseCommitAck=false;throw new Error('commit_ack_lost');}return{rows:[]};}
      if(sql.includes('FROM panthorium_agent_schedules WHERE'))return{rows:state.scheduleCount?[]:[sqlSchedule]};
      if(sql.startsWith('INSERT INTO panthorium_agent_jobs')){state.job={jobId:values[0],userId:values[1],userContext:JSON.parse(values[2]),request:values[3],provider:values[4],runAt:values[5],status:'scheduled',result:JSON.parse(values[6])};return{rows:[state.job]};}
      if(sql.startsWith('UPDATE panthorium_agent_schedules')){if(inject){inject=false;throw new Error('database_connection_lost');}state.scheduleCount++;return{rows:[],rowCount:1};}
      throw new Error('Unexpected query');
    }, release(){commands.push('RELEASE');}
  };
  const pool={connect:async()=>client};
  const sqlRepository=new AgentAutomationRepository(), sqlJobs=new AgentJobRepository(); sqlRepository.pool=pool;sqlJobs.pool=pool;
  await assert.rejects(()=>sqlRepository.materializeDueJobs(sqlJobs),/database_connection_lost/);
  assert.equal(state.job,null);assert.equal(state.scheduleCount,0);
  assert.deepEqual(commands.slice(-2),['ROLLBACK','RELEASE']);
  loseCommitAck=true;
  await assert.rejects(()=>sqlRepository.materializeDueJobs(sqlJobs),/commit_ack_lost/);
  assert.equal(state.scheduleCount,1,'A committed transaction remains materialized when the acknowledgement is lost');
  assert(state.job);
  assert.equal(state.scheduleCount,1);assert.equal((await sqlRepository.materializeDueJobs(sqlJobs)).length,0);
  for(const Repo of [AgentAutomationRepository,AgentJobRepository]) {
    const closed=new Repo({requireDatabase:true});
    await assert.rejects(()=>closed.init(),/scheduler_database_required/);
  }
  console.log('Durable automation: occurrence rollback, concurrency, stable IDs, replay and max-runs checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
