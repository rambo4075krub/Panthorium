'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {Sentinel}=require('../services/sentinel');
const {ProviderManager}=require('../services/providerManager');
const {AiGateway}=require('../services/aiGateway');
const {createApiRouter}=require('../routes/api');
const {createTrainingRouter}=require('../routes/training');
const {enforceAiMode}=require('../services/aiModePolicy');
const {createLocalAiAuthorizer}=require('../services/localAiAccess');

(async()=>{
  const saved={...process.env},nativeFetch=global.fetch;
  let server;
  try{
    Object.assign(process.env,{PANTHORIUM_AI_MODE:'local-only',PANTHORIUM_LOCAL_QWEN:'1',LOCAL_LLM_URL:'http://127.0.0.1:8765/v1/chat/completions'});
    delete process.env.PANTHORIUM_LOCAL_PROFILE;enforceAiMode();
    let regular={id:'regular',sub:'regular',roles:[],permissions:['chat']};
    let admin={id:'admin',sub:'admin',roles:['administrator'],permissions:['chat','system:read','settings']};
    const owner={id:'owner',sub:'owner',roles:[],permissions:['chat'],email:'rambo4075krub@gmail.com',emailVerifiedAt:new Date().toISOString()};
    const auth={verifyAccessToken:token=>token==='admin'?admin:token==='owner'?owner:regular,repository:{findUserById:async id=>id==='regular'?regular:id==='admin'?admin:id==='owner'?owner:null}};
    const providers=new ProviderManager();providers.authorizeLocal=createLocalAiAuthorizer(auth);
    const sessions=new Map(),payloads=[],audit={record(){}};
    const sentinel=new Sentinel({providers,gateway:new AiGateway({providers}),prompts:{build:()=>'',productContext:()=>''},
      sessions:{append(id,m){const a=sessions.get(id)||[];a.push(m);sessions.set(id,a);return a;},clear(){},size:()=>sessions.size}});
    const app=express();app.use(express.json());
    app.use('/api',createApiRouter(sentinel,auth,audit));
    app.use('/api/training',createTrainingRouter(auth,{exportJsonl:async()=>''}));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base='http://127.0.0.1:'+server.address().port;
    global.fetch=async(url,options)=>{
      if(String(url).startsWith(base))return nativeFetch(url,options);
      assert.equal(String(url),'http://127.0.0.1:8765/v1/chat/completions');
      payloads.push(JSON.parse(options.body));
      return Response.json({choices:[{finish_reason:'stop',message:{content:'คำตอบในเครื่อง'}}]});
    };
    const request=(path,body,token='regular')=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    let r=await request('/api/ai/providers');assert.equal(r.status,403,'provider administration stays restricted');
    r=await request('/api/local/chat',{message:'สวัสดี'});assert.equal(r.status,403);assert.equal(payloads.length,0,'general accounts cannot reach Qwen');
    r=await request('/api/chat',{message:'สวัสดี'},'admin');assert.equal(r.status,200);const answer=await r.json();assert.equal(answer.ok,true);assert.equal(answer.provider,'local');assert.equal(answer.creditsCharged,0);
    assert.equal(payloads.at(-1).chat_template_kwargs.enable_thinking,false);
    for(const thinking of [true,false]){
      r=await request('/api/chat/stream',{message:'ทดสอบโหมด',thinking},'admin');assert.equal(r.status,200);assert.match(await r.text(),/event: done/);
      assert.equal(payloads.at(-1).chat_template_kwargs.enable_thinking,thinking);
    }
    for(const path of ['/api/chat','/api/chat/stream','/api/local/chat'])assert.equal((await request(path,{message:'test',thinking:'true'},'admin')).status,400);
    r=await request('/api/local/chat',{message:'test'},'owner');assert.equal(r.status,200,'verified system owner can use Qwen');
    assert.equal((await request('/api/sentinel/status')).status,403,'ordinary chat access does not grant system access');
    assert.equal((await request('/api/training/qwen4/bundle',{})).status,403,'ordinary chat access does not grant training administration');
    assert.equal((await request('/api/sentinel/status',null,'admin')).status,200);
    const count=payloads.length;
    admin={...admin,roles:[]};assert.equal((await request('/api/local/chat',{message:'test'},'admin')).status,403,'administrator downgrade takes effect');
    regular={...regular,permissions:[]};assert.equal((await request('/api/local/chat',{message:'test'})).status,403);
    regular={...regular,permissions:['chat'],roles:['guest']};assert.equal((await request('/api/local/chat',{message:'test'})).status,403);
    assert.equal(payloads.length,count,'revoked or guest accounts never reach inference');
    console.log('PASS Qwen admin/verified-owner only, ordinary-user denial, Instant/Thinking, no cloud, operator downgrade and revocation');
  }finally{
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    global.fetch=nativeFetch;for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,saved);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
