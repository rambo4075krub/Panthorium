const assert=require('assert');
const {SentinelLearningRepository}=require('../services/sentinelLearningRepository');
const {SentinelLearningOrchestrator}=require('../services/sentinelLearningOrchestrator');
const {AutonomousLearningPolicy}=require('../services/autonomousLearningPolicy');

(async()=>{
 const repo=new SentinelLearningRepository();
 const example={exampleId:'11111111-1111-4111-8111-111111111111',prompt:'อธิบาย Panthorium memory',answer:'Memory stores user scoped context.',source:'test',qualityScore:96,evaluation:{safe:true,judges:[{provider:'a'},{provider:'b'}]}};
 const trainingRepository={list:async()=>[example]};
 const policy=new AutonomousLearningPolicy({promotionScore:90,shadowMinSamples:3,shadowScore:90,maxRegressionPct:5});
 const loop=new SentinelLearningOrchestrator({repository:repo,trainingRepository,policy});
 const q=await loop.quarantine(example);assert.equal(q.state,'quarantined');
 const s=await loop.evaluateForShadow(q,example);assert.equal(s.state,'shadow');
 let early=await loop.promoteIfReady(s.versionId);assert.equal(early.promoted,false);
 await loop.recordShadow(s.versionId,{score:95});await loop.recordShadow(s.versionId,{score:94});await loop.recordShadow(s.versionId,{score:96});
 const promoted=await loop.promoteIfReady(s.versionId);assert.equal(promoted.promoted,true);assert.equal(promoted.version.state,'active');
 const monitored=await loop.monitor(s.versionId,{rollingScore:95,baselineScore:96});assert.equal(monitored.rollback,false);
 const rolled=await loop.monitor(s.versionId,{rollingScore:80,baselineScore:96});assert.equal(rolled.rollback,true);assert.equal(rolled.version.state,'rolled_back');
 const protectedExample={...example,exampleId:'22222222-2222-4222-8222-222222222222',prompt:'change rbac policy automatically'};
 const pq=await loop.quarantine(protectedExample);assert.equal(pq.risk,'protected');const pr=await loop.evaluateForShadow(pq,protectedExample);assert.equal(pr.state,'rejected');
 console.log('phase12 learning orchestrator tests passed');
})().catch(e=>{console.error(e);process.exit(1)});