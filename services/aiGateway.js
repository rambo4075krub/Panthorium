const { ProviderCircuitBreaker } = require('./providerCircuitBreaker');
const { ConcurrencyGate } = require('./concurrencyGate');
function classifyProviderFailure(error) {
  const message=String(error||'').toLowerCase();
  if(/permission_denied|permission denied|not authorized|iam permission/.test(message))return'permission_denied';
  if(/service_disabled|has not been used|api.{0,20}disabled|not enabled/.test(message))return'api_not_enabled';
  if(/billing|consumer invalid|billing account/.test(message))return'billing_or_project';
  if(/endpoint.{0,50}(not found|does not exist)|not found/.test(message))return'endpoint_not_found';
  if(/location|region/.test(message))return'location_mismatch';
  if(/quota|rate limit/.test(message))return'quota';
  return'unclassified';
}
class AiGateway {
  constructor({ providers, audit, circuitBreaker, concurrencyGate } = {}) { this.providers = providers; this.audit = audit; this.circuitBreaker=circuitBreaker||new ProviderCircuitBreaker({audit}); this.concurrencyGate=concurrencyGate||new ConcurrencyGate({audit,name:'ai'}); }
  catalog() { return this.providers.catalog(); }
  operations(){return{concurrency:this.concurrencyGate.stats(),circuits:this.circuitBreaker.catalog()};}
  orderedProviders(preferredProvider) { const available=this.providers.available().filter(p=>this.circuitBreaker.canAttempt(p)); return preferredProvider&&available.includes(preferredProvider)?[preferredProvider,...available.filter(p=>p!==preferredProvider)]:available; }
  async complete(input) { try{return await this.concurrencyGate.run(()=>this._complete(input));}catch(error){if(error.code==='system_busy')return{ok:false,error:'system_busy',text:'Sentinel: ระบบกำลังรับภาระสูง กรุณาลองใหม่อีกครั้ง'};throw error;} }
  async _complete({ systemPrompt, history, preferredProvider, preferredModel, userId, sessionId }) {
    const ordered=this.orderedProviders(preferredProvider); if(!ordered.length)return{ok:false,error:'no_provider',text:'Sentinel: ยังไม่ได้ตั้งค่า AI Provider หรือ provider ถูกพักชั่วคราว'}; const attempts=[];
    for(const provider of ordered){const started=Date.now();try{const result=await this.providers.callDetailed(provider,systemPrompt,history,{model:provider===preferredProvider?preferredModel:undefined});if(!result?.text)throw new Error('empty_provider_response');if(result.truncated)throw new Error('provider_response_truncated');this.circuitBreaker.success(provider);const response={ok:true,text:result.text,provider,model:result.model||null,usage:result.usage||null,latencyMs:Date.now()-started,fallbackCount:attempts.length,streaming:'none'};if(process.env.K_SERVICE==='panthorium-backend-staging'&&preferredProvider==='vertex'&&attempts.length){response.providerFailureCodes=attempts.map(item=>({provider:item.provider,code:/Provider HTTP (\d{3})/.exec(item.error)?.[1]||(/metadata|token/i.test(item.error)?'metadata':'transport'),reason:classifyProviderFailure(item.error),detail:String(item.error||'').slice(0,250)}));}this.audit?.record('ai.gateway.complete',{userId,sessionId,provider,model:response.model,latencyMs:response.latencyMs,fallbackCount:response.fallbackCount,usage:response.usage});return response;}catch(error){this.circuitBreaker.failure(provider,error);attempts.push({provider,error:error.message,latencyMs:Date.now()-started});this.audit?.record('ai.gateway.provider_failed',{userId,sessionId,provider,error:error.message,latencyMs:Date.now()-started});}}
    return{ok:false,error:'all_providers_failed',text:'Sentinel: ไม่สามารถเชื่อมต่อ AI Provider ได้ในขณะนี้',attempts:process.env.NODE_ENV==='production'?undefined:attempts};
  }
  async stream(input){try{return await this.concurrencyGate.run(()=>this._stream(input));}catch(error){if(error.code==='system_busy')return{ok:false,error:'system_busy',text:'Sentinel: ระบบกำลังรับภาระสูง กรุณาลองใหม่อีกครั้ง'};throw error;}}
  async _stream({ systemPrompt, history, preferredProvider, preferredModel, userId, sessionId, onDelta=()=>{}, onProvider=()=>{} }) {
    const ordered=this.orderedProviders(preferredProvider);if(!ordered.length)return{ok:false,error:'no_provider',text:'Sentinel: ยังไม่ได้ตั้งค่า AI Provider หรือ provider ถูกพักชั่วคราว'};const attempts=[];
    for(const provider of ordered){const started=Date.now();let emitted=false;try{onProvider({provider,fallbackCount:attempts.length});const result=await this.providers.streamDetailed(provider,systemPrompt,history,{model:provider===preferredProvider?preferredModel:undefined},delta=>{emitted=true;onDelta(delta);});if(!result?.text)throw new Error('empty_provider_response');if(result.truncated)throw new Error('provider_response_truncated');this.circuitBreaker.success(provider);const response={ok:true,text:result.text,provider,model:result.model||null,usage:result.usage||null,latencyMs:Date.now()-started,fallbackCount:attempts.length,streaming:result.streaming||'buffered'};this.audit?.record('ai.gateway.stream_complete',{userId,sessionId,provider,model:response.model,latencyMs:response.latencyMs,fallbackCount:response.fallbackCount,usage:response.usage,streaming:response.streaming});return response;}catch(error){this.circuitBreaker.failure(provider,error);attempts.push({provider,error:error.message,latencyMs:Date.now()-started});this.audit?.record('ai.gateway.stream_provider_failed',{userId,sessionId,provider,error:error.message,emitted});if(emitted)return{ok:false,error:'stream_interrupted',text:'',provider,attempts:process.env.NODE_ENV==='production'?undefined:attempts};}}
    return{ok:false,error:'all_providers_failed',text:'Sentinel: ไม่สามารถเชื่อมต่อ AI Provider ได้ในขณะนี้',attempts:process.env.NODE_ENV==='production'?undefined:attempts};
  }
}
module.exports={AiGateway};
