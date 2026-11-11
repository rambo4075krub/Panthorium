'use strict';
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { ConcurrencyGate } = require('../services/concurrencyGate');
const { WorkloadCapacity, SharedCapacityGate, policies } = require('../services/workloadCapacity');
const { AiGateway } = require('../services/aiGateway');
const { ProviderManager } = require('../services/providerManager');
const { createCloudAppCompletion } = require('../services/cloudAppCompletion');
const { runProcess } = require('../services/mediaStudioService');
const { EventEmitter } = require('node:events');
const { createGeminiLiveWebSocketGateway } = require('../services/geminiLiveWebSocket');

async function main() {
  const gate = new ConcurrencyGate({limit:2,maxQueue:2,perUserLimit:1,maxQueuedPerUser:1,queueTimeoutMs:30});
  const a = await gate.acquire({userId:'a'});
  const controller = new AbortController(); let executed = false;
  const cancelled = gate.run(()=>{executed=true;},{userId:'a',signal:controller.signal});
  const cancelledCheck = assert.rejects(cancelled,/stop/);
  const b = await gate.acquire({userId:'b'});
  assert.equal(gate.stats().active,2,'one account waiting cannot block another account');
  controller.abort(new Error('stop')); await cancelledCheck;
  assert.equal(gate.stats().queued,0);assert.equal(executed,false);
  a();a();assert.equal(gate.stats().active,1,'release is idempotent');b();
  const hold=await gate.acquire({userId:'a'});
  await assert.rejects(gate.acquire({userId:'a'}),/system_busy/);hold();
  assert.equal(gate.stats().active,0);

  assert.throws(()=>policies('{"text":{"limit":0}}'));
  assert.throws(()=>policies('{"typo":{"limit":2}}'));
  assert.throws(()=>policies('{"text":{"maxQueue":9999}}'));
  await assert.rejects(new WorkloadCapacity({required:true,env:{}}).init(),/capacity_database_required/);
  const capacity=new WorkloadCapacity({env:{PANTHORIUM_CAPACITY_LIMITS:JSON.stringify({text:{limit:1,perUserLimit:1,maxQueue:0,maxQueuedPerUser:0},background:{limit:1,maxQueue:0,maxQueuedPerUser:0},image:{limit:1,maxQueue:0,maxQueuedPerUser:0}})}});
  await capacity.init();
  const images=await capacity.gate('image').acquire({userId:'artist'});
  const background=await capacity.gate('background').acquire({userId:'writer'});
  const calls=[];
  const providers={available:()=>['local','gemini-live'],authorizeLocal:async()=>true,hybrid:false,
    callDetailed:async provider=>{calls.push([provider,capacity.gate(provider==='local'?'local':'text').stats().active]);if(provider==='local')throw new Error('transport');return{text:'answer'};}};
  const gateway=new AiGateway({providers,capacity});
  const reply=await gateway.complete({userId:'reader',systemPrompt:'',history:[]});
  assert.equal(reply.ok,true);assert.deepEqual(calls,[['local',1],['gemini-live',1]],'fallback acquires the destination lane');
  calls.length=0;
  const busy=await gateway.complete({userId:'reader',preferredProvider:'gemini-live',history:[],workload:'background'});
  assert.equal(busy.error,'system_busy');assert.deepEqual(calls,[],'overload does not invoke or fall back to a paid provider');
  assert.equal(gateway.circuitBreaker.state('gemini-live').failures,0,'capacity refusal is not provider failure');
  images();background();
  const text=await capacity.gate('text').acquire({userId:'reader'});
  let cloudCalls=0;
  const cloud=createCloudAppCompletion({gate:capacity.gate('background'),textOutputEnabled:true,complete:async()=>{cloudCalls++;return{text:'draft'};}});
  await cloud({user:{sub:'writer'},systemPrompt:'',messages:[]});assert.equal(cloudCalls,1);text();

  // Lease loss must reach the actual provider callback, including with no
  // caller cancellation signal. No plaintext prompt is stored by the gate.
  let released=0;
  const repo={leaseMs:45,poll:async()=> 'active',renew:async()=>false,release:async()=>{released++;}};
  const shared=new SharedCapacityGate({repository:repo,name:'text',policy:policies().text,pollMs:1});
  await assert.rejects(shared.run(signal=>delay(200,null,{signal}),{userId:'u'}),/capacity_lease_lost/);
  assert.equal(released,1);assert.equal(shared.stats().active,0);
  const slowRepo={...repo,renew:async()=>new Promise(()=>{})};
  const slow=new SharedCapacityGate({repository:slowRepo,name:'text',policy:policies().text});
  await assert.rejects(slow.run(signal=>delay(200,null,{signal}),{userId:'u'}),/capacity_lease_lost/);
  assert.equal(slow.stats().active,0,'a hung heartbeat cannot hold work beyond its lease');

  // Verify real fetch receives cancellation, rather than just checking source.
  const priorFetch=global.fetch;
  try {
    global.fetch=async(_url,{signal})=>{await delay(1000,null,{signal});throw new Error('should_abort');};
    const manager=Object.create(ProviderManager.prototype),abort=new AbortController();
    const request=manager.callOpenAICompatible('https://example.test','synthetic','synthetic','',[],{signal:abort.signal});
    const check=assert.rejects(request,/aborted/);abort.abort();await check;
  } finally { global.fetch=priorFetch; }
  const stop=new AbortController();
  const processTask=runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:stop.signal});
  const processCheck=assert.rejects(processTask,/cancel_encoder/);
  stop.abort(new Error('cancel_encoder'));await processCheck;
  // Real gateway lifecycle with synthetic sockets: no upstream on overload,
  // global lease loss closes voice, and a late connection cannot leak.
  class Socket extends EventEmitter {
    constructor(){super();this.readyState=1;}
    send(){}
    close(){this.readyState=3;this.emit('close');}
  }
  class WSS extends EventEmitter {
    constructor(){super();WSS.latest=this;}
    handleUpgrade(_req,_socket,_head,done){done(this.client);}
    close(){}
  }
  async function open(capacityGate,connectLive) {
    const gateway=createGeminiLiveWebSocketGateway({authService:{verifyAccessToken:()=>({sub:'voice-user',permissions:['chat']})},WebSocketServerImpl:WSS,capacityGate,connectLive});
    const client=new Socket(),server=new EventEmitter();WSS.latest.client=client;gateway.attach(server);
    server.emit('upgrade',{url:'/api/live',headers:{origin:'https://panthorium.test',host:'panthorium.test'}},{},Buffer.alloc(0));
    client.emit('message',JSON.stringify({type:'auth',token:'synthetic'}),false);
    await new Promise(resolve=>setImmediate(resolve));
    return client;
  }
  let connected=0;
  const refused=await open({acquire:async()=>{throw new Error('system_busy');}},async()=>{connected++;return new Socket();});
  assert.equal(refused.readyState,3);assert.equal(connected,0);
  const voiceAbort=new AbortController();let voiceRelease=0,finishConnect;
  const permit=async()=>{voiceRelease++;};permit.signal=voiceAbort.signal;
  const voiceClient=await open({acquire:async()=>permit},()=>new Promise(resolve=>{finishConnect=resolve;}));
  voiceAbort.abort();assert.equal(voiceClient.readyState,3);assert.equal(voiceRelease,1);
  const lateSocket=new Socket();finishConnect(lateSocket);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lateSocket.readyState,3,'upstream finishing after disconnect is closed');
  const app=require('express')();
  app.use('/api/production',require('../routes/production').createProductionRouter({verifyAccessToken:token=>({sub:'private-account',permissions:token==='admin'?['system:read']:['chat']})},{gateway:{capacity}}));
  const httpServer=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  try {
    const url='http://127.0.0.1:'+httpServer.address().port+'/api/production/capacity';
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer user'}})).status,403);
    const response=await fetch(url,{headers:{Authorization:'Bearer admin'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const metrics=await response.text();assert.equal(metrics.includes('private-account'),false);assert.equal(JSON.parse(metrics).lanes.length,6);
  } finally {await new Promise(resolve=>httpServer.close(resolve));}
  console.log('Workload capacity: cancellation, fairness, lane isolation, destination admission, lease loss and encoder shutdown passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
