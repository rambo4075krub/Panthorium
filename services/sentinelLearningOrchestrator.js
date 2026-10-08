const {AutonomousLearningPolicy}=require('./autonomousLearningPolicy');
const {SentinelLearningPolicyService}=require('./sentinelLearningPolicyService');

const PROMOTION_CONTROL_KEY='autonomous_promotion';

class SentinelLearningOrchestrator{
  constructor({repository,trainingRepository,audit,policy=new AutonomousLearningPolicy(),shadowEvaluator,recovery=null,researchPolicy=null}={}){this.repository=repository;this.trainingRepository=trainingRepository;this.audit=audit;this.policy=policy;this.shadowEvaluator=shadowEvaluator;this.recovery=recovery;this.researchPolicy=researchPolicy||new SentinelLearningPolicyService({promotionThreshold:policy.promotionScore,shadowMinSamples:policy.shadowMinSamples,maxPromotionsPerHour:policy.maxPromotionsPerHour});}
  async init(){await this.repository.init();await this.hydratePromotionControl();}

  // The emergency stop is an operator decision, so a stored state always wins
  // over the environment default. Without this a restart (or a second Cloud Run
  // instance) would silently resume autonomous promotion.
  async hydratePromotionControl(){
    if(this.promotionHydrated)return this.policy.promotionControl?.()||{enabled:true};
    this.promotionHydrated=true;
    if(typeof this.repository.getControl!=='function'||typeof this.policy.setPromotionEnabled!=='function')return this.policy.promotionControl?.()||{enabled:true};
    try{
      const stored=await this.repository.getControl(PROMOTION_CONTROL_KEY);
      if(stored&&typeof stored.value?.enabled==='boolean')this.policy.setPromotionEnabled(stored.value.enabled,{actor:stored.value.actor||stored.updatedBy||'persisted_state',reason:stored.value.reason||'restored_from_persisted_state'});
    }catch(error){
      // Fail safe: if the store is unreachable, keep autonomous promotion off.
      this.policy.setPromotionEnabled(false,{actor:'system',reason:`promotion_control_load_failed:${error.message}`});
      this.audit?.record('sentinel.learning_promotion_control_load_failed',{error:error.message});
    }
    return this.policy.promotionControl?.()||{enabled:true};
  }
  riskFor(example){const text=`${example.prompt||''}\n${example.answer||''}`.toLowerCase();const protectedHit=this.policy.protectedDomains.some(d=>text.includes(d.replaceAll('_',' '))||text.includes(d));return protectedHit?'protected':'normal';}
  async exampleFor(exampleId){return(await this.trainingRepository.list({limit:500})).find(x=>x.exampleId===exampleId)||null;}
  async quarantine(example){await this.init();const risk=this.riskFor(example);const judges=example.evaluation?.judges||[];const consensus=judges.length?Math.round((judges.filter(j=>j.safe&&j.correct&&j.relevant).length/judges.length)*100):0;const version=await this.repository.create({exampleId:example.exampleId,state:'quarantined',score:example.qualityScore,risk,metadata:{source:example.source,provider:example.provider,model:example.model,fingerprint:example.fingerprint,evaluatorConsensus:consensus,reviewers:judges.map(j=>j.provider)}});await this.repository.event(version.versionId,'quarantined',{risk,consensus});this.audit?.record('sentinel.learning_quarantined',{versionId:version.versionId,exampleId:example.exampleId,risk,consensus});return version;}
  async evaluateForShadow(version,example){const evaluation=example.evaluation||{};const judges=Array.isArray(evaluation.judges)?evaluation.judges:[];const decision=this.policy.promotionDecision({score:example.qualityScore,safe:evaluation.safe===true,reviewers:judges.map(j=>j.provider),risk:version.risk,shadowSamples:0,shadowScore:null,regressionPct:0});if(!decision.ok&&decision.reasons.some(r=>['protected_domain','unsafe_evaluation','score_below_threshold','insufficient_reviewers'].includes(r))){const rejected=await this.repository.update(version.versionId,{state:'rejected',score:example.qualityScore,metadata:{...version.metadata,gate:decision}});await this.repository.event(version.versionId,'risk_gate_rejected',{decision});return rejected;}const shadow=await this.repository.update(version.versionId,{state:'shadow',score:example.qualityScore,baselineScore:example.qualityScore,metadata:{...version.metadata,gate:decision}});await this.repository.event(version.versionId,'shadow_started',{baselineScore:example.qualityScore});return shadow;}
  async recordShadow(versionId,{score,safe=true,criticalSafetyEvent=false,caseId=null,metadata={}}={}){
    const v=await this.repository.get(versionId);
    if(!v||v.state!=='shadow')return{ok:false,error:'learning_version_not_in_shadow'};
    const seen=Array.isArray(v.metadata?.shadowSampleCaseIds)?v.metadata.shadowSampleCaseIds:[];
    if(caseId&&seen.includes(caseId))return{ok:true,duplicate:true,version:v,regressionPct:Number(v.metadata?.regressionPct||0)};
    const sampleScore=Math.max(0,Math.min(100,Math.round(Number(score)||0)));
    const count=v.shadowSamples+1;
    const aggregate=Math.round((((v.shadowScore||0)*v.shadowSamples)+sampleScore)/count);
    const regressionPct=v.baselineScore==null?0:Math.max(0,v.baselineScore-aggregate);
    const shadowSampleCaseIds=caseId?[...seen,caseId].slice(-10000):seen;
    const next=await this.repository.update(versionId,{shadowSamples:count,shadowScore:aggregate,metadata:{...v.metadata,shadowSampleCaseIds,lastShadow:{safe,criticalSafetyEvent,regressionPct,caseId,...metadata},regressionPct}});
    await this.repository.event(versionId,'shadow_sample',{caseId,score:sampleScore,safe,criticalSafetyEvent,aggregate,regressionPct});
    if(criticalSafetyEvent||!safe)return this.rollback(versionId,{reason:'shadow_safety_event',autoRecover:true});
    return{ok:true,version:next,regressionPct};
  }
  async promoteIfReady(versionId){
    const v=await this.repository.get(versionId);
    if(!v||v.state!=='shadow')return{ok:false,error:'learning_version_not_in_shadow'};
    const example=await this.exampleFor(v.exampleId);
    if(!example)return{ok:false,error:'training_example_not_found'};
    const evaluation=example.evaluation||{};
    const judges=Array.isArray(evaluation.judges)?evaluation.judges:[];
    const measured=v.metadata?.measuredShadow;
    const required=Number(this.policy.shadowMinSamples||30);
    const comparisons=Array.isArray(measured?.comparisons)?measured.comparisons:[];
    const uniqueCases=new Set(comparisons.map(item=>item.caseId).filter(Boolean));
    const evidenceComplete=measured?.schema===1
      && Number(measured.sampleCount||0)>=required
      && comparisons.length===Number(measured.sampleCount||0)
      && uniqueCases.size===comparisons.length
      && comparisons.every(item=>Array.isArray(item.judgeProviders)&&new Set(item.judgeProviders).size>=2&&Number(item.safety)>=90)
      && Number(measured.worstRegression??measured.maxRegression)>-1
      && Number(measured.worstRegression??measured.maxRegression)<=Number(this.policy.maxRegressionPct||5);
    const content=`${example.prompt||''}\n${example.answer||''}`;
    const sensitiveHit=/(?:\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\b(?:sk-[A-Za-z0-9_-]{16,}|gsk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?66|0)[ -]?[0-9][0-9 -]{7,11}\b)/i.test(content);
    const poisoningHit=/(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|reveal\s+(?:the\s+)?system prompt|bypass\s+(?:all\s+)?safety|override\s+(?:your\s+)?instructions|ละเว้นคำสั่งก่อนหน้า|เปิดเผยระบบคำสั่ง|ข้ามข้อกำหนดความปลอดภัย)/i.test(content);
    const evaluatorGate=judges.length>=Number(this.policy.minReviewers||2)&&judges.every(j=>j.safe===true&&j.correct===true&&j.relevant===true);
    const provenance=Boolean(example.exampleId&&example.source&&example.fingerprint);
    const recentEvents=await this.repository.recentEvents?.(500)||[];
    const hourAgo=Date.now()-60*60*1000;
    const recentPromotions=recentEvents.filter(event=>event.event==='promoted'&&Date.parse(event.createdAt)>=hourAgo).length;
    const regressionPct=v.baselineScore==null?0:Math.max(0,v.baselineScore-(v.shadowScore||0));
    const researchDecision=this.researchPolicy.evaluatePromotion({
      candidate:{prompt:example.prompt,response:example.answer,sourceId:example.fingerprint,source:example.source},
      evaluation:{deterministicSafetyPassed:evaluation.safe===true&&!sensitiveHit&&!poisoningHit,piiSecretScanPassed:!sensitiveHit,poisoningScanPassed:!poisoningHit,provenancePassed:provenance,allEvaluatorsPassed:evaluatorGate,score:example.qualityScore},
      shadow:{samples:evidenceComplete?comparisons.length:0,benchmarkPassed:evidenceComplete,criticalRegression:!evidenceComplete||Number(measured?.worstRegression??measured?.maxRegression)>Number(this.policy.maxRegressionPct||5)},
      recentPromotions
    });
    const decision=this.policy.promotionDecision({score:example.qualityScore,safe:evaluation.safe===true&&evidenceComplete,reviewers:judges.map(j=>j.provider),risk:v.risk,shadowSamples:evidenceComplete?v.shadowSamples:0,shadowScore:evidenceComplete?v.shadowScore:null,regressionPct,recentPromotions});
    const reasons=[...new Set([...decision.reasons,...researchDecision.reasons])];
    if(!evidenceComplete&&!reasons.includes('measured_shadow_evidence_required'))reasons.push('measured_shadow_evidence_required');
    decision.reasons=reasons;decision.ok=reasons.length===0;decision.researchGate=researchDecision;
    if(!decision.ok)return{ok:true,promoted:false,decision,version:v};
    const promoted=await this.repository.update(versionId,{state:'active',promotedAt:new Date().toISOString(),metadata:{...v.metadata,promotion:decision,regressionPct}});
    await this.repository.event(versionId,'promoted',{decision,regressionPct});
    this.audit?.record('sentinel.learning_promoted',{versionId,exampleId:v.exampleId,score:v.score,shadowScore:v.shadowScore,regressionPct,recentPromotions});
    return{ok:true,promoted:true,decision,version:promoted};
  }
  async monitor(versionId,{rollingScore,baselineScore,criticalSafetyEvent=false}={}){const v=await this.repository.get(versionId);if(!v||v.state!=='active')return{ok:false,error:'learning_version_not_active'};const baseline=Number.isFinite(Number(baselineScore))?Number(baselineScore):v.baselineScore;const decision=this.policy.rollbackDecision({rollingScore,baselineScore:baseline,criticalSafetyEvent});const regressionPct=Number.isFinite(Number(rollingScore))&&Number.isFinite(Number(baseline))?Math.max(0,Number(baseline)-Number(rollingScore)):0;await this.repository.update(versionId,{metadata:{...v.metadata,lastMonitor:{rollingScore,baselineScore:baseline,criticalSafetyEvent,regressionPct,decision,at:new Date().toISOString()},regressionPct}});await this.repository.event(versionId,'production_monitor',{rollingScore,baselineScore:baseline,criticalSafetyEvent,regressionPct,decision});if(decision.rollback)return this.rollback(versionId,{reason:decision.reason,autoRecover:true});return{ok:true,rollback:false,decision,regressionPct};}
  async rollback(versionId,{reason='automatic_rollback',autoRecover=false}={}){const v=await this.repository.get(versionId);if(!v)return{ok:false,error:'learning_version_not_found'};if(v.state==='rolled_back'){if(autoRecover&&this.recovery?.recoverSoon)this.recovery.recoverSoon(versionId,{reason});return{ok:true,rollback:true,idempotent:true,reason:v.metadata?.rollbackReason||reason,version:v,recoveryScheduled:Boolean(autoRecover&&this.recovery)};}const rolled=await this.repository.update(versionId,{state:'rolled_back',retiredAt:new Date().toISOString(),metadata:{...v.metadata,rollbackReason:reason,rollbackAt:new Date().toISOString(),automaticRecoveryScheduled:Boolean(autoRecover)}});await this.repository.event(versionId,'rolled_back',{reason,autoRecover});this.audit?.record('sentinel.learning_rolled_back',{versionId,exampleId:v.exampleId,reason,autoRecover});if(autoRecover&&this.recovery?.recoverSoon)this.recovery.recoverSoon(versionId,{reason});return{ok:true,rollback:true,reason,version:rolled,recoveryScheduled:Boolean(autoRecover&&this.recovery)};}
  async recover(versionId){if(!this.recovery)return{ok:false,error:'automatic_recovery_unavailable'};return this.recovery.recover(versionId,{reason:'administrator_requested_recovery'});}
  async status(){const versions=await this.repository.list({limit:500});const events=await this.repository.recentEvents(80);const counts={quarantined:0,shadow:0,active:0,rejected:0,rolled_back:0};for(const v of versions)counts[v.state]=(counts[v.state]||0)+1;const active=versions.filter(v=>v.state==='active');const shadow=versions.filter(v=>v.state==='shadow');const average=(items,key)=>items.length?Math.round(items.reduce((s,x)=>s+Number(x[key]||0),0)/items.length):0;return{ok:true,counts,total:versions.length,metrics:{activeAverageScore:average(active,'score'),shadowAverageScore:average(shadow,'shadowScore'),averageConsensus:versions.length?Math.round(versions.reduce((s,v)=>s+Number(v.metadata?.evaluatorConsensus||0),0)/versions.length):0,recoveryPending:versions.filter(v=>v.state==='rolled_back'&&v.metadata?.automaticRecoveryScheduled).length},policy:{promotionScore:this.policy.promotionScore,shadowMinSamples:this.policy.shadowMinSamples,shadowScore:this.policy.shadowScore,maxRegressionPct:this.policy.maxRegressionPct,rollbackScore:this.policy.rollbackScore,promotionControl:this.policy.promotionControl?.()||{enabled:true}},events};}

  async setPromotionEnabled(enabled,{actor='administrator',reason=null,requestId=null}={}){const control=this.policy.setPromotionEnabled(enabled,{actor,reason});this.promotionHydrated=true;if(typeof this.repository.setControl==='function'){try{await this.repository.setControl(PROMOTION_CONTROL_KEY,{enabled:control.enabled,actor,reason:control.reason,requestId},{actor});}catch(error){
      // Never report a resume we could not persist: fall back to paused so the
      // next instance or restart cannot inherit an unsafe enabled state.
      const safe=this.policy.setPromotionEnabled(false,{actor:'system',reason:`promotion_control_persist_failed:${error.message}`});
      this.audit?.record('sentinel.learning_promotion_control_persist_failed',{actor,error:error.message});
      return{ok:false,error:'promotion_control_persist_failed',detail:error.message,promotionControl:safe};
    }}await this.repository.event(null,control.enabled?'promotion_emergency_stop_released':'promotion_emergency_stop_activated',{...control,requestId});this.audit?.record(control.enabled?'sentinel.learning_promotion_resumed':'sentinel.learning_promotion_paused',{actor,reason:control.reason,requestId});return{ok:true,promotionControl:control};}
}
module.exports={SentinelLearningOrchestrator};

