const assert=require('assert');
const{SentinelLearningRepository}=require('../services/sentinelLearningRepository');
const{SentinelLearningOrchestrator}=require('../services/sentinelLearningOrchestrator');
const{SentinelRecoveryService}=require('../services/sentinelRecoveryService');
const{AutonomousLearningPolicy}=require('../services/autonomousLearningPolicy');
(async()=>{
 const repo=new SentinelLearningRepository();const source={exampleId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',prompt:'Explain Panthorium recovery',answer:'old answer',source:'test',provider:'gen',tags:['test'],qualityScore:96,evaluation:{safe:true,judges:[{provider:'a',safe:true,correct:true,relevant:true},{provider:'b',safe:true,correct:true,relevant:true}]}};
 const trainingRepository={list:async()=>[source]};const learning=new SentinelLearningOrchestrator({repository:repo,trainingRepository,policy:new AutonomousLearningPolicy({shadowMinSamples:1})});
 const created=[];const training={addExample:async input=>{created.push(input);return{ok:true,example:{exampleId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',...input},learning:{state:'shadow'}};}};
 const providers={available:()=>['a','b'],callDetailed:async p=>({text:`recovered answer by ${p}`,model:'test'})};const recovery=new SentinelRecoveryService({learning,training,trainingRepository,providers,audit:{record(){}}});learning.recovery=recovery;
 const q=await learning.quarantine(source);const s=await learning.evaluateForShadow(q,source);await repo.update(s.versionId,{state:'active'});const rolled=await learning.rollback(s.versionId,{reason:'baseline_regression'});assert.equal(rolled.version.state,'rolled_back');
 const r=await recovery.recover(s.versionId);assert.equal(r.ok,true);assert.equal(created.length,2);assert(created.every(x=>x.tags.includes('automatic-recovery')));const updated=await repo.get(s.versionId);assert.equal(updated.metadata.recoveryAttempts,1);console.log('Phase 12 automatic recovery tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
