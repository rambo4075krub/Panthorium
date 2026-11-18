'use strict';

// Provider prices in nano-USD per token. Credit weights are service units,
// never a promise of a currency balance. No cache/free-tier discount is assumed.
const { aiRates, creditCost } = require('../billing-catalog');
const NANO_USD = Object.freeze({textInputTokens:750,textOutputTokens:4500,thinkingTokens:4500,
  toolInputTokens:750,audioInputTokens:3000,audioOutputTokens:12000,imageInputTokens:1000,videoInputTokens:1000});
const count = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_provider_usage');
  return value;
};
const get = (value, camel, snake) => value[camel] ?? value[snake];
function details(value, direction) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 32) throw new Error('invalid_provider_usage');
  const totals = {};
  const names = direction === 'input'
    ? {TEXT:'textInputTokens',AUDIO:'audioInputTokens',IMAGE:'imageInputTokens',VIDEO:'videoInputTokens'}
    : {TEXT:'textOutputTokens',AUDIO:'audioOutputTokens'};
  for (const item of value) {
    const key = names[item?.modality];
    if (!key) throw new Error('unpriced_provider_modality');
    totals[key] = count((totals[key] || 0) + count(get(item,'tokenCount','token_count')));
  }
  return totals;
}

// Normalize ONE provider report. This deliberately does not infer whether the
// provider reports per-turn or per-session values: verify the deployed model's
// actual protocol first. Never infer modality cost from a mixed total.
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw new Error('invalid_provider_usage');
  const prompt = details(get(usage,'promptTokensDetails','prompt_tokens_details'),'input');
  const response = details(get(usage,'responseTokensDetails','response_tokens_details') ?? get(usage,'candidatesTokensDetails','candidates_tokens_details'),'output');
  const thoughts = get(usage,'thoughtsTokenCount','thoughts_token_count') ?? 0;
  const tool = get(usage,'toolUsePromptTokenCount','tool_use_prompt_token_count') ?? 0;
  const promptCount = get(usage,'promptTokenCount','prompt_token_count');
  const responseCount = get(usage,'responseTokenCount','response_token_count') ?? get(usage,'candidatesTokenCount','candidates_token_count');
  if ((!prompt && promptCount) || (!response && responseCount)) throw new Error('provider_modality_details_required');
  const result = {...prompt,...response,thinkingTokens:count(thoughts),toolInputTokens:count(tool)};
  const sum = value => Object.values(value || {}).reduce((n,v)=>count(n+v),0);
  if (promptCount != null && count(promptCount) !== sum(prompt)) throw new Error('ambiguous_provider_prompt_usage');
  if (responseCount != null && count(responseCount) !== sum(response)) throw new Error('ambiguous_provider_response_usage');
  const total = get(usage,'totalTokenCount','total_token_count');
  // Live's documented total is prompt + response, not an invoice total that
  // includes separately reported thoughts. Do not add thoughts into this
  // consistency check or infer missing modality counts from the total.
  if (total != null && count(total) !== sum(prompt)+sum(response)) throw new Error('ambiguous_provider_total_usage');
  return result;
}
function usageCost(usage) {
  let nanoUsd=0;
  for (const [key,value] of Object.entries(usage)) {
    if (!(key in NANO_USD)) throw new Error('unpriced_provider_usage');
    nanoUsd=count(nanoUsd+count(value)*NANO_USD[key]);
  }
  return {credits:creditCost(usage),nanoUsd};
}
function advanceUsage(previous, next) {
  const cumulative={...previous};
  for (const [key,value] of Object.entries(next)) {
    if (!(key in NANO_USD)) throw new Error('unpriced_provider_usage');
    if (count(value)<(previous[key]||0)) throw new Error('provider_usage_counter_regressed');
    cumulative[key]=value;
  }
  return cumulative;
}
class UsageAccumulator {
  constructor({semantics}={}) {
    if(!['session','turn'].includes(semantics))throw new Error('usage_semantics_unverified');
    this.semantics=semantics;this.reports=new Map();
  }
  add({turnId,usage}) {
    // turnId is assigned by the SERVER's turn state machine, not by a client.
    if(this.semantics==='turn'&&(typeof turnId!=='string'||!turnId))throw new Error('usage_turn_identity_required');
    const key=this.semantics==='session'?'session':turnId;
    const next=advanceUsage(this.reports.get(key)||{},normalizeUsage(usage));
    this.reports.set(key,next);
    const total={};
    for(const report of this.reports.values())for(const [name,value] of Object.entries(report))total[name]=count((total[name]||0)+value);
    return total;
  }
}
function interactionIdle(frame) {
  const content=frame.serverContent || frame.server_content || {};
  return (content.interactionStatus || content.interaction_status || frame.interactionStatus || frame.interaction_status)==='IDLE';
}
module.exports={NANO_USD,normalizeUsage,usageCost,advanceUsage,interactionIdle,aiRates,UsageAccumulator};
