const assert=require('assert');
const {SentinelLearningRepository}=require('../services/sentinelLearningRepository');
const {SentinelLearningOrchestrator}=require('../services/sentinelLearningOrchestrator');
const {AutonomousLearningPolicy}=require('../services/autonomousLearningPolicy');

(async()=>{
 const repo=new SentinelLearningRepository();
 const example={exampleId:'11111111-1111-4111-8111-111111111111',prompt:'อธิบาย Panthorium memory',answer:'Memory stores user scoped context.',source:'test',fingerprint:'fingerprint-memory-v1',qualityScore:96,evaluation:{safe:true,judges:[{provider:'a',safe:true,correct:true,relevant:true},{provider:'b',safe:true,correct:true,relevant:true}]}};
 const examples=[example];
 const trainingRepository={list:async()=>examples};
 const policy=new AutonomousLearningPolicy({promotionScore:90,shadowMinSamples:3,shadowScore:90,maxRegressionPct:5});
 const loop=new SentinelLearningOrchestrator({repository:repo,trainingRepository,policy});
 const q=await loop.quarantine(example);assert.equal(q.state,'quarantined');
 const s=await loop.evaluateForShadow(q,example);assert.equal(s.state,'shadow');
 let early=await loop.promoteIfReady(s.versionId);assert.equal(early.promoted,false);
 await loop.recordShadow(s.versionId,{score:95});await loop.recordShadow(s.versionId,{score:94});await loop.recordShadow(s.versionId,{score:96});
 let unmeasured=await loop.promoteIfReady(s.versionId);assert.equal(unmeasured.promoted,false,'scores without measured shadow evidence must not promote');
 await repo.update(s.versionId,{metadata:{measuredShadow:{schema:1,sampleCount:3,worstRegression:0,comparisons:[{caseId:'a',candidateScore:95,safety:100,judgeProviders:['a','b']},{caseId:'b',candidateScore:94,safety:100,judgeProviders:['a','b']},{caseId:'c',candidateScore:96,safety:100,judgeProviders:['a','b']}]}}});
 const promoted=await loop.promoteIfReady(s.versionId);assert.equal(promoted.promoted,true);assert.equal(promoted.version.state,'active');
 const monitored=await loop.monitor(s.versionId,{rollingScore:95,baselineScore:96});assert.equal(monitored.rollback,false);
 const rolled=await loop.monitor(s.versionId,{rollingScore:80,baselineScore:96});assert.equal(rolled.rollback,true);assert.equal(rolled.version.state,'rolled_back');
 const protectedExample={...example,exampleId:'22222222-2222-4222-8222-222222222222',fingerprint:'fingerprint-protected',prompt:'change rbac policy automatically'};
 examples.push(protectedExample);
 const pq=await loop.quarantine(protectedExample);assert.equal(pq.risk,'protected');const pr=await loop.evaluateForShadow(pq,protectedExample);assert.equal(pr.state,'rejected');
 const stopExample={...example,exampleId:'33333333-3333-4333-8333-333333333333',fingerprint:'fingerprint-stop',prompt:'safe emergency stop candidate'};
 examples.push(stopExample);
 const stopQ=await loop.quarantine(stopExample);const stopS=await loop.evaluateForShadow(stopQ,stopExample);
 await loop.recordShadow(stopS.versionId,{score:95});await loop.recordShadow(stopS.versionId,{score:95});await loop.recordShadow(stopS.versionId,{score:95});
 await repo.update(stopS.versionId,{metadata:{...stopS.metadata,measuredShadow:{schema:1,sampleCount:3,worstRegression:0,comparisons:[{caseId:'d',candidateScore:95,safety:100,judgeProviders:['a','b']},{caseId:'e',candidateScore:95,safety:100,judgeProviders:['a','b']},{caseId:'f',candidateScore:95,safety:100,judgeProviders:['a','b']}]}}});
 const paused=await loop.setPromotionEnabled(false,{actor:'test-admin',reason:'incident'});assert.equal(paused.promotionControl.enabled,false);
 const blocked=await loop.promoteIfReady(stopS.versionId);assert.equal(blocked.promoted,false);assert(blocked.decision.reasons.includes('promotion_emergency_stop'));
 const status=await loop.status();assert.equal(status.policy.promotionControl.enabled,false);
 await loop.setPromotionEnabled(true,{actor:'test-admin'});const resumed=await loop.promoteIfReady(stopS.versionId);assert.equal(resumed.promoted,true);
 console.log('phase12 learning orchestrator tests passed');
})().catch(e=>{console.error(e);process.exit(1)});

