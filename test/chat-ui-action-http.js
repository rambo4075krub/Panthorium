'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {createApiRouter}=require('../routes/api');
const {ToolRegistry}=require('../services/toolRegistry');
const {AgentService}=require('../services/agentService');
const {AgentFunctionCallingService}=require('../services/agentFunctionCallingService');
(async()=>{
 let revoked=false,returned=false;
 const owner={sub:'owner',sid:'auth-session',roles:['user'],permissions:['chat']};
 const auth={verifyAccessToken:token=>token==='wrong'?{...owner,sub:'other'}:token==='session'?{...owner,sid:'other-session'}:owner,validateAccessSession:async()=>{if(revoked)throw Error('account_session_revoked');},validateAccountPrincipal:async u=>u};
 const agent=new AgentService({tools:new ToolRegistry({})}),base=new AgentFunctionCallingService({agentService:agent});
 const sentinel={providers:{},streamChat:async({functionCalling,onDelta,user,requestId})=>{
  const execution=await functionCalling.execute({user,requestId,source:'sentinel-chat',call:{name:'panthorium_window_open',args:{appId:'calendar'}}});
  returned=true;onDelta(execution.uiCompletion||'not available');return {ok:true,toolResults:[execution]};
 }};
 const app=express();app.use(express.json());app.use('/api',createApiRouter(sentinel,auth,{record(){}},null,agent,null,null,null,null,null,base));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const url='http://127.0.0.1:'+server.address().port;
 const post=(path,body,token='owner')=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
 try {
  const response=await post('/api/chat/stream',{message:'open calendar',uiActionProtocol:1});
  const reader=response.body.getReader();let text='',envelope;
  while(!envelope){const part=await reader.read();assert(!part.done);text+=new TextDecoder().decode(part.value);const frame=text.split('\n\n').find(f=>f.startsWith('event: ui-action'));if(frame)envelope=JSON.parse(frame.split('\ndata: ')[1]);}
  assert.equal(returned,false,'model response waits for effect receipt');
  const path='/api/chat/ui-actions/'+envelope.id;
  assert.equal((await post(path+'/claim',{nonce:envelope.nonce},'wrong')).status,409);
  assert.equal((await post(path+'/claim',{nonce:envelope.nonce},'session')).status,409);
  revoked=true;assert.equal((await post(path+'/claim',{nonce:envelope.nonce})).status,401);revoked=false;
  assert.equal((await post(path+'/acknowledge',{nonce:envelope.nonce,result:{ok:true}})).status,409);
  assert.equal((await post(path+'/claim',{nonce:envelope.nonce,action:'close_calendar'})).status,400);
  assert.deepEqual(await (await post(path+'/claim',{nonce:envelope.nonce})).json(),{ok:true,action:'open_calendar'});
  assert.equal((await post(path+'/claim',{nonce:envelope.nonce})).status,409);
  assert.equal(returned,false);
  assert.equal((await post(path+'/acknowledge',{nonce:envelope.nonce,result:{ok:true,text:'opened'}})).status,200);
  while(true){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}
  assert(returned);assert(text.includes('opened'));assert(text.includes('event: done'));
  assert.equal((await post(path+'/acknowledge',{nonce:envelope.nonce,result:{ok:true}})).status,409);
  returned=false;
  const old=await post('/api/chat/stream',{message:'open calendar'});const oldText=await old.text();assert(!oldText.includes('event: ui-action'));assert(oldText.includes('function_not_available'));
  console.log('PASS authenticated chat SSE: fresh session/auth, claim/receipt, no early completion and opt-in capability');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
