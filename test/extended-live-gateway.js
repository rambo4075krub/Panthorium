'use strict';
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
process.env.PANTHORIUM_GEMINI_EXTENDED='1';
require('../services/aiModePolicy').enforceAiMode();
const {createGeminiLiveWebSocketGateway}=require('../services/geminiLiveWebSocket');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function drain(){for(let i=0;i<12;i++)await tick();}
class Socket extends EventEmitter{
  constructor(){super();this.readyState=1;this.sent=[];}
  send(raw){this.sent.push(JSON.parse(String(raw)));}
  close(){if(this.readyState>=2)return;this.readyState=3;this.emit('close',1000,'test');}
}
class Server extends EventEmitter{constructor(){super();Server.instance=this;}handleUpgrade(req,s,h,fn){fn(this.client);}close(){}}
async function main(){
  assert.equal(process.env.PANTHORIUM_HYBRID_AI,'0');assert.equal(process.env.PANTHORIUM_LOCAL_QWEN,'0');
  const {ProviderManager}=require('../services/providerManager');const providers=new ProviderManager();assert.deepEqual(providers.available(),['gemini-live']);assert(!providers.vertexPublisherConfigured());
  const client=new Socket(),upstream=new Socket(),log=[];
  const meter={start:async()=>{log.push('reserve');return{maxOutputTokens:1024,thinkingLevel:'MEDIUM'};},input:async frame=>{log.push(frame.tool_response?'tool-input':'user-input');},output:async frame=>{if(frame.usageMetadata)log.push('usage:'+frame.usageMetadata.promptTokenCount);},close:async()=>log.push('settled')};
  const gateway=createGeminiLiveWebSocketGateway({WebSocketServerImpl:Server,authService:{verifyAccessToken:()=>({sub:'account',permissions:['chat']})},entitlements:{state:async()=>({plan:'life',remaining:{aiCredits:750000},unlimited:[]})},meterFactory:()=>meter,
    functionCalling:{declarationsFor:()=>[{name:'probe'}],execute:async({call})=>({ok:true,functionResponse:{id:call.id,name:call.name,response:{number:4}}})},
    connectLive:async()=>{assert(log.includes('reserve'));log.push('connect');return upstream;}});
  Server.instance.client=client;const server=new EventEmitter();gateway.attach(server);
  server.emit('upgrade',{url:'/api/live',headers:{origin:'https://panthorium.test',host:'panthorium.test'}},{},Buffer.alloc(0));
  client.emit('message',JSON.stringify({type:'auth',token:'valid'}),false);await drain();
  upstream.emit('message',JSON.stringify({setupComplete:{}}));await drain();
  client.emit('message',JSON.stringify({realtimeInput:{text:'hello'}}),false);await drain();
  assert(log.includes('user-input'));assert(upstream.sent.some(frame=>frame.realtimeInput));
  upstream.emit('message',JSON.stringify({usageMetadata:{promptTokenCount:1},serverContent:{turnComplete:true,interactionStatus:'IN_PROGRESS'}}));
  upstream.emit('message',JSON.stringify({toolCall:{functionCalls:[{id:'tool-1',name:'probe',args:{}}]}}));await drain();
  assert(log.includes('tool-input'));assert(upstream.sent.some(frame=>frame.tool_response));
  assert(!client.sent.some(frame=>frame.event==='turn.completed'));
  upstream.emit('message',JSON.stringify({usageMetadata:{promptTokenCount:2},serverContent:{turnComplete:true,interactionStatus:'IDLE'}}));await drain();
  assert(client.sent.some(frame=>frame.event==='turn.completed'));
  // Final usage can arrive during the upstream closing handshake after the
  // browser has left. It must be recorded before refunding any unused hold.
  upstream.close=()=>{upstream.readyState=2;setImmediate(()=>{upstream.emit('message',JSON.stringify({usageMetadata:{promptTokenCount:3}}));upstream.readyState=3;upstream.emit('close',1000,'done');});};
  client.close();await drain();assert(log.indexOf('usage:3')<log.indexOf('settled'));assert(log.includes('usage:3'));assert.equal(log.filter(x=>x==='settled').length,1);
  gateway.close();console.log('Extended gateway: only configured model, pre-dispatch holds, asynchronous tools, IDLE completion and disconnect usage drain passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
