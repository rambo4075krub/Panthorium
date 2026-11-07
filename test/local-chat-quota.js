'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {createApiRouter}=require('../routes/api');
const {creditCost}=require('../billing-catalog');
async function main(){
 const saved={profile:process.env.PANTHORIUM_LOCAL_PROFILE,hybrid:process.env.PANTHORIUM_LOCAL_QWEN};
 process.env.PANTHORIUM_LOCAL_PROFILE='1';delete process.env.PANTHORIUM_LOCAL_QWEN;
 let remaining=100,calls=0,usage={prompt_tokens:10,completion_tokens:5};
 const entitlements={state:async()=>({remaining:{aiCredits:remaining}}),consume:async(user,amounts)=>{assert.equal(user,'123e4567-e89b-42d3-a456-426614174000');const cost=creditCost(amounts);if(cost>remaining)throw new Error('quota_exceeded:aiCredits');remaining-=cost;}};
 const sentinel={providers:{entitlements,callDetailed:async()=>{calls++;return {text:'answer',usage};}}};
 const user={sub:'123e4567-e89b-42d3-a456-426614174000',roles:['administrator'],permissions:['chat']};
 const auth={verifyAccessToken:()=>user};
 const app=express();app.use(express.json());app.use('/api',createApiRouter(sentinel,auth,{record(){}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const send=()=>fetch('http://127.0.0.1:'+server.address().port+'/api/local/chat',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({message:'hello'})});
  let r=await send();assert.equal(r.status,200);assert.equal((await r.json()).text,'answer');assert.equal(remaining,100,'Qwen must never debit credits');
  remaining=0;r=await send();assert.equal(r.status,200);assert.equal(calls,2,'Qwen works after Gemini credits are exhausted');
  assert.equal((await r.json()).creditsCharged,0);
  remaining=5;r=await send();assert.equal(r.status,200);assert.equal(remaining,5);
  remaining=100;usage=null;r=await send();assert.equal(r.status,200);assert.equal(remaining,100,'local token telemetry is not a billing dependency');
  const before=calls;user.roles=['user'];r=await send();assert.equal(r.status,403);assert.equal(calls,before);
  user.email='rambo4075krub@gmail.com';r=await send();assert.equal(r.status,403,'unverified address cannot unlock local AI');
  user.emailVerifiedAt=new Date().toISOString();r=await send();assert.equal(r.status,200,'verified owner email is allowed without admin role');
  user.email='another@example.com';r=await send();assert.equal(r.status,403,'changing owner email revokes local access');
  console.log('Local AI HTTP: zero credit debit, exhausted Gemini quota fallback, no usage billing dependency passed');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const [key,value] of [['PANTHORIUM_LOCAL_PROFILE',saved.profile],['PANTHORIUM_LOCAL_QWEN',saved.hybrid]])value===undefined?delete process.env[key]:process.env[key]=value;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
