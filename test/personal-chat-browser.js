'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const express=require('express');
const {chromium}=require('playwright');
const {RemoteWorkspaceService}=require('../services/remoteWorkspaceService');
const {createRemoteWorkspaceRouter}=require('../routes/remoteWorkspace');
(async()=>{
  const users={a:{sub:randomUUID(),roles:['user'],permissions:['chat']},b:{sub:randomUUID(),roles:['user'],permissions:['chat']}},calls=[];
  let cap=1000000;
  const service=new RemoteWorkspaceService({secret:'personal-chat-browser-fixture-secret',entitlements:{state:async()=>({plan:'fixture',remaining:{storageBytes:cap}})}});
  const app=express();app.use(express.json({limit:'2mb'}));
  app.use('/api/remote',createRemoteWorkspaceRouter({verifyAccessToken:token=>{if(!users[token])throw Error('unauthorized');return users[token];}},service));
  for(const file of ['personal-chat-ui.js','personal-chat-ui.css'])app.get('/'+file,(req,res)=>res.sendFile(path.join(__dirname,'..',file)));
  app.post('/fixture/chat',(req,res)=>{calls.push({user:req.headers.authorization,...req.body});res.json({ok:true,text:'คำตอบ '+req.body.message});});
  app.get('/',(req,res)=>res.type('html').send(`<!doctype html><html lang="th"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/personal-chat-ui.css"><style>body{margin:0;background:#07101e;color:#e5f4ff;font:14px Arial}*{box-sizing:border-box}.chat-container{display:flex;flex-direction:column;height:95svh;max-width:800px;margin:auto;border:1px solid #6688aa33}.chat-messages{flex:1;overflow:auto;padding:15px}.msg{padding:12px;margin:5px;background:#14253c;border-radius:8px;white-space:pre-wrap}.msg.user{background:#16414a}#compose{display:flex;padding:10px;gap:8px}#chat-input{flex:1;min-width:0;font:inherit;padding:10px}button{font:inherit}</style><div class="chat-container"><div id="chat-messages" class="chat-messages"></div><div id="compose"><input id="chat-input"><button id="chat-send">ส่ง</button></div></div><script>
    const fixtureUsers=${JSON.stringify(users)};let fixtureToken='a';const OS={state:{user:fixtureUsers.a},config:{sessionId:'old',accessToken:'a'}};
    window.PanthoriumAuth={ensureSession:async()=>true,getAccessToken:()=>fixtureToken,getBackendUrl:()=>''};
    window.toast=()=>{};window.PanthoriumVoiceCommands={execute:async text=>({ok:true,text:'คำสั่ง '+text})};
    async function callAI(message){return(await fetch('/fixture/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:fixtureToken},body:JSON.stringify({message,sessionId:OS.config.sessionId,clientHistory:window.PanthoriumChats?.requestHistory()})})).json();}
    document.getElementById('chat-send').onclick=async()=>{const input=document.getElementById('chat-input');const text=input.value;input.value='';const r=await callAI(text);window.lastResult=r;for(const [kind,value] of [['user',text],['ai',r.text]]){const e=document.createElement('div');e.className='msg '+kind;e.textContent=value;document.getElementById('chat-messages').append(e);}};
    window.switchAccount=token=>{fixtureToken=token;OS.state.user=fixtureUsers[token];OS.config.accessToken=token;window.dispatchEvent(new Event('panthorium:auth-changed'));};
    </script><script src="/personal-chat-ui.js"></script></html>`));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.personal-quota');
    await page.fill('#chat-input','รายงานส่วนตัวบัญชี A');await page.click('#chat-send');await page.waitForFunction(()=>window.lastResult?.ok===true);
    assert.equal(calls.length,1);assert.match(calls[0].sessionId,/^personal-/);assert.deepEqual(calls[0].clientHistory,[]);
    await page.evaluate(()=>window.PanthoriumChats.recordVoice('คำสั่งเสียงของ A','ผลจากเสียงของ A'));
    await page.evaluate(()=>callAI('ทำต่อจากเสียง'));assert(calls.at(-1).clientHistory.some(m=>m.content==='คำสั่งเสียงของ A'));
    await page.reload();await page.waitForFunction(()=>document.getElementById('chat-messages').textContent.includes('ผลจากเสียงของ A'));
    await page.getByRole('button',{name:'รายการแชท',exact:true}).click();await page.waitForSelector('.personal-thread');assert((await page.locator('.personal-thread-title').first().textContent()).includes('รายงานส่วนตัวบัญชี A'));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile controls must fit the viewport');
    if(process.env.PERSONAL_CHAT_SCREENSHOT)await page.screenshot({path:process.env.PERSONAL_CHAT_SCREENSHOT});
    await page.evaluate(()=>window.switchAccount('b'));await page.waitForFunction(()=>!document.getElementById('chat-messages').textContent.includes('บัญชี A'));await page.waitForTimeout(200);
    await page.evaluate(()=>callAI('ข้อมูลเฉพาะบัญชี B'));assert.equal(calls.at(-1).user,'b');assert.deepEqual(calls.at(-1).clientHistory,[]);
    await page.getByRole('button',{name:'รายการแชท',exact:true}).click();assert(!(await page.locator('.personal-history-list').textContent()).includes('บัญชี A'));
    cap=1500;const before=calls.length;const full=await page.evaluate(()=>callAI('ท'.repeat(2000)));assert.equal(full.ok,false);assert.equal(calls.length,before,'full storage blocks a new billable request before sending');assert.match(full.error,/personal_storage_full/);
    cap=1000000;await page.evaluate(()=>window.switchAccount('a'));await page.waitForTimeout(250);await page.getByRole('button',{name:'อุปกรณ์ของฉัน',exact:true}).click();await page.waitForSelector('dialog[open]');assert((await page.locator('dialog').textContent()).includes('ไฟล์งานและความจำเก็บในพื้นที่ของคุณ'));await page.getByRole('button',{name:'ปิด',exact:true}).click();
    assert.deepEqual(errors,[]);assert(!(JSON.stringify(await service.threads(users.a))).includes('ผลจากเสียงของ A'),'server index must not contain transcript text');
    console.log('PASS personal chat browser: real IndexedDB, typed and voice history, reload, account switching, mobile layout, quota preflight, devices dialog');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
