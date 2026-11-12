'use strict';
const assert=require('node:assert/strict');
const {routeProviders,localTools}=require('../services/hybridAiPolicy');
const {AiGateway}=require('../services/aiGateway');
const {LocalLlmProvider}=require('../services/localLlmProvider');
const {attachModelMcp}=require('../services/modelMcpBridge');
const {chunks,BufferedSpeech}=require('../speech-buffer');
(async()=>{
 const saved=global.fetch;
 const p={authorizeLocal:async()=>true,hybrid:true,entitlements:{state:async()=>({remaining:{aiCredits:0}})}};
 assert.deepEqual(await routeProviders(p,['gemini-live','local'],{},'u'),['local']);
 p.entitlements.state=async()=>({remaining:{aiCredits:10000}});
 assert.deepEqual(await routeProviders(p,['gemini-live','local'],{preferredProvider:'local'},'u'),['local']);
 assert.deepEqual(await routeProviders(p,['gemini-live','local'],{history:[{role:'user',content:'แก้คำผิด ข้อความนี้'}]},'u'),['local','gemini-live']);
 assert.deepEqual(await routeProviders(p,['gemini-live','local'],{voiceMode:true,history:[{role:'user',content:'แก้คำผิด ข้อความนี้'}]},'u'),['gemini-live','local']);
 p.entitlements.state=async()=>{throw Error('db')};assert.deepEqual(await routeProviders(p,['gemini-live','local'],{},'u'),['local']);
 let invocations=[];
 p.available=()=>['gemini-live','local'];p.callDetailed=async provider=>{invocations.push(provider);return{text:'free',usage:{total_tokens:123}};};
 const gateway=new AiGateway({providers:p});
 const answer=await gateway.complete({systemPrompt:'s',history:[],userId:'u'});assert.equal(answer.creditsCharged,0);assert.deepEqual(invocations,['local']);
 p.callDetailed=async provider=>{invocations.push(provider);throw Error('local_resource_unavailable');};invocations=[];
 await gateway.complete({preferredProvider:'local',systemPrompt:'s',history:[],userId:'u'});assert.deepEqual(invocations,['local']);
 const local=new LocalLlmProvider({LOCAL_LLM_REASONING:'1'});let payload;
 global.fetch=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{id:'c1',function:{name:'panthorium_system_status',arguments:'{}'}}]},finish_reason:'tool_calls'}]})};};
 const tools=[{name:'panthorium_system_status',description:'status',parameters:{type:'OBJECT',properties:{}}}];
 const result=await local.complete('s',[{role:'user',content:'status'}],{hybrid:true,tools,voiceMode:true});
 assert.equal(result.functionCalls[0].name,'panthorium_system_status');assert.equal(result.creditsCharged,0);assert.equal(payload.chat_template_kwargs.enable_thinking,false);assert.equal(payload.tools[0].function.parameters.type,'object');
 await local.complete('s',[{role:'user',content:'status'},{role:'model',parts:result.modelParts},{role:'user',parts:[{functionResponse:{name:'panthorium_system_status',id:'c1',response:{ok:true}}}]}],{hybrid:true,tools});
 assert.equal(payload.messages.at(-1).role,'tool');assert.equal(payload.messages.at(-1).tool_call_id,'c1');
 const arithmeticTools=[{name:'panthorium_calculate',parameters:{type:'OBJECT',properties:{expression:{type:'STRING'}},required:['expression']}}];
 global.fetch=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'unverified number'}}]})};};
 await assert.rejects(local.complete('s',[{role:'user',content:'ราคา 546.02 บาท ลด 10 บาท'}],{hybrid:true,tools:arithmeticTools}),/local_required_calculation_missing/);
 assert.equal(payload.tool_choice,'required');assert.equal(payload.tools.length,1);
 // A required arithmetic turn gets a focused prompt and only the calculator.
 // The result turn restores the application instructions and tool-call pairing.
 const applicationPrompt='Keep the application context. '+('Unrelated mailbox guidance. '.repeat(120));
 global.fetch=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{id:'calc1',function:{name:'panthorium_calculate',arguments:'{"expression":"2+3"}'}}]},finish_reason:'tool_calls'}]})};};
 const arithmeticHistory=[{role:'user',content:'What is 2 + 3?'}];
 const calculated=await local.complete(applicationPrompt,arithmeticHistory,{hybrid:true,tools:[...tools,...arithmeticTools],thinking:false});
 assert.equal(payload.tool_choice,'required');assert.deepEqual(payload.tools.map(t=>t.function.name),['panthorium_calculate']);
 assert(payload.messages[0].content.length<700);assert(!payload.messages[0].content.includes('Unrelated mailbox'));
 assert.match(payload.messages[0].content,/current-account permissions/);assert.equal(payload.parallel_tool_calls,false);
 assert.deepEqual(calculated.functionCalls,[{id:'calc1',name:'panthorium_calculate',args:{expression:'2+3'}}]);
 global.fetch=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'5'},finish_reason:'stop'}]})};};
 const final=await local.complete(applicationPrompt,[...arithmeticHistory,{role:'model',parts:calculated.modelParts},{role:'user',parts:[{functionResponse:{name:'panthorium_calculate',id:'calc1',response:{ok:true,result:5}}}]}],{hybrid:true,tools:arithmeticTools,thinking:false});
 assert.equal(final.text,'5');assert.equal(payload.tool_choice,'auto');assert.match(payload.messages[0].content,/Keep the application context/);
 assert.equal(payload.messages.at(-1).role,'tool');assert.equal(payload.messages.at(-1).tool_call_id,'calc1');
 // Preserve an allowlisted resource failure through the real local provider and
 // gateway, including streaming, without billing or silently switching to cloud.
 global.fetch=async()=>new Response(JSON.stringify({detail:'local_resource_ram_headroom'}),{status:503,headers:{'content-type':'application/json'}});
 const callLocal=(_provider,system,history,options)=>local.complete(system,history,{...options,hybrid:true});
 p.callDetailed=callLocal;p.streamDetailed=callLocal;
 for(const method of ['complete','stream']){
   const failure=await gateway[method]({preferredProvider:'local',systemPrompt:'s',history:[{role:'user',content:'hello'}],userId:'u'});
   assert.equal(failure.error,'local_resource_ram_headroom');assert.match(failure.text,/RAM/);
   assert.equal(failure.creditsCharged,0);assert.equal(failure.billable,false);
 }
 assert.equal(gateway.localGate.stats().active,0);
 global.fetch=async()=>new Response(JSON.stringify({detail:'secret-unrecognized-diagnostic'}),{status:503});
 await assert.rejects(local.complete('s',[{role:'user',content:'hello'}],{hybrid:true}),/^Error: local_resource_unavailable$/);
 global.fetch=saved;
 let called=[];
 const service={listTools:(user,{scopes})=>user.sub==='owner'&&scopes.includes('panthorium:read')?[{name:'read',inputSchema:{type:'object',properties:{}}}]:[],callTool:async(user,name,args,id,options)=>{called.push({user,name,args,options});return{content:[{type:'text',text:'ok'}],structuredContent:{ok:true},isError:false};}};
 const fc=attachModelMcp({declarationsFor:()=>[],execute:async()=>({ok:false})},service);
 const user={sub:'owner'};
 const list=await fc.execute({user,requestId:'req',call:{name:'panthorium_mcp_list',id:'c',args:{}}});assert.equal(list.ok,true);assert.equal(list.output.tools[0].name,'read');
 const executed=await fc.execute({user,requestId:'req',call:{name:'panthorium_mcp_call',id:'c2',args:{name:'read',argumentsJson:'{}'}}});assert.equal(executed.ok,true);assert.equal(called.length,1);assert.equal(called[0].user,user);
 const denied=await fc.execute({user:{sub:'other'},call:{name:'panthorium_mcp_call',id:'c3',args:{name:'read',argumentsJson:'{}'}}});assert.equal(denied.ok,false);assert.equal(called.length,1);
 assert.deepEqual(chunks('ราคา 546.02 บาท'),['ราคา 546.02 บาท']);
 assert(localTools([{name:'panthorium_calculate'}],[{role:'user',content:'ราคา 546.02 บาท ลด 10 บาท เหลือเท่าไร'}]).some(t=>t.name==='panthorium_calculate'));
 const long=chunks(('ราคา 546.02 บาท และ 1,234.56 บาท เป็นราคาตัวอย่างที่ต้องอ่านต่อกัน ').repeat(20));assert(long.length>1);assert.equal(long.filter(x=>x.includes('546.')&&!x.includes('546.02')).length,0);
 // Decode/prefetch both clips before first playback; no fetch waits for onended.
 const events=[];let now=0;const context={get currentTime(){return now;},decodeAudioData:async()=>({duration:.05}),createBufferSource:()=>{const s={connect(){},start(at){events.push(['play',at]);setTimeout(()=>{now=at+.05;s.onended();},5);},stop(){s.onended?.();}};return s;},destination:{}};
 const queue=new BufferedSpeech(context,async text=>{events.push(['fetch',text]);return new ArrayBuffer(2);});
 await queue.speak(('ประโยคภาษาไทยที่ยาวพอสำหรับแบ่งเป็นช่วงเสียงได้ตามธรรมชาติ ').repeat(10));
 assert.equal(events[0][0],'fetch');assert.equal(events[1][0],'fetch');assert.equal(events[2][0],'play');
 console.log('Hybrid: quota routing, explicit-free no paid fallback, tool protocol/identity, real MCP transport and audio prefetch/decimal tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
