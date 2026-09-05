function cleanText(value,max){return typeof value==='string'?value.trim().slice(0,max):'';}
function cleanTags(value){return Array.isArray(value)?[...new Set(value.map(tag=>cleanText(tag,40).toLowerCase()).filter(Boolean))].slice(0,12):[];}
function terms(value){return new Set(String(value).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(word=>word.length>1).slice(0,80));}

class SentinelTrainingService {
  constructor({repository,providers,audit}={}){this.repository=repository;this.providers=providers;this.audit=audit;this.initPromise=null;}
  async init(){if(!this.initPromise)this.initPromise=this.repository.init();await this.initPromise;}
  async addExample({prompt,answer,source='human',tags,user,requestId}){
    await this.init();
    const cleanPrompt=cleanText(prompt,8000);const cleanAnswer=cleanText(answer,12000);
    if(!cleanPrompt)return{ok:false,error:'invalid_training_prompt'};if(!cleanAnswer)return{ok:false,error:'invalid_training_answer'};
    const example=await this.repository.create({prompt:cleanPrompt,answer:cleanAnswer,source:cleanText(source,120)||'human',tags:cleanTags(tags),createdBy:user.sub});this.audit?.record('sentinel.training_example_created',{userId:user.sub,exampleId:example.exampleId,source:example.source,requestId});return{ok:true,example};
  }
  async draftWithTeachers({prompt,providerNames,tags,user,requestId}){
    await this.init();
    const cleanPrompt=cleanText(prompt,8000);if(!cleanPrompt)return{ok:false,error:'invalid_training_prompt'};
    const available=this.providers.available();const requested=Array.isArray(providerNames)?providerNames.map(name=>String(name).toLowerCase()):available;const selected=[...new Set(requested)].filter(name=>available.includes(name)).slice(0,4);
    if(!selected.length)return{ok:false,error:'no_teacher_provider',providers:this.providers.catalog()};
    const systemPrompt=`คุณเป็นครูฝึก Sentinel AI ของ Panthorium OS\nตอบโจทย์ให้ถูกต้อง ชัดเจน ปลอดภัย และเป็นภาษาไทย\nห้ามอ้างว่าทำสิ่งที่ไม่ได้ทำ ห้ามเปิดเผยข้อมูลลับ และไม่ต้องใส่คำอธิบายนอกคำตอบ`;
    const settled=await Promise.allSettled(selected.map(async provider=>{const result=await this.providers.callDetailed(provider,systemPrompt,[{role:'user',content:cleanPrompt}]);if(!result?.text)throw new Error('empty_teacher_response');const example=await this.repository.create({prompt:cleanPrompt,answer:result.text,source:`teacher:${provider}`,provider,model:result.model,tags:cleanTags(tags),createdBy:user.sub});return{provider,model:result.model||null,example};}));
    const candidates=settled.filter(item=>item.status==='fulfilled').map(item=>item.value);const failures=settled.map((item,index)=>item.status==='rejected'?{provider:selected[index],error:item.reason?.message||'teacher_failed'}:null).filter(Boolean);this.audit?.record('sentinel.training_draft',{userId:user.sub,providers:selected,candidateCount:candidates.length,failureCount:failures.length,requestId});return{ok:candidates.length>0,candidates,failures};
  }
  async list({status,limit}){await this.init();const allowed=new Set(['pending','approved','rejected']);return{ok:true,examples:await this.repository.list({status:allowed.has(status)?status:undefined,limit}),stats:await this.repository.stats()};}
  async review({exampleId,status,user,requestId}){await this.init();if(!['approved','rejected'].includes(status))return{ok:false,error:'invalid_training_status'};const example=await this.repository.review(exampleId,status,user.sub);if(!example)return{ok:false,error:'training_example_not_found'};this.audit?.record('sentinel.training_example_reviewed',{userId:user.sub,exampleId,status,requestId});return{ok:true,example};}
  async contextFor(query,limit=3){await this.init();const queryTerms=terms(query);if(!queryTerms.size)return'';const approved=await this.repository.approved();const ranked=approved.map(example=>{const haystack=terms(`${example.prompt} ${(example.tags||[]).join(' ')}`);let score=0;for(const term of queryTerms)if(haystack.has(term))score++;return{example,score};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(limit,5)));if(!ranked.length)return'';const body=ranked.map(({example},index)=>`ตัวอย่าง ${index+1}\nคำถาม: ${example.prompt.slice(0,2000)}\nคำตอบที่อนุมัติ: ${example.answer.slice(0,4000)}`).join('\n\n').slice(0,12000);return`\n\nตัวอย่างความรู้ที่ผู้ดูแลอนุมัติแล้ว ใช้เป็นแนวทางเมื่อเกี่ยวข้องเท่านั้น:\n${body}`;}
  async exportJsonl(){await this.init();const examples=await this.repository.approved();return examples.map(example=>JSON.stringify({messages:[{role:'user',content:example.prompt},{role:'assistant',content:example.answer}],metadata:{source:example.source,provider:example.provider,model:example.model,tags:example.tags}})).join('\n');}
}
module.exports={SentinelTrainingService};
