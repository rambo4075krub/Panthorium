'use strict';
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {connectGeminiLive} = require('../services/geminiLiveVertex');
const {createGeminiLiveWebSocketGateway} = require('../services/geminiLiveWebSocket');
const {AiGateway} = require('../services/aiGateway');
const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve}; };

class Socket extends EventEmitter {
  constructor() { super();this.readyState=1;this.sent=[];this.pings=0;this.pong=true; }
  send(value) { this.sent.push(value); }
  close(code,reason) { if(this.readyState===3)return;this.closeInfo={code,reason};this.readyState=3;this.emit('close',code,reason); }
  terminate() { this.terminated=true;this.close(1006,'network_lost'); }
  ping() { this.pings++;if(this.pong)queueMicrotask(()=>this.emit('pong')); }
}
class Server extends EventEmitter {
  constructor() { super();Server.instance=this; }
  close() {}
}
function startGateway(extra={}) {
  let releases=0;
  const gateway=createGeminiLiveWebSocketGateway({
    authService:{verifyAccessToken:()=>({sub:'stability-account',permissions:['chat']})},
    WebSocketServerImpl:Server,
    capacityGate:{acquire:async()=>()=>{releases++;}},
    startupTimeoutMs:50,heartbeatIntervalMs:1000,...extra
  });
  const server=Server.instance;
  const connect=()=>{const client=new Socket();server.emit('connection',client);client.emit('message',JSON.stringify({type:'auth',token:'test'}),false);return client;};
  return {gateway,connect,releases:()=>releases};
}

async function connectionDeadlines() {
  const token=deferred();let created=0;
  class NeverCreated { constructor(){created++;} }
  await assert.rejects(connectGeminiLive({projectId:'panthorium-staging',authClient:{getAccessToken:()=>token.promise},WebSocketImpl:NeverCreated,connectionTimeoutMs:20}),/connection_timeout/);
  token.resolve({token:'late-fixture-token'});await tick();assert.equal(created,0,'timed-out credentials must not create a late provider connection');
  const cancelled=deferred(),abort=new AbortController();
  const pending=connectGeminiLive({projectId:'panthorium-staging',authClient:{getAccessToken:()=>cancelled.promise},WebSocketImpl:NeverCreated,signal:abort.signal});
  abort.abort();await assert.rejects(pending,/connection_aborted/);cancelled.resolve({token:'late-fixture-token'});await tick();assert.equal(created,0);
  class ClosesBeforeOpen extends Socket { constructor(){super();this.readyState=0;queueMicrotask(()=>this.close(1006,'network'));} }
  await assert.rejects(connectGeminiLive({projectId:'panthorium-staging',authClient:{getAccessToken:async()=>({token:'fixture'})},WebSocketImpl:ClosesBeforeOpen}),/closed_before_open/);
  class StalledHandshake extends Socket { constructor(){super();this.readyState=0;StalledHandshake.instance=this;} }
  await assert.rejects(connectGeminiLive({projectId:'panthorium-staging',authClient:{getAccessToken:async()=>({token:'fixture'})},WebSocketImpl:StalledHandshake,connectionTimeoutMs:20}),/connection_timeout/);
  assert.equal(StalledHandshake.instance.terminated,true);
  await assert.rejects(connectGeminiLive({projectId:'panthorium-staging',responseModality:'invalid',authClient:{getAccessToken:async()=>({token:'fixture'})},WebSocketImpl:NeverCreated}),/modality_unsupported/);
  assert.equal(created,0,'invalid setup must fail before opening a socket');
}
async function gatewayRecovery() {
  const late=deferred();let connectionSignal;
  const blocked=startGateway({connectLive:options=>{connectionSignal=options.signal;return late.promise;}});
  const client=blocked.connect();await wait(85);
  assert.equal(client.closeInfo.reason,'live_startup_timeout');assert.equal(blocked.releases(),1);assert.equal(blocked.gateway.activeSessions(),0);assert.equal(connectionSignal.aborted,true);
  const abandoned=new Socket();late.resolve(abandoned);await tick();assert.equal(abandoned.readyState,3);assert.equal(blocked.releases(),1);blocked.gateway.close();

  const context=deferred();let upstreamCalls=0;
  const delayed=startGateway({contextProvider:()=>context.promise,connectLive:async()=>{upstreamCalls++;return new Socket();}});
  delayed.connect();await wait(85);context.resolve(null);await tick();assert.equal(upstreamCalls,0,'a late context lookup cannot start a provider after timeout');assert.equal(delayed.releases(),1);delayed.gateway.close();

  let upstream;
  const live=startGateway({startupTimeoutMs:200,heartbeatIntervalMs:15,connectLive:async()=>{upstream=new Socket();return upstream;}});
  const healthy=live.connect();await tick();upstream.emit('message',JSON.stringify({setupComplete:{}}),false);
  await wait(65);assert.equal(healthy.readyState,1);assert(healthy.pings>=2);assert.equal(live.releases(),0);
  healthy.pong=false;await wait(50);
  assert.equal(healthy.terminated,true);assert.equal(upstream.readyState,3);assert.equal(live.gateway.activeSessions(),0);assert.equal(live.releases(),1);
  const replacement=live.connect();await tick();upstream.emit('message',JSON.stringify({setupComplete:{}}),false);
  assert.equal(live.gateway.activeSessions(),1,'the disconnected account can connect again');replacement.close();live.gateway.close();assert.equal(live.releases(),2);
}
async function localRequestIsolation() {
  let failure='local_llm_truncated',calls=0;
  const complete=async()=>{calls++;if(failure)throw new Error(failure);return {text:'ready',model:'local'};};
  const gateway=new AiGateway({providers:{localOnly:true,available:()=>['local'],authorizeLocal:async()=>true,callDetailed:complete,streamDetailed:complete}});
  const input={userId:'admin-fixture',systemPrompt:'brief',history:[{role:'user',content:'test'}],preferredProvider:'local'};
  for(let i=0;i<4;i++){const r=await gateway.complete(input);assert.equal(r.error,'local_llm_truncated');assert.equal(r.creditsCharged,0);assert.equal(r.provider,'local');}
  failure='local_context_too_large';assert.equal((await gateway.stream(input)).error,failure);
  assert.equal(gateway.circuitBreaker.snapshot('local').state,'closed','request size failures must not take Qwen offline for all administrators');
  failure=null;assert.equal((await gateway.complete(input)).text,'ready');assert.equal(calls,6);
  failure='local_llm_http_500';for(let i=0;i<3;i++)await gateway.complete(input);
  assert.equal(gateway.circuitBreaker.snapshot('local').state,'open','real provider failures still activate the circuit breaker');
}
(async()=>{
  const saved={...process.env};
  try {
    process.env.PANTHORIUM_AI_MODE='gemini-live-only';process.env.GEMINI_LIVE_ENABLED='1';
    await connectionDeadlines();await gatewayRecovery();await localRequestIsolation();
    console.log('AI stability: bounded auth/connect, abandoned-session cleanup, heartbeat recovery and isolated Qwen request failures passed');
  } finally {for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,saved);}
})().catch(error=>{console.error(error);process.exitCode=1;});
