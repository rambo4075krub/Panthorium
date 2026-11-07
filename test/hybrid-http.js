'use strict';
const assert=require('node:assert/strict'),express=require('express');
const {createHybridRouter}=require('../routes/hybridAi');
(async()=>{
 const saved={...process.env},original=global.fetch;process.env.PANTHORIUM_LOCAL_QWEN='1';
 let verify=true,upstream=0,lastSpeech;const user={sub:'u',roles:['administrator'],permissions:['chat']};
 const router=createHybridRouter({sentinel:{providers:{authorizeLocal:async()=>require('../services/localAiAccess').localAiAllowed(user),hybrid:true,available:()=>['gemini-live','local'],entitlements:{state:async()=>({remaining:{aiCredits:0}})}}},auth:(req,res,next)=>{req.user=user;next();},permission:(req,res,next)=>next(),limiter:(req,res,next)=>next(),biometrics:{gateEnabled:true,list:async()=>[{}],verify:async()=>({matched:verify})}});
 const app=express();app.use(express.json());app.use('/hybrid',router);const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 const base='http://127.0.0.1:'+s.address().port;
 global.fetch=async(url,options)=>{if(String(url).startsWith(base))return original(url,options);upstream++;if(String(url).endsWith('/speech')){lastSpeech=JSON.parse(options.body).text;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/wav'}});}return new Response(JSON.stringify({ready:false,reason:'ram_headroom',ramUsedFraction:.625,ramLimit:.65,ramTotalBytes:16*1024**3,ramRequiredAdditionalBytes:6.5*1024**3,ramShortfallBytes:Math.ceil(6.1*1024**3),text:'hello'}),{headers:{'content-type':'application/json'}});};
 try{
 let r=await fetch(base+'/hybrid/status');const policy=await r.json();assert.equal(policy.primary,'local');assert.equal(policy.local.resources.ramTotalBytes,16*1024**3);assert.match(policy.local.message,/6\.1 GiB/);
 const speak=text=>fetch(base+'/hybrid/speech',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
 r=await speak('ดำเนินการเรียบร้อยแล้วนะครับ');assert.equal(r.status,200);assert.equal(lastSpeech,'ดำเนินการเรียบร้อยแล้ว');
 const speechCalls=upstream;r=await speak('ครับ');assert.equal(r.status,400);assert.equal(upstream,speechCalls);
 const send=()=>fetch(base+'/hybrid/transcribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audio:'data:audio/webm;base64,AQID'})});
 verify=false;const before=upstream;r=await send();assert.equal(r.status,403);assert.equal(upstream,before,'speaker denial must not reach ASR');
 verify=true;r=await send();assert.equal(r.status,200);assert.equal((await r.json()).creditsCharged,0);
 user.roles=['user'];const forbiddenStart=upstream;r=await fetch(base+'/hybrid/status');const deniedPolicy=await r.json();assert.equal(deniedPolicy.local.enabled,false);assert.equal(deniedPolicy.primary,null);assert.equal(deniedPolicy.local.resources,undefined);assert.equal(deniedPolicy.local.message,undefined);assert.equal(upstream,forbiddenStart,'regular accounts cannot query local resource status');
 r=await speak('test');assert.equal(r.status,403);r=await send();assert.equal(r.status,403);assert.equal(upstream,forbiddenStart);
 user.email='rambo4075krub@gmail.com';user.emailVerifiedAt=new Date().toISOString();r=await send();assert.equal(r.status,200,'verified owner can use local voice');
 process.env.PANTHORIUM_QWEN_DISABLED='1';r=await send();assert.equal(r.status,503);
 user.roles=['guest'];r=await fetch(base+'/hybrid/status');assert.equal(r.status,403);
 console.log('Hybrid HTTP: quota status, speaker verification before ASR, zero debit, kill switch and guest denial passed');
 }finally{global.fetch=original;s.closeAllConnections();await new Promise(r=>s.close(r));for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,saved);}
})().catch(e=>{console.error(e);process.exitCode=1;});
