'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const frame=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
async function run({duplicate=false,broken=false,change='',pending=false,missing=false,local=false}={}) {
 const dom=new JSDOM('<div id="chat-messages"></div>',{url:'https://panthorium.test',runScripts:'outside-only'}),w=dom.window;
 w.AbortSignal=AbortSignal;w.TextDecoder=TextDecoder;
 w.OS={config:{accessToken:'test',sessionId:'conversation'},state:{user:{sub:'owner',permissions:['chat']}}};
 let effects=0,fallbacks=0,doneEvents=0;const posts=[];w.addEventListener('panthorium:ai-done',()=>doneEvents++);
 w.callAI=async()=>{fallbacks++;return {text:'fallback'};};
 const envelope={id:'action-id',nonce:'a'.repeat(64),action:'open_calendar'};
 if(!missing)w.PanthoriumVoiceCommands={windowAction:async(action,context)=>{assert.equal(action,envelope.action);assert(context.signal);effects++;if(change==='during')w.OS.state.user={sub:'other',permissions:['chat']};return {ok:true,text:'เปิดแล้ว',confirmationRequired:pending};}};
 w.fetch=async(url,options)=>{
  if(url.endsWith(local?'/local/chat':'/chat/stream')) {
   assert.equal(JSON.parse(options.body).uiActionProtocol,1);if(local){assert.equal(JSON.parse(options.body).voice,true);assert.equal(JSON.parse(options.body).thinking,true);assert.equal(JSON.parse(options.body).sessionId,'local-session');}
   const frames=[frame('ui-action',envelope)];if(duplicate)frames.push(frame('ui-action',envelope));
   frames.push(frame('delta',{delta:'OK'}),frame('done',{sessionId:'returned-local-session',creditsCharged:0,billable:false}));
   let index=0;
   return {ok:true,status:200,body:{getReader:()=>({read:async()=>{if(broken&&index===1)throw new Error('lost stream');return index<frames.length?{value:new TextEncoder().encode(frames[index++]),done:false}:{done:true};}})}};
  }
  const body=JSON.parse(options.body);posts.push({url,body});assert.equal(body.nonce,envelope.nonce);
  if(url.endsWith('/claim')){if(change==='before')w.OS.state.user={sub:'other',permissions:['chat']};if(change==='session')w.dispatchEvent(new w.CustomEvent('panthorium:auth-changed'));return{ok:true,json:async()=>({ok:true,action:envelope.action})};}
  assert(url.endsWith('/acknowledge'));assert(!Object.hasOwn(body,'action'));return{ok:true,json:async()=>({ok:true})};
 };
 try {
  w.eval(fs.readFileSync(require.resolve('../ai-stream-client.js'),'utf8'));w.PanthoriumAIStream.install();
  const result=local?await w.PanthoriumAIStream.local('open calendar',{localVoice:true,thinking:true,sessionId:'local-session',emitDone:false}):await w.callAI('open calendar');
  assert.equal(fallbacks,0,'never replay prompt after a UI dispatch');if(local&&!broken){assert.equal(result.provider,'local');assert.equal(result.sessionId,'returned-local-session');assert.equal(result.creditsCharged,0);assert.equal(result.billable,false);assert.equal(doneEvents,0,'hybrid caller owns its one done event');}
  assert.equal(effects,missing||change==='before'||change==='session'?0:1);
  if(change||broken)assert.equal(result.error,'ui_action_outcome_unknown');else assert.equal(result.ok,true);
  const ack=posts.find(p=>p.url.endsWith('/acknowledge'));
  if(change)assert(!ack,'never acknowledge against another account');
  else {assert(ack);assert.equal(ack.body.result.ok,!missing);assert.equal(ack.body.result.confirmationRequired,pending);}
 } finally {w.close();}
}
(async()=>{await run();await run({duplicate:true});await run({broken:true});await run({change:'before'});await run({change:'during'});await run({change:'session'});await run({pending:true});await run({missing:true});await run({local:true});await run({local:true,broken:true});console.log('PASS chat UI client: claim before effect, duplicate suppression, pending result, account switches and no automatic replay');})().catch(e=>{console.error(e);process.exitCode=1;});
