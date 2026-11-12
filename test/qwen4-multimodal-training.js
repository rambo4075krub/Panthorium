'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const JSZip=require('jszip');
const {createHash}=require('node:crypto');
const {Sentinel}=require('../services/sentinel');
const {AiGateway}=require('../services/aiGateway');
const {LocalLlmProvider}=require('../services/localLlmProvider');
const {createApiRouter}=require('../routes/api');
const {createTrainingRouter}=require('../routes/training');
const {prepareDataset,trainingBundle}=require('../services/qwenTrainingBundle');
const {validateMedia}=require('../services/localMedia');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
(async()=>{
  const original=global.fetch,saved=process.env.PANTHORIUM_LOCAL_QWEN;
  process.env.PANTHORIUM_LOCAL_QWEN='1';
  let user={sub:'admin',roles:['administrator'],permissions:['chat','settings']};
  const auth={verifyAccessToken:()=>user};
  const local=new LocalLlmProvider({LOCAL_LLM_URL:'http://127.0.0.1:8765/v1/chat/completions'});
  const payloads=[],sessions=new Map();
  const providers={hybrid:true,authorizeLocal:async()=>user.roles.includes('administrator'),available:()=>['local'],
    callDetailed:(_p,s,h,o)=>local.complete(s,h,{...o,hybrid:true})};
  const sentinel=new Sentinel({providers,gateway:new AiGateway({providers}),prompts:{build:()=>'',productContext:()=>''},
    sessions:{append(id,m){const rows=sessions.get(id)||[];rows.push(m);sessions.set(id,rows);return rows;},clear(){}}});
  const tools={declarationsFor:()=>[{name:'panthorium_system_status',parameters:{type:'object',properties:{}}}],
    execute:async({user:principal,call})=>{assert.equal(principal.sub,'admin');return{ok:true,toolId:'system.status',functionResponse:{id:call.id,name:call.name,response:{ready:true}}};}};
  const rows=Array.from({length:24},(_,i)=>({messages:[{role:'user',content:`Question ${i}`},{role:'assistant',content:`Answer ${i}`}],metadata:{qualityScore:95,source:'human'}}));
  const training={exportJsonl:async()=>rows.map(r=>JSON.stringify(r)).join('\n')};
  const app=express();app.use(express.json({limit:'2mb'}));
  app.use('/api',createApiRouter(sentinel,auth,null,null,null,null,null,null,null,null,tools));
  app.use('/api/training',createTrainingRouter(auth,training));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  global.fetch=async(url,options)=>{
    if(String(url).startsWith(base))return original(url,options);
    assert.equal(String(url),'http://127.0.0.1:8765/v1/chat/completions','media must never reach a cloud provider');
    const payload=JSON.parse(options.body);payloads.push(payload);
    const toolResult=payload.messages.some(m=>m.role==='tool');
    return new Response(JSON.stringify({choices:[{finish_reason:toolResult?'stop':'tool_calls',message:toolResult?{content:'ภาพและระบบพร้อม'}:{tool_calls:[{id:'c1',type:'function',function:{name:'panthorium_system_status',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}});
  };
  const send=body=>fetch(base+'/api/local/chat',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    let response=await send({message:'แสดงสถานะและอธิบายภาพ',media:[{dataUrl:image,seconds:1.5}],thinking:false});
    assert.equal(response.status,200);const answer=await response.json();assert.equal(answer.billable,false);assert.equal(answer.creditsCharged,0);assert.equal(answer.functionCallCount,1);
    assert.equal(payloads.length,2);
    for(const payload of payloads){assert.equal(payload.chat_template_kwargs.enable_thinking,false);const content=payload.messages.find(m=>m.role==='user').content;assert.equal(content.filter(p=>p.type==='image_url').length,1);assert.equal(content.at(-1).image_url.url,image);}
    assert(!JSON.stringify([...sessions.values()]).includes('data:image'),'image bytes are ephemeral across persistent text history');
    const calls=payloads.length;
    response=await send({message:'test',media:[{dataUrl:'http://169.254.169.254/metadata'}]});assert.equal(response.status,400);assert.equal(payloads.length,calls);
    response=await send({message:'test',media:Array(5).fill({dataUrl:image})});assert.equal(response.status,400);
    user={sub:'ordinary',roles:['user'],permissions:['chat']};
    response=await send({message:'test',media:[{dataUrl:image}]});assert.equal(response.status,403);assert.equal(payloads.length,calls);
    response=await fetch(base+'/api/training/qwen4/bundle',{method:'POST',headers:{Authorization:'Bearer fixture'}});assert.equal(response.status,403);
    user={sub:'admin',roles:['administrator'],permissions:['chat','settings']};
    response=await fetch(base+'/api/training/qwen4/bundle',{method:'POST',headers:{Authorization:'Bearer fixture'}});assert.equal(response.status,200);
    const zip=await JSZip.loadAsync(await response.arrayBuffer()),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
    for(const split of ['train','validation']){const raw=await zip.file(manifest[split].file).async('nodebuffer');assert.equal(createHash('sha256').update(raw).digest('hex'),manifest[split].sha256);}
    assert.equal(manifest.automaticProductionPromotion,false);assert(zip.file('train_qwen4.py'));assert(zip.file('requirements-training.txt'));
    assert.throws(()=>prepareDataset(''),/20_approved/);
    const bad=[...rows,{...rows[0],messages:[rows[0].messages[0],{role:'assistant',content:'conflicting'}]},...Array.from({length:10},(_,i)=>({...rows[i],metadata:{qualityScore:100,source:'acceptance:staging'}}))];
    const prepared=prepareDataset(bad.map(r=>JSON.stringify(r)).join('\n'));assert.equal(prepared.trainCount+prepared.validationCount,23);assert(!prepared.train.includes('conflicting'));assert(!prepared.validation.includes('conflicting'));
    assert.throws(()=>validateMedia([{dataUrl:image,seconds:Infinity}]),/invalid_local_media/);
    await assert.rejects(trainingBundle({exportJsonl:async()=>{throw Error('consent unavailable');}}),/consent unavailable/);
    console.log('Qwen4: HTTP authorization → Sentinel tool loop → local vision, ephemeral media, zero billing, approved training split/checksums/bundle passed');
  }finally{global.fetch=original;if(saved===undefined)delete process.env.PANTHORIUM_LOCAL_QWEN;else process.env.PANTHORIUM_LOCAL_QWEN=saved;server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
