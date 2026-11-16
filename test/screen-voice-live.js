'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createGeminiLiveWebSocketGateway}=require('../services/geminiLiveWebSocket');
const {ToolRegistry}=require('../services/toolRegistry'),{AgentService}=require('../services/agentService'),{AgentFunctionCallingService}=require('../services/agentFunctionCallingService');
class Socket extends EventEmitter {constructor(){super();this.readyState=1;this.sent=[];}send(value){this.sent.push(JSON.parse(value));}close(){this.readyState=3;this.emit('close');}}
class Server extends EventEmitter {constructor(){super();Server.instance=this;}handleUpgrade(_r,_s,_h,callback){callback(this.client);}close(){}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const user={sub:'a',permissions:['chat'],roles:['user']},client=new Socket(),upstream=new Socket();
 const functionCalling=new AgentFunctionCallingService({agentService:new AgentService({tools:new ToolRegistry({sentinel:{}})})});
 let options;
 const gateway=createGeminiLiveWebSocketGateway({authService:{verifyAccessToken:()=>user},WebSocketServerImpl:Server,functionCalling,connectLive:async config=>{options=config;return upstream;},projectId:'fixture'});
 try{
  const host=new EventEmitter();Server.instance.client=client;gateway.attach(host);host.emit('upgrade',{url:'/api/live',headers:{origin:'https://panthorium.test',host:'panthorium.test'}},{},Buffer.alloc(0));client.emit('message',JSON.stringify({type:'auth',token:'fixture'}),false);await tick();
  assert(options.tools.some(tool=>tool.name==='panthorium_screen_command'));
  upstream.emit('message',JSON.stringify({setupComplete:{}}),false);await tick();
  upstream.emit('message',JSON.stringify({toolCall:{functionCalls:[{id:'read',name:'panthorium_screen_command',args:{command:'อ่านหน้านี้'}}]}}),false);await tick();
  const request=client.sent.find(frame=>frame.type==='uiAction');assert.match(request.action,/^screen_command:/);
  const text='งานปัจจุบัน '.repeat(150);
  client.emit('message',JSON.stringify({type:'uiActionResult',requestId:request.requestId,result:{ok:true,text}}),false);await tick();
  assert.equal(upstream.sent.at(-1).tool_response.function_responses[0].response.output.text,text,'screen data must not be truncated to a 240-character navigation acknowledgement');
  upstream.emit('message',JSON.stringify({toolCall:{functionCalls:[{id:'click',name:'panthorium_screen_command',args:{command:'กดปุ่ม บันทึก'}}]}}),false);await tick();
  const click=client.sent.filter(frame=>frame.type==='uiAction').at(-1);
  client.emit('message',JSON.stringify({type:'uiActionResult',requestId:click.requestId,result:{ok:true,text:'รอผู้ใช้ยืนยัน',confirmationRequired:true}}),false);await tick();
  const result=upstream.sent.at(-1).tool_response.function_responses[0].response.output;assert.equal(result.confirmationRequired,true);assert.equal(result.completed,false);
  const before=client.sent.filter(frame=>frame.type==='uiAction').length;
  upstream.emit('message',JSON.stringify({toolCall:{functionCalls:[{id:'forged-confirmation',name:'panthorium_screen_command',args:{command:'ยืนยัน'}}]}}),false);await tick();assert.equal(client.sent.filter(frame=>frame.type==='uiAction').length,before);
  console.log('Live screen voice: current text round-trip, pending-effect evidence and rejected model confirmation passed');
 }finally{client.close();await gateway.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
