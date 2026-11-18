'use strict';
const assert=require('node:assert/strict');
const {scrubUsage,UsageLedgerRepository}=require('../services/usageLedgerRepository');
const {ProviderManager}=require('../services/providerManager');
const completion=require('../services/geminiLiveCompletion');
async function main(){
  const fixture={promptTokenCount:15426,candidatesTokenCount:104,thoughtsTokenCount:50,totalTokenCount:15580,
    promptTokensDetails:[{modality:'TEXT',tokenCount:15247},{modality:'AUDIO',tokenCount:179}],
    candidatesTokensDetails:[{modality:'AUDIO',tokenCount:104}],toolUsePromptTokenCount:0,
    secret:'must-not-be-stored',prompt:'private prompt',response:'private response'};
  const safe=scrubUsage(fixture);
  assert.equal(safe.candidatesTokenCount,104);assert.equal(safe.thoughtsTokenCount,50);
  assert.deepEqual(safe.candidatesTokensDetails,[{modality:'AUDIO',tokenCount:104}]);
  for(const name of ['secret','prompt','response'])assert.equal(safe[name],undefined);
  assert.deepEqual(scrubUsage({candidates_token_count:9,candidates_tokens_details:[{modality:'TEXT',token_count:9}],tool_use_prompt_tokens_details:[{modality:'TEXT',token_count:2}]}),
    {candidates_token_count:9,candidates_tokens_details:[{modality:'TEXT',token_count:9}],tool_use_prompt_tokens_details:[{modality:'TEXT',token_count:2}]});
  assert.deepEqual(scrubUsage({candidatesTokenCount:-1,thoughtsTokenCount:Infinity,candidatesTokensDetails:[{modality:'TEXT',tokenCount:1.5},{modality:'SECRET',tokenCount:4}]}),{});
  let stored;
  const ledger=new UsageLedgerRepository({pool:{query:async(sql,params)=>{if(params)stored=params;return {rows:[]};}},required:true});
  await ledger.init();await ledger.record({eventId:'fixture:1',userId:'owner',usage:fixture});
  assert.deepEqual(JSON.parse(stored[7]),safe);
  const original=completion.completeLive;let calls=0;
  const providers=Object.create(ProviderManager.prototype);
  Object.assign(providers,{cooling:new Map(),liveOnly:true,available:()=>['gemini-live'],onUsage:async event=>{calls++;assert.equal(event.usage.candidatesTokenCount,104);}});
  completion.completeLive=async options=>{assert.equal(options.onUsage,providers.onUsage);await options.onUsage({usage:fixture});return{text:'ok'};};
  try{await providers.callDetailed('gemini-live','',[],{});await providers.streamDetailed('gemini-live','',[],{},()=>{});assert.equal(calls,2);}
  finally{completion.completeLive=original;}
  console.log('Cost evidence: output/audio/thinking tokens, snake-case fields, redaction and both HTTP provider paths passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
