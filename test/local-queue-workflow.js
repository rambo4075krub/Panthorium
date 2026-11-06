'use strict';
const assert=require('node:assert/strict');
const {AiGateway}=require('../services/aiGateway');
const {ConcurrencyGate}=require('../services/concurrencyGate');
const {Sentinel}=require('../services/sentinel');
const {accountKey}=require('../services/localWorkIdentity');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const releases=[];
  const providers={hybrid:true,available:()=>['gemini-live','local'],entitlements:{state:async()=>({remaining:{aiCredits:10000}})},
    callDetailed:async(provider,_s,_h,options)=>{
      if(provider==='local')await new Promise(resolve=>releases.push(resolve));
      return{text:options.userId};
    },streamDetailed:async(_p,_s,_h,options,onDelta)=>{assert(options.signal);onDelta('answer');return{text:'answer'};}};
  const gateway=new AiGateway({providers,concurrencyGate:new ConcurrencyGate({limit:1,maxQueue:0})});
  const jobs=Array.from({length:5},(_,i)=>gateway.complete({preferredProvider:'local',userId:'u'+i,history:[]}));
  while(releases.length<5)await tick();
  assert.equal((await gateway.complete({preferredProvider:'local',userId:'overflow'})).error,'system_busy');
  assert.equal(gateway.localGate.stats().queued,0);
  assert.equal((await gateway.complete({preferredProvider:'gemini-live',userId:'paid'})).text,'paid','local saturation cannot consume the cloud admission gate');
  releases.forEach(resolve=>resolve());
  assert.deepEqual((await Promise.all(jobs)).map(r=>r.text),['u0','u1','u2','u3','u4']);
  assert.equal(gateway.localGate.stats().active,0);
  await gateway.stream({userId:'stream',signal:new AbortController().signal});
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(gateway.complete({preferredProvider:'local',signal:aborted.signal}),{name:'AbortError'});
  assert.equal(accountKey('u1').length,64); assert.notEqual(accountKey('u1'),accountKey('u2'));

  // Exercise the actual Sentinel graph, authenticated tool context and approval boundary.
  let modelCalls=0,toolCalls=0;
  const call={id:'c',name:'read',args:{}};
  const g={orderedProviders:()=>['local'],complete:async input=>{
    modelCalls++;
    if(input.history.length){assert.equal(input.lockedProvider,'local');return {ok:true,provider:'local',text:input.userId};}
    return {ok:true,provider:'local',functionCalls:[call],modelParts:[{functionCall:call}]};
  }};
  const sentinel=new Sentinel({gateway:g});
  const input=userId=>({systemPrompt:'s',history:[],preferredProvider:'local',userId,user:{sub:userId},requestId:userId,
    functionCalling:{declarationsFor:()=>[{name:'read'}],execute:async({user,requestId})=>{toolCalls++;assert.equal(user.sub,requestId);return{ok:true,toolId:'read',functionResponse:{name:'read',response:{owner:user.sub}}};}}});
  const answers=await Promise.all(['a','b'].map(id=>sentinel.completeWithFunctionCalls(input(id))));
  assert.deepEqual(answers.map(a=>a.text),['a','b']);assert.equal(toolCalls,2);
  const approval=input('approval');approval.functionCalling.execute=async()=>({ok:true,toolId:'studio.create',requiresConfirmation:true,actionId:'frozen',confirmation:{actionId:'frozen'},functionResponse:{name:'read',response:{confirmationRequired:true}}});
  const before=modelCalls;const result=await sentinel.completeWithFunctionCalls(approval);
  assert.equal(modelCalls,before+1);assert.equal(result.toolResults[0].actionId,'frozen');assert.equal(result.toolResults[0].requiresConfirmation,true);
  const cancel=new AbortController();const cancelling=input('cancel');cancelling.signal=cancel.signal;
  cancelling.functionCalling.execute=async()=>{cancel.abort();return{ok:true,toolId:'read',functionResponse:{name:'read',response:{}}};};
  const cancelledAt=modelCalls;await assert.rejects(sentinel.completeWithFunctionCalls(cancelling));assert.equal(modelCalls,cancelledAt+1);
  let executions=0;
  g.complete=async()=>({ok:true,provider:'local',functionCalls:Array.from({length:3},(_,i)=>({...call,id:String(i)})),modelParts:[]});
  const bounded=input('bounded');bounded.functionCalling.execute=async()=>{executions++;return{ok:true,toolId:'read',functionResponse:{name:'read',response:{}}};};
  const limited=await sentinel.completeWithFunctionCalls(bounded);assert.equal(limited.error,'function_call_round_limit');assert.equal(executions,5);
  console.log('PASS local concurrency isolation, cancellation, per-account identity, real LangGraph approval/round limits and no tool replay');
})().catch(error=>{console.error(error);process.exitCode=1;});
