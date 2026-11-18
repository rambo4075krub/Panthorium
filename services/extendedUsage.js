'use strict';
const {usageCost}=require('./sentinelUsage');
const get=(x,a,b)=>x[a]??x[b];
const count=n=>{if(!Number.isSafeInteger(n)||n<0)throw new Error('invalid_provider_usage');return n;};
const names={input:{TEXT:'textInputTokens',AUDIO:'audioInputTokens',IMAGE:'imageInputTokens',VIDEO:'videoInputTokens'},output:{TEXT:'textOutputTokens',AUDIO:'audioOutputTokens'}};
function parseDetails(list,direction){
  if(list==null)return{};
  if(!Array.isArray(list)||list.length>32)throw new Error('invalid_provider_usage');
  const out={};for(const item of list){const key=names[direction][item?.modality];if(!key)throw new Error('unpriced_provider_modality');out[key]=count((out[key]||0)+count(get(item,'tokenCount','token_count')));}return out;
}
// Explicit service policy: unclassified input/output tokens use the highest
// priced supported modality in that direction. This is a conservative service
// quota conversion, not a claim that Google's invoice labels them as audio.
function normalizeExtendedUsage(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_provider_usage');
  const input=parseDetails(get(value,'promptTokensDetails','prompt_tokens_details'),'input');
  const output=parseDetails(get(value,'responseTokensDetails','response_tokens_details')??get(value,'candidatesTokensDetails','candidates_tokens_details'),'output');
  const sum=x=>Object.values(x).reduce((n,v)=>count(n+v),0);
  const prompt=count(get(value,'promptTokenCount','prompt_token_count')??sum(input));
  const response=count(get(value,'responseTokenCount','response_token_count')??get(value,'candidatesTokenCount','candidates_token_count')??sum(output));
  if(prompt<sum(input)||response<sum(output))throw new Error('inconsistent_provider_usage');
  const thoughts=count(get(value,'thoughtsTokenCount','thoughts_token_count')??0);
  const tool=count(get(value,'toolUsePromptTokenCount','tool_use_prompt_token_count')??0);
  // The real service emits totals both with and without thoughts. Do not use
  // this redundant field as another debit or subtract thoughts from output.
  const total=get(value,'totalTokenCount','total_token_count');
  if(total!=null&&![prompt+response,prompt+response+thoughts,prompt+response+thoughts+tool].includes(count(total)))throw new Error('inconsistent_provider_total');
  return {...input,...output,thinkingTokens:thoughts,toolInputTokens:tool,
    unclassifiedInputTokens:prompt-sum(input),unclassifiedOutputTokens:response-sum(output)};
}
function pricedUsage(usage){
  const normal={};let extraCredits=0,extraNanoUsd=0;
  for(const [key,value] of Object.entries(usage)){count(value);
    if(key==='unclassifiedInputTokens'){extraCredits+=value*4;extraNanoUsd+=value*3000;}
    else if(key==='unclassifiedOutputTokens'){extraCredits+=value*14;extraNanoUsd+=value*12000;}
    else if(key==='estimatedTranscriptionTokens'){extraCredits+=value*5;extraNanoUsd+=value*4500;}
    else normal[key]=value;
  }
  const cost=usageCost(normal);return {credits:count(cost.credits+extraCredits),nanoUsd:count(cost.nanoUsd+extraNanoUsd)};
}
class ExtendedUsageAccumulator{
  constructor(){this.totals={};this.current={};this.sawUsage=false;this.transcriptBytes=0;this.generation=0;}
  add(frame){
    const usage=frame.usageMetadata||frame.usage_metadata;
    if(usage){const next=normalizeExtendedUsage(usage);for(const [key,n]of Object.entries(next))this.current[key]=Math.max(this.current[key]||0,n);this.sawUsage=true;}
    const c=frame.serverContent||frame.server_content||{};
    for(const t of [c.inputTranscription||c.input_transcription,c.outputTranscription||c.output_transcription])if(t?.text)this.transcriptBytes=count(this.transcriptBytes+Buffer.byteLength(t.text,'utf8'));
    const result={...this.totals};for(const [key,n]of Object.entries(this.current))result[key]=count((result[key]||0)+n);
    // The provider may omit text transcription tokens from its modality table.
    // Use a disclosed byte upper bound only for the missing part; never add
    // the same reported text output a second time.
    const complete=!!(c.turnComplete||c.turn_complete);
    result.estimatedTranscriptionTokens=count((this.totals.estimatedTranscriptionTokens||0)+(complete?Math.max(0,this.transcriptBytes-(this.current.textOutputTokens||0)):0));
    if(complete){if(!this.sawUsage)throw new Error('provider_usage_missing');this.totals=result;this.current={};this.sawUsage=false;this.transcriptBytes=0;this.generation++;}
    return {usage:result,complete,idle:complete&&(c.interactionStatus||c.interaction_status)==='IDLE',generation:this.generation};
  }
}
module.exports={normalizeExtendedUsage,pricedUsage,ExtendedUsageAccumulator};
