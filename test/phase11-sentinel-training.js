process.env.NODE_ENV='test';
const assert=require('assert');
const{SentinelTrainingRepository}=require('../services/sentinelTrainingRepository');
const{SentinelTrainingService}=require('../services/sentinelTrainingService');
const{SentinelCore}=require('../services/sentinelCore');

(async()=>{
  const repository=new SentinelTrainingRepository();
  const training=new SentinelTrainingService({repository,providers:{available:()=>[],catalog:()=>[]}});
  const user={sub:'admin-test'};
  const added=await training.addExample({prompt:'Panthorium คืออะไร',answer:'Panthorium คือระบบปฏิบัติการ AI',tags:['panthorium'],user});
  assert.equal(added.ok,true);
  assert.equal(await training.contextFor('Panthorium คืออะไร'),'');
  const approved=await training.review({exampleId:added.example.exampleId,status:'approved',user});
  assert.equal(approved.ok,true);
  assert.match(await training.contextFor('อธิบาย Panthorium'),/ระบบปฏิบัติการ AI/);
  assert.match(await training.exportJsonl(),/"role":"assistant"/);
  let systemPrompt='';
  const core=new SentinelCore({training,sessions:{append:()=>[{role:'user',content:'อธิบาย Panthorium'}],size:()=>1,clear:()=>{}},prompts:{build:()=> 'ฐานคำสั่ง'},providers:{available:()=>[]},gateway:{complete:async input=>{systemPrompt=input.systemPrompt;return{ok:true,text:'ตกลง'};}}});
  await core.chat({message:'อธิบาย Panthorium'});
  assert.match(systemPrompt,/ระบบปฏิบัติการ AI/);
  const emptyTeachers=await training.draftWithTeachers({prompt:'ทดสอบ',user});
  assert.equal(emptyTeachers.error,'no_teacher_provider');
  console.log('Phase 11 Sentinel training tests passed');
})().catch(error=>{console.error(error);process.exit(1);});
