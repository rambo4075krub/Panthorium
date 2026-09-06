'use strict';

class SentinelRecoveryService{
  constructor({learning,training,trainingRepository,providers,audit,maxAttempts=3}={}){this.learning=learning;this.training=training;this.trainingRepository=trainingRepository;this.providers=providers;this.audit=audit;this.maxAttempts=Math.max(1,Math.min(Number(maxAttempts)||3,5));this.processing=new Set();}
  async sourceExample(version){const items=await this.trainingRepository.list({limit:500});return items.find(x=>x.exampleId===version.exampleId)||null;}
  async recover(versionId,{reason='automatic_recovery'}={}){
    if(this.processing.has(versionId))return{ok:true,skipped:true,reason:'recovery_running'};this.processing.add(versionId);
    try{
      const version=await this.learning.repository.get(versionId);if(!version)return{ok:false,error:'learning_version_not_found'};if(version.state!=='rolled_back')return{ok:false,error:'learning_version_not_rolled_back'};
      const attempts=Number(version.metadata?.recoveryAttempts||0);if(attempts>=this.maxAttempts)return{ok:false,error:'recovery_attempt_limit'};
      const source=await this.sourceExample(version);if(!source)return{ok:false,error:'training_example_not_found'};
      const available=this.providers.available();const teachers=[...available.filter(p=>p!==source.provider),...available.filter(p=>p===source.provider)].slice(0,Math.min(2,available.length));if(!teachers.length)return{ok:false,error:'no_recovery_provider'};
      await this.learning.repository.update(versionId,{metadata:{...version.metadata,recoveryAttempts:attempts+1,lastRecoveryAt:new Date().toISOString(),lastRecoveryReason:reason}});await this.learning.repository.event(versionId,'recovery_started',{attempt:attempts+1,reason,teachers});
      const system='คุณคือ Sentinel Recovery Engineer สร้างคำตอบใหม่เพื่อแก้ regression ของความรู้ที่ถูก rollback ตอบเฉพาะคำตอบใหม่ที่ถูกต้อง ชัดเจน ปลอดภัย ไม่ใส่คำอธิบายกระบวนการ ห้ามคัดลอกคำตอบเดิมถ้ามีจุดอ่อน';
      const payload=`โจทย์เดิม:\n${source.prompt}\n\nคำตอบเดิมที่ถูก rollback:\n${source.answer}\n\nสาเหตุ rollback:\n${version.metadata?.rollbackReason||reason}\n\nสร้างคำตอบใหม่ที่แก้ปัญหาและเหมาะสำหรับนำไปประเมินอีกครั้ง`;
      const settled=await Promise.allSettled(teachers.map(async provider=>{const r=await this.providers.callDetailed(provider,system,[{role:'user',content:payload}]);if(!r?.text)throw new Error('empty_recovery_response');return{provider,model:r.model||null,text:r.text};}));
      const drafts=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);const failures=settled.map((x,i)=>x.status==='rejected'?{provider:teachers[i],error:x.reason?.message||'recovery_failed'}:null).filter(Boolean);if(!drafts.length){await this.learning.repository.event(versionId,'recovery_failed',{failures});return{ok:false,error:'recovery_generation_failed',failures};}
      const candidates=[];for(const draft of drafts){const added=await this.training.addExample({prompt:source.prompt,answer:draft.text,source:`recovery:${versionId}`,provider:draft.provider,model:draft.model,tags:[...(source.tags||[]),'automatic-recovery'],user:{sub:'sentinel-recovery'},requestId:`recovery:${versionId}`});if(added?.example)candidates.push({provider:draft.provider,example:added.example,learning:added.learning||null,evaluation:added.evaluation||null,duplicate:Boolean(added.duplicate)});}
      await this.learning.repository.event(versionId,'recovery_candidates_created',{count:candidates.length,failures});this.audit?.record('sentinel.learning_recovery_created',{versionId,exampleId:version.exampleId,candidateCount:candidates.length,attempt:attempts+1});return{ok:candidates.length>0,candidates,failures,attempt:attempts+1};
    }finally{this.processing.delete(versionId);}
  }
  recoverSoon(versionId,options={}){setImmediate(()=>this.recover(versionId,options).catch(error=>this.audit?.record('sentinel.learning_recovery_failed',{versionId,error:error.message})));}
}
module.exports={SentinelRecoveryService};
