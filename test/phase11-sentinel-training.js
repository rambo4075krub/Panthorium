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

  const autoRepository=new SentinelTrainingRepository();
  const autoProviders={
    available:()=>['openai','gemini'],catalog:()=>[],
    callDetailed:async(_provider,systemPrompt,history)=>{
      if(systemPrompt.includes('ผู้ตรวจคุณภาพ')){
        const low=history[0].content.includes('คำตอบคุณภาพต่ำ');
        return{text:JSON.stringify({score:low?45:94,safe:true,correct:!low,relevant:true,reason:low?'ไม่ถูกต้อง':'ผ่านเกณฑ์'}),model:'judge-test'};
      }
      return{text:'คำตอบคุณภาพสูงและปลอดภัยสำหรับใช้ฝึก Sentinel',model:'teacher-test'};
    }
  };
  const automatic=new SentinelTrainingService({repository:autoRepository,providers:autoProviders,autoScoreThreshold:85});
  const autoAdded=await automatic.addExample({prompt:'อธิบายระบบอัตโนมัติ',answer:'ระบบจะตรวจ ให้คะแนน และอนุมัติข้อมูลที่มีคุณภาพโดยอัตโนมัติ',user});
  assert.equal(autoAdded.example.status,'approved');
  assert.equal(autoAdded.example.qualityScore,94);
  assert.equal(autoAdded.example.autoApproved,true);
  const duplicate=await automatic.addExample({prompt:'อธิบายระบบอัตโนมัติ',answer:'ระบบจะตรวจ ให้คะแนน และอนุมัติข้อมูลที่มีคุณภาพโดยอัตโนมัติ',user});
  assert.equal(duplicate.duplicate,true);
  const rejected=await automatic.addExample({prompt:'คำถามทดสอบคะแนนต่ำ',answer:'คำตอบคุณภาพต่ำที่ไม่ควรผ่านการอนุมัติอัตโนมัติ',user});
  assert.equal(rejected.example.status,'rejected');
  const redacted=await automatic.captureConversation({prompt:'ติดต่อ owner@example.com เพื่อขอ token=abc123456789',answer:'รับทราบ หมายเลข 081-234-5678 จะถูกปกปิดก่อนบันทึก',provider:'openai',userId:'owner'});
  assert.doesNotMatch(redacted.example.prompt,/owner@example\.com|abc123456789/);
  assert.doesNotMatch(redacted.example.answer,/081-234-5678/);
  const autoStats=await autoRepository.stats();
  assert.equal(autoStats.approved,2);
  assert.equal(autoStats.rejected,1);
  assert.equal(autoStats.autoApproved,2);
  const partialProviders={available:()=>['openai','gemini'],catalog:()=>[],callDetailed:async provider=>{if(provider==='gemini')throw new Error('provider_down');return{text:'{"score":99,"safe":true,"correct":true,"relevant":true,"reason":"ok"}',model:'judge-test'};}};
  const partialTraining=new SentinelTrainingService({repository:new SentinelTrainingRepository(),providers:partialProviders});
  const partial=await partialTraining.addExample({prompt:'ทดสอบเมื่อผู้ตรวจทำงานไม่ครบ',answer:'ข้อมูลนี้ต้องไม่ผ่านหากผู้ตรวจทำงานไม่ครบทุกตัว',user});
  assert.equal(partial.example.status,'rejected');
  assert.equal(partial.evaluation.error,'incomplete_evaluation');
  console.log('Phase 11 Sentinel training tests passed');
})().catch(error=>{console.error(error);process.exit(1);});
