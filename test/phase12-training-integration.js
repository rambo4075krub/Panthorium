const assert=require('assert');const{SentinelTrainingRepository}=require('../services/sentinelTrainingRepository');const{SentinelTrainingService}=require('../services/sentinelTrainingService');const{SentinelLearningRepository}=require('../services/sentinelLearningRepository');const{SentinelLearningOrchestrator}=require('../services/sentinelLearningOrchestrator');const{AutonomousLearningPolicy}=require('../services/autonomousLearningPolicy');
(async()=>{const trainingRepo=new SentinelTrainingRepository(),learningRepo=new SentinelLearningRepository(),policy=new AutonomousLearningPolicy({promotionScore:90,shadowMinSamples:3,shadowScore:90}),learning=new SentinelLearningOrchestrator({repository:learningRepo,trainingRepository:trainingRepo,policy}),providers={available:()=>['judge-a','judge-b'],catalog:()=>[],callDetailed:async()=>({text:JSON.stringify({score:96,safe:true,correct:true,relevant:true,reason:'pass'}),model:'test'})},training=new SentinelTrainingService({repository:trainingRepo,providers,learning,autoScoreThreshold:90,evaluatorProviders:['judge-a','judge-b'],audit:{record(){}}});
const added=await training.addExample({prompt:'Panthorium autonomous learning test',answer:'This answer is correct, grounded, relevant and safe.',source:'test'});assert.equal(added.example.status,'approved');assert.equal(added.learning.state,'shadow');let context=await training.contextFor('Panthorium autonomous learning test');assert.equal(context,'','shadow knowledge must not enter production context');const id=added.learning.versionId;for(const score of[96,95,97]){const r=await learning.recordShadow(id,{score,safe:true});assert.equal(r.ok,true);}const promoted=await learning.promoteIfReady(id);assert.equal(promoted.promoted,true);context=await training.contextFor('Panthorium autonomous learning test');assert.ok(context.includes('This answer is correct'),'active knowledge should enter context');const monitored=await learning.monitor(id,{rollingScore:70,baselineScore:96});assert.equal(monitored.rollback,true);context=await training.contextFor('Panthorium autonomous learning test');assert.equal(context,'','rolled-back knowledge must leave production context');console.log('Phase 12 training integration tests passed');})().catch(e=>{console.error(e);process.exit(1);});
{
const assert = require('node:assert/strict');
const { SentinelTrainingService } = require('../services/sentinelTrainingService');

(async () => {
  let active = true;
  const service = new SentinelTrainingService({
    repository: { approved: async () => [
      { exampleId: 'thai', prompt: 'วิธีจัดการความรู้เมื่อคุณภาพลดลง', answer: 'ตรวจสอบและย้อนกลับความรู้ที่ทำให้คุณภาพลดลง', tags: [], qualityScore: 95 },
      { exampleId: 'pending', prompt: 'คุณภาพความรู้', answer: 'UNAPPROVED_VERSION', tags: [], qualityScore: 100 },
    ] },
    learning: { repository: { list: async () => active ? [{ exampleId: 'thai' }] : [] } },
  });
  service.init = async () => {};
  const result = await service.contextFor('ถ้าความรู้ใหม่ทำให้คุณภาพลดลงควรทำอย่างไร');
  assert.ok(result.includes('ตรวจสอบและย้อนกลับ'), 'Thai paraphrases must retrieve active knowledge');
  assert.ok(!result.includes('UNAPPROVED_VERSION'), 'Inactive versions must remain excluded');
  assert.equal(await service.contextFor('การปลูกมะเขือเทศ'), '', 'Unrelated knowledge must not be injected');
  active = false;
  assert.equal(await service.contextFor('คุณภาพลดลง'), '', 'Rolled-back knowledge must be removed immediately');
  console.log('Thai training retrieval tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

}
