const assert = require('node:assert/strict');
const express = require('express');
const { createInternalJobsRouter } = require('../routes/internalJobs');
const { AgentJobRepository } = require('../services/agentJobRepository');
const { AgentSchedulerService } = require('../services/agentSchedulerService');

(async () => {
  const audience = 'https://service.example.test';
  const serviceAccount = 'scheduler@project.iam.gserviceaccount.com';
  const payload = {iss:'https://accounts.google.com',aud:audience,sub:'123456789',email:serviceAccount,email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
  let claims = {...payload}, verifies = 0;
  const verifier = {async verifyIdToken({idToken,audience:requestedAudience}) { verifies++; assert.equal(requestedAudience,audience); if (idToken !== 'signed.test.token') throw new Error('bad_signature'); return {getPayload:() => claims}; }};
  const jobs = new AgentJobRepository();
  const executed = [];
  const authService = {repository:{findUserById:async id => ({id,permissions:['chat'],roles:[]})}};
  const scheduler = new AgentSchedulerService({jobs,workflow:{run:async input => {executed.push(input); return {ok:true};}},authService,maxJobs:2});
  await scheduler.init();
  const job = await jobs.create({userId:'alice',request:'due now',runAt:new Date(Date.now()-1000).toISOString()});
  const app = express();
  app.use('/internal/jobs',createInternalJobsRouter({scheduler,audience,serviceAccounts:[serviceAccount],verifier}));
  app.use('/missing',createInternalJobsRouter({scheduler,audience:'',serviceAccounts:[],verifier}));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path='/internal/jobs/tick', headers={}) => { const r=await fetch(base+path,{method:'POST',headers}); return {status:r.status,body:await r.json()}; };
  const authorized = {authorization:'Bearer signed.test.token'};
  try {
    assert.equal((await post()).status,401);
    assert.equal((await post('/internal/jobs/tick',{'X-CloudScheduler':'true','X-CloudScheduler-JobName':'trusted'})).status,401);
    assert.equal(verifies,0); assert.equal(executed.length,0);
    assert.equal((await post('/missing/tick',authorized)).status,503);
    assert.equal((await post('/internal/jobs/tick',{authorization:'Bearer unsigned.token'})).status,401);
    claims={...payload,email:'intruder@project.iam.gserviceaccount.com'};
    assert.equal((await post('/internal/jobs/tick',authorized)).status,403);
    for (const invalid of [{email_verified:false},{aud:'https://other.example.test'},{iss:'https://attacker.test'},{exp:0},{sub:''}]) {
      claims={...payload,...invalid}; assert.equal((await post('/internal/jobs/tick',authorized)).status,401);
    }
    assert.equal(executed.length,0);
    claims={...payload};
    assert.equal((await post('/internal/jobs/tick',authorized)).body.claimed,1);
    assert.equal((await post('/internal/jobs/tick',authorized)).body.claimed,0,'An authenticated request replay must not execute the same job twice');
    assert.equal(executed.length,1); assert.equal(executed[0].requestId,`job:${job.jobId}`);
    assert.equal(await jobs.get('bob',job.jobId),null,'Job reads are owner scoped');
    assert.equal(await jobs.cancel('bob',job.jobId),null);
  } finally { await new Promise(resolve => server.close(resolve)); }

  const shared = new AgentJobRepository();
  for(let i=0;i<8;i++) await shared.create({userId:'alice',request:`item ${i}`,runAt:new Date(Date.now()-1000).toISOString()});
  const [left,right] = await Promise.all([shared.claimDue('one',5),shared.claimDue('two',5)]);
  assert.equal(left.length+right.length,8); assert.equal(new Set([...left,...right].map(x=>x.jobId)).size,8);
  const stale=left[0]; shared.memory.set(stale.jobId,{...stale,lockedAt:new Date(Date.now()-3600000).toISOString()});
  assert.equal(await shared.recoverStale(),1);
  assert.equal((await shared.get('alice',stale.jobId)).error,'scheduled_execution_interrupted_manual_review');
  assert.equal(await shared.finish(stale.jobId,{status:'completed'}),null,'A stale worker must not overwrite a manual-review outcome');
  assert.equal((await shared.claimDue('three',20)).length,0,'Interrupted mutations must not be re-planned and re-run blindly');

  let release;
  const blocking = new AgentSchedulerService({jobs:{recoverStale:async()=>{},claimDue:async()=>[]},reminders:{deliverDue:()=>new Promise(resolve=>{release=resolve;})}});
  const running=blocking.tick();
  await new Promise(resolve=>setImmediate(resolve));
  const duplicate=await blocking.tick(); assert.equal(duplicate.skipped,true);
  release({sent:0}); await running;
  console.log('Job trigger: verified identity, replay, ownership, concurrent claims and interrupted-outcome checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
