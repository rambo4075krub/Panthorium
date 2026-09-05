const { createHash } = require('crypto');

function cleanText(value,max){return typeof value==='string'?value.trim().slice(0,max):'';}
function cleanTags(value){return Array.isArray(value)?[...new Set(value.map(tag=>cleanText(tag,40).toLowerCase()).filter(Boolean))].slice(0,12):[];}
function terms(value){return new Set(String(value).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(word=>word.length>1).slice(0,80));}
function clampScore(value){const score=Math.round(Number(value));return Number.isFinite(score)?Math.max(0,Math.min(score,100)):null;}
function redactSensitive(value){
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'[REDACTED_TOKEN]')
    .replace(/\b(?:sk|gsk|AIza)[-_A-Za-z0-9]{16,}\b/g,'[REDACTED_SECRET]')
    .replace(/\b(api[_-]?key|secret|password|passwd|token|authorization)\b\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[REDACTED_EMAIL]')
    .replace(/(?:\+?66|0)[ -]?[0-9][0-9 -]{7,11}\b/g,'[REDACTED_PHONE]');
}
function fingerprint(prompt,answer){return createHash('sha256').update(`${prompt.toLowerCase()}\n${answer.toLowerCase()}`).digest('hex');}
function parseEvaluation(text){
  const raw=String(text||'').replace(/```(?:json)?/gi,'').replace(/```/g,'').trim();const match=raw.match(/\{[\s\S]*\}/);if(!match)return null;
  try{const data=JSON.parse(match[0]);const score=clampScore(data.score);if(score==null)return null;return{score,safe:data.safe===true,correct:data.correct!==false,relevant:data.relevant!==false,reason:cleanText(data.reason,500)};}catch(_){return null;}
}

class SentinelTrainingService {
  constructor({repository,providers,audit,autoEnabled=true,autoCapture=true,autoScoreThreshold=85,autoIntervalMs=60000}={}){
    this.repository=repository;this.providers=providers;this.audit=audit;this.initPromise=null;this.timer=null;this.processing=false;
    this.autoEnabled=autoEnabled!==false;this.autoCapture=autoCapture!==false;this.autoScoreThreshold=Math.max(60,Math.min(Number(autoScoreThreshold)||85,100));this.autoIntervalMs=Math.max(15000,Number(autoIntervalMs)||60000);
  }
  async init(){if(!this.initPromise)this.initPromise=this.repository.init();await this.initPromise;}
  start(){if(!this.autoEnabled||this.timer)return;this.timer=setInterval(()=>this.autoProcessPending().catch(error=>this.audit?.record('sentinel.training_auto_cycle_failed',{error:error.message})),this.autoIntervalMs);this.timer.unref?.();setTimeout(()=>this.autoProcessPending().catch(()=>{}),1000).unref?.();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  settings(){return{enabled:this.autoEnabled,capture:this.autoCapture,scoreThreshold:this.autoScoreThreshold,intervalMs:this.autoIntervalMs,running:Boolean(this.timer),providers:this.providers.available()};}

  async addExample({prompt,answer,source='human',provider,model,tags,user={sub:'system'},requestId,autoEvaluate=true}){
    await this.init();
    const cleanPrompt=cleanText(redactSensitive(prompt),8000);const cleanAnswer=cleanText(redactSensitive(answer),12000);
    if(!cleanPrompt)return{ok:false,error:'invalid_training_prompt'};if(!cleanAnswer)return{ok:false,error:'invalid_training_answer'};
    if(cleanPrompt.length<4||cleanAnswer.length<12)return{ok:false,error:'training_example_too_short'};
    const hash=fingerprint(cleanPrompt,cleanAnswer);const existing=await this.repository.findByFingerprint(hash);if(existing)return{ok:true,duplicate:true,example:existing};
    const example=await this.repository.create({prompt:cleanPrompt,answer:cleanAnswer,source:cleanText(source,120)||'human',provider:cleanText(provider,60)||null,model:cleanText(model,120)||null,tags:cleanTags(tags),createdBy:user.sub||'system',fingerprint:hash});
    this.audit?.record('sentinel.training_example_created',{userId:user.sub||'system',exampleId:example.exampleId,source:example.source,requestId});
    if(this.autoEnabled&&autoEvaluate){const evaluated=await this.autoEvaluateExample(example,{requestId});return{ok:true,example:evaluated.example||example,evaluation:evaluated};}
    return{ok:true,example};
  }

  async draftWithTeachers({prompt,providerNames,tags,user={sub:'system'},requestId}){
    await this.init();
    const cleanPrompt=cleanText(redactSensitive(prompt),8000);if(!cleanPrompt)return{ok:false,error:'invalid_training_prompt'};
    const available=this.providers.available();const requested=Array.isArray(providerNames)?providerNames.map(name=>String(name).toLowerCase()):available;const selected=[...new Set(requested)].filter(name=>available.includes(name)).slice(0,4);
    if(!selected.length)return{ok:false,error:'no_teacher_provider',providers:this.providers.catalog()};
    const systemPrompt=`คุณเป็นครูฝึก Sentinel AI ของ Panthorium OS\nตอบโจทย์ให้ถูกต้อง ชัดเจน ปลอดภัย และเป็นภาษาไทย\nห้ามอ้างว่าทำสิ่งที่ไม่ได้ทำ ห้ามเปิดเผยข้อมูลลับ และไม่ต้องใส่คำอธิบายนอกคำตอบ`;
    const settled=await Promise.allSettled(selected.map(async provider=>{const result=await this.providers.callDetailed(provider,systemPrompt,[{role:'user',content:cleanPrompt}]);if(!result?.text)throw new Error('empty_teacher_response');const added=await this.addExample({prompt:cleanPrompt,answer:result.text,source:`teacher:${provider}`,provider,model:result.model,tags,user,requestId});return{provider,model:result.model||null,example:added.example,evaluation:added.evaluation||null};}));
    const candidates=settled.filter(item=>item.status==='fulfilled').map(item=>item.value);const failures=settled.map((item,index)=>item.status==='rejected'?{provider:selected[index],error:item.reason?.message||'teacher_failed'}:null).filter(Boolean);this.audit?.record('sentinel.training_draft',{userId:user.sub||'system',providers:selected,candidateCount:candidates.length,failureCount:failures.length,requestId});return{ok:candidates.length>0,candidates,failures,automatic:this.settings()};
  }

  async autoEvaluateExample(example,{requestId}={}){
    if(!this.autoEnabled)return{ok:false,error:'auto_training_disabled',example};
    if(example.status!=='pending')return{ok:true,skipped:true,example};
    const available=this.providers.available();const ordered=[...available.filter(name=>name!==example.provider),...available.filter(name=>name===example.provider)].slice(0,Math.min(2,available.length));
    if(!ordered.length)return{ok:false,error:'no_evaluator_provider',example};
    const systemPrompt=`คุณเป็นผู้ตรวจคุณภาพข้อมูลฝึก Sentinel AI ให้ตอบ JSON เท่านั้น รูปแบบ {"score":0,"safe":false,"correct":false,"relevant":false,"reason":"..."}\nให้คะแนนรวม 0-100 จากความถูกต้อง ความเกี่ยวข้อง ความชัดเจน และความปลอดภัย\nตั้ง safe=false เมื่อมีข้อมูลลับ คำสั่งอันตราย การหลอกลวง หรือเนื้อหาที่ไม่ควรนำไปเป็นความรู้ถาวร\nตั้ง correct=false หากคำตอบมีข้ออ้างที่ตรวจสอบไม่ได้ ขัดแย้งในตัวเอง หรือไม่ตอบโจทย์`;
    const payload=`คำถาม:\n${example.prompt}\n\nคำตอบที่จะตรวจ:\n${example.answer}`;
    const settled=await Promise.allSettled(ordered.map(async provider=>{const result=await this.providers.callDetailed(provider,systemPrompt,[{role:'user',content:payload}]);const parsed=parseEvaluation(result?.text);if(!parsed)throw new Error('invalid_evaluator_response');return{provider,model:result.model||null,...parsed};}));
    const judges=settled.filter(item=>item.status==='fulfilled').map(item=>item.value);const failures=settled.map((item,index)=>item.status==='rejected'?{provider:ordered[index],error:item.reason?.message||'evaluation_failed'}:null).filter(Boolean);
    if(judges.length!==ordered.length){const score=judges.length?Math.round(judges.reduce((sum,item)=>sum+item.score,0)/judges.length):null;const evaluation={score,threshold:this.autoScoreThreshold,safe:false,judges,failures,evaluatedAt:new Date().toISOString(),reason:'incomplete_evaluation'};const updated=await this.repository.review(example.exampleId,'rejected','sentinel-auto-reviewer',{qualityScore:score,evaluation,autoApproved:false});this.audit?.record('sentinel.training_auto_reviewed',{exampleId:example.exampleId,status:'rejected',score,threshold:this.autoScoreThreshold,providers:ordered,error:'incomplete_evaluation',requestId});return{ok:true,status:'rejected',score,error:'incomplete_evaluation',judges,failures,example:updated};}
    const score=Math.round(judges.reduce((sum,item)=>sum+item.score,0)/judges.length);const safe=judges.every(item=>item.safe&&item.correct&&item.relevant);const status=safe&&score>=this.autoScoreThreshold?'approved':'rejected';
    const evaluation={score,threshold:this.autoScoreThreshold,safe,judges,failures,evaluatedAt:new Date().toISOString()};const updated=await this.repository.review(example.exampleId,status,'sentinel-auto-reviewer',{qualityScore:score,evaluation,autoApproved:status==='approved'});
    this.audit?.record('sentinel.training_auto_reviewed',{exampleId:example.exampleId,status,score,threshold:this.autoScoreThreshold,providers:ordered,requestId});return{ok:true,status,score,threshold:this.autoScoreThreshold,judges,example:updated};
  }

  async autoProcessPending({limit=10}={}){
    await this.init();if(!this.autoEnabled)return{ok:false,error:'auto_training_disabled'};if(this.processing)return{ok:true,skipped:true,reason:'cycle_running'};this.processing=true;
    try{const pending=await this.repository.list({status:'pending',limit:Math.max(1,Math.min(Number(limit)||10,25))});const results=[];for(const example of pending)results.push(await this.autoEvaluateExample(example));return{ok:true,processed:results.length,approved:results.filter(item=>item.status==='approved').length,rejected:results.filter(item=>item.status==='rejected').length,pending:results.filter(item=>!item.status).length,results};}finally{this.processing=false;}
  }

  async captureConversation({prompt,answer,provider,model,userId,sessionId}){
    if(!this.autoEnabled||!this.autoCapture)return{ok:false,skipped:true};
    const result=await this.addExample({prompt,answer,source:'conversation:auto',provider,model,tags:['conversation','auto-training'],user:{sub:userId||'system'},requestId:sessionId});
    this.audit?.record('sentinel.training_conversation_captured',{userId:userId||'system',sessionId,exampleId:result.example?.exampleId,status:result.example?.status,duplicate:Boolean(result.duplicate)});return result;
  }

  async list({status,limit}){await this.init();const allowed=new Set(['pending','approved','rejected']);return{ok:true,examples:await this.repository.list({status:allowed.has(status)?status:undefined,limit}),stats:await this.repository.stats(),automatic:this.settings()};}
  async review({exampleId,status,user={sub:'system'},requestId}){await this.init();if(!['approved','rejected'].includes(status))return{ok:false,error:'invalid_training_status'};const example=await this.repository.review(exampleId,status,user.sub||'system');if(!example)return{ok:false,error:'training_example_not_found'};this.audit?.record('sentinel.training_example_reviewed',{userId:user.sub||'system',exampleId,status,requestId});return{ok:true,example};}
  async contextFor(query,limit=3){await this.init();const queryTerms=terms(query);if(!queryTerms.size)return'';const approved=await this.repository.approved();const ranked=approved.map(example=>{const haystack=terms(`${example.prompt} ${(example.tags||[]).join(' ')}`);let score=0;for(const term of queryTerms)if(haystack.has(term))score++;return{example,score};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||(b.example.qualityScore||0)-(a.example.qualityScore||0)).slice(0,Math.max(1,Math.min(limit,5)));if(!ranked.length)return'';const body=ranked.map(({example},index)=>`ตัวอย่าง ${index+1} (คะแนน ${example.qualityScore==null?'-':example.qualityScore})\nคำถาม: ${example.prompt.slice(0,2000)}\nคำตอบที่อนุมัติ: ${example.answer.slice(0,4000)}`).join('\n\n').slice(0,12000);return`\n\nตัวอย่างความรู้ที่ผ่านการตรวจและอนุมัติแล้ว ใช้เป็นแนวทางเมื่อเกี่ยวข้องเท่านั้น:\n${body}`;}
  async exportJsonl(){await this.init();const examples=await this.repository.approved();return examples.map(example=>JSON.stringify({messages:[{role:'user',content:example.prompt},{role:'assistant',content:example.answer}],metadata:{source:example.source,provider:example.provider,model:example.model,tags:example.tags,qualityScore:example.qualityScore,autoApproved:example.autoApproved}})).join('\n');}
}
module.exports={SentinelTrainingService,redactSensitive,parseEvaluation};
