'use strict';
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
process.env.PANTHORIUM_GEMINI_EXTENDED='1';
const {ExtendedUsageAccumulator,normalizeExtendedUsage,pricedUsage}=require('../services/extendedUsage');
const {ExtendedQuotaMeter}=require('../services/extendedQuotaMeter');
const {completeLive}=require('../services/geminiLiveCompletion');
const {createSetupMessage,resolveLiveTarget}=require('../services/geminiLiveVertex');
const report={promptTokenCount:2947,responseTokenCount:26,totalTokenCount:2973,promptTokensDetails:[{modality:'TEXT',tokenCount:2614},{modality:'AUDIO',tokenCount:222}],responseTokensDetails:[{modality:'AUDIO',tokenCount:26}],thoughtsTokenCount:81};
const idle={turnComplete:true,interactionStatus:'IDLE'};
function memoryBudget(limit=100000){
  let held=0,actual=0,final=false;
  return {entitlements:{state:async()=>({plan:limit===5000?'free':'life',remaining:{aiCredits:limit-held},unlimited:[]})},reservations:{init:async()=>{},reserve:async(u,id,n)=>{if(n>limit)throw new Error('quota_exceeded');held=n;},settle:async(u,id,usage,options={})=>{actual=pricedUsage(usage).credits;if(actual>held)throw new Error('provider_budget_exceeded');if(options.final){held=actual;final=true;}return{credits:actual};}},state:()=>({held,actual,final})};
}
async function main(){
  const usage=normalizeExtendedUsage(report);assert.equal(usage.unclassifiedInputTokens,111);assert.equal(pricedUsage(usage).credits,4715);
  const acc=new ExtendedUsageAccumulator();acc.add({usageMetadata:report});acc.add({usageMetadata:report});let x=acc.add({serverContent:idle});assert.equal(pricedUsage(x.usage).credits,4715,'repeat snapshot within an utterance is not added');
  acc.add({usageMetadata:report});x=acc.add({serverContent:idle});assert.equal(pricedUsage(x.usage).credits,9430,'new utterance rebills context, including an identical prompt');
  const tool=new ExtendedUsageAccumulator();tool.add({usageMetadata:report,serverContent:{turnComplete:true,interactionStatus:'IN_PROGRESS'}});
  x=tool.add({usageMetadata:{promptTokenCount:6172,responseTokenCount:23,totalTokenCount:6834,promptTokensDetails:[{modality:'TEXT',tokenCount:5770},{modality:'AUDIO',tokenCount:269}],responseTokensDetails:[{modality:'TEXT',tokenCount:23}],thoughtsTokenCount:639},serverContent:idle});
  assert(x.idle);assert.equal(x.usage.thinkingTokens,720);assert.equal(x.usage.audioOutputTokens,26);assert.equal(x.usage.textOutputTokens,23);
  assert.throws(()=>normalizeExtendedUsage({...report,totalTokenCount:1}),/inconsistent/);
  assert.throws(()=>normalizeExtendedUsage({promptTokensDetails:[{modality:'UNKNOWN',tokenCount:3}]}),/unpriced/);
  const transcript=new ExtendedUsageAccumulator();transcript.add({serverContent:{outputTranscription:{text:'hello'}}});transcript.add({usageMetadata:{promptTokenCount:0,responseTokenCount:2,responseTokensDetails:[{modality:'TEXT',tokenCount:2}]}});x=transcript.add({serverContent:idle});assert.equal(x.usage.estimatedTranscriptionTokens,3,'only missing transcript tokens use the explicit upper-bound policy');
  const mem=memoryBudget(5000),meter=new ExtendedQuotaMeter({userId:'test',...mem});const config=await meter.start({systemInstruction:'Sentinel'});assert.equal(config.maxOutputTokens,128);assert(mem.state().held>0);
  await meter.input({clientContent:{turns:[{parts:[{text:'hi'}]}],turnComplete:true}});await meter.output({usageMetadata:report,serverContent:idle});await meter.close();assert.equal(mem.state().actual,4715);assert(mem.state().final);
  const failed=memoryBudget(),partial=new ExtendedQuotaMeter({userId:'test',...failed});await partial.start();await partial.input({realtimeInput:{text:'hello'}});await partial.close();assert.equal(failed.state().final,false,'unknown transport cost is not refunded automatically');
  const target=resolveLiveTarget();assert.equal(target.model,'models/gemini-3.8-live-extended-thinking');
  const setup=createSetupMessage({model:target.model,tools:[{name:'test'}],maxOutputTokens:256});assert.equal(setup.setup.tools[0].function_declarations[0].behavior,'NON_BLOCKING');assert.equal(setup.setup.generation_config.thinking_config.thinking_level,'MEDIUM');
  let reserved=false,inputs=0,closed=false,calls=0,continuing=false;
  const fakeMeter={start:async()=>{reserved=true;return{maxOutputTokens:256,thinkingLevel:'LOW'};},input:async()=>{inputs++;},output:async()=>{},close:async()=>{closed=true;}};
  class Socket extends EventEmitter{constructor(){super();this.readyState=1;}close(){this.readyState=3;}send(raw){const frame=JSON.parse(raw);if(frame.client_content){assert(reserved);setImmediate(()=>{this.emit('message',JSON.stringify({serverContent:{turnComplete:true,interactionStatus:'IN_PROGRESS',outputTranscription:{text:'Checking. '}}}));this.emit('message',JSON.stringify({toolCall:{functionCalls:[{id:'one',name:'test',args:{}}]}}));});}else if(frame.tool_response){continuing=true;setImmediate(()=>this.emit('message',JSON.stringify({serverContent:{...idle,outputTranscription:{text:'Done.'}}})));}}}
  const socket=new Socket();const result=await completeLive({systemPrompt:'Test',history:[{role:'user',content:'test'}],tools:[{name:'test'}],userId:'test',entitlements:memoryBudget().entitlements,meterFactory:()=>fakeMeter,connect:async()=>{assert(reserved);setImmediate(()=>socket.emit('message',JSON.stringify({setupComplete:{}})));return socket;},onFunctionCalls:async value=>{calls++;return value.map(c=>({id:c.id,name:c.name,response:{ok:true}}));}});
  assert.equal(calls,1);assert.equal(inputs,2);assert(continuing&&closed);assert.equal(result.text,'Checking. Done.');
  console.log('Extended Live: real usage fixtures, conservative unresolved modalities, transcription accounting, per-utterance context, durable hold protocol and asynchronous tool round-trip passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
