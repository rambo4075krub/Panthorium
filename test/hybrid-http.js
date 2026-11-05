'use strict';
const assert=require('node:assert/strict'),express=require('express');
const {createHybridRouter}=require('../routes/hybridAi');
(async()=>{
 const saved={...process.env},original=global.fetch;process.env.PANTHORIUM_LOCAL_QWEN='1';
 let verify=true,upstream=0;const user={sub:'u',roles:['user']};
 const router=createHybridRouter({sentinel:{providers:{hybrid:true,available:()=>['gemini-live','local'],entitlements:{state:async()=>({remaining:{aiCredits:0}})}}},auth:(req,res,next)=>{req.user=user;next();},permission:(req,res,next)=>next(),limiter:(req,res,next)=>next(),biometrics:{gateEnabled:true,list:async()=>[{}],verify:async()=>({matched:verify})}});
 const app=express();app.use(express.json());app.use('/hybrid',router);const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 const base='http://127.0.0.1:'+s.address().port;
 global.fetch=async(url,options)=>{if(String(url).startsWith(base))return original(url,options);upstream++;return new Response(JSON.stringify({ready:true,text:'hello'}),{headers:{'content-type':'application/json'}});};
 try{
 let r=await fetch(base+'/hybrid/status');assert.equal((await r.json()).primary,'local');
 const send=()=>fetch(base+'/hybrid/transcribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audio:'data:audio/webm;base64,AQID'})});
 verify=false;const before=upstream;r=await send();assert.equal(r.status,403);assert.equal(upstream,before,'speaker denial must not reach ASR');
 verify=true;r=await send();assert.equal(r.status,200);assert.equal((await r.json()).creditsCharged,0);
 process.env.PANTHORIUM_QWEN_DISABLED='1';r=await send();assert.equal(r.status,503);
 user.roles=['guest'];r=await fetch(base+'/hybrid/status');assert.equal(r.status,403);
 console.log('Hybrid HTTP: quota status, speaker verification before ASR, zero debit, kill switch and guest denial passed');
 }finally{global.fetch=original;s.closeAllConnections();await new Promise(r=>s.close(r));for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,saved);}
})().catch(e=>{console.error(e);process.exitCode=1;});
