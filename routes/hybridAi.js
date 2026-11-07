'use strict';
const express=require('express');
const {localAiAllowed}=require('../services/localAiAccess');
const {accountKey}=require('../services/localWorkIdentity');
const {localEnabled,routeProviders}=require('../services/hybridAiPolicy');
const {removeThaiPoliteParticles}=require('../services/voiceStyle');
function voiceBase() {
  const u=new URL(process.env.LOCAL_VOICE_URL||'http://127.0.0.1:8765');
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('invalid_local_voice_endpoint');
  return u.origin;
}
function createHybridRouter({sentinel,auth,permission,limiter,biometrics}) {
  const r=express.Router();
  r.use(auth,permission,limiter,(req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    if(req.user.roles?.includes('guest')||String(req.user.sub).startsWith('guest:'))return res.status(403).json({ok:false,error:'account_required'});
    next();
  });
  r.get('/status',async(req,res)=>{
    const available=sentinel.providers.available();
    const ordered=await routeProviders(sentinel.providers,available,{voiceMode:true},req.user.sub);
    let local={enabled:localAiAllowed(req.user)&&localEnabled()&&!!sentinel.providers.hybrid,ready:false};
    if(local.enabled)try{const p=await fetch(voiceBase()+'/status',{headers:{'X-Panthorium-Account':accountKey(req.user.sub)},signal:AbortSignal.timeout(4000),redirect:'error'});const s=await p.json();local={...local,ready:s.ready===true,busy:s.busy===true,reason:s.reason||null,queue:s.queue||null,model:typeof s.model==='string'?s.model:null,capabilities:Array.isArray(s.capabilities)?s.capabilities:[],vision:s.vision===true,voice:s.voice||null};}catch{}
    res.json({ok:true,primary:ordered[0]||null,geminiAllowed:ordered.includes('gemini-live'),local,creditsOnly:'gemini-live'});
  });
  r.use((req,res,next)=>localAiAllowed(req.user)?next():res.status(403).json({ok:false,error:'local_access_denied'}));
  r.use((req,res,next)=>localEnabled()&&sentinel.providers.hybrid?next():res.status(503).json({ok:false,error:'local_disabled'}));
  r.post('/speech',async(req,res)=>{
    const raw=req.body?.text;
    if(typeof raw!=='string'||!raw.trim()||raw.length>1200)return res.status(400).json({ok:false,error:'invalid_speech_request'});
    const text=removeThaiPoliteParticles(raw);
    if(!text)return res.status(400).json({ok:false,error:'invalid_speech_request'});
    const controller=new AbortController();const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
    try {
      const p=await fetch(voiceBase()+'/speech',{method:'POST',headers:{'Content-Type':'application/json','X-Panthorium-Account':accountKey(req.user.sub)},body:JSON.stringify({text,voice:'th_m_1',speed:1}),redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(110000)])});
      if(!p.ok)return res.status(p.status===429?429:503).json({ok:false,error:'local_voice_busy_or_unavailable'});
      const audio=Buffer.from(await p.arrayBuffer());
      if(audio.length>8*1024*1024)throw new Error('audio_too_large');
      res.set('Content-Type','audio/wav').send(audio);
    }catch{if(!res.destroyed)res.status(503).json({ok:false,error:'local_voice_unavailable'});}finally{res.off('close',cancel);}
  });
  r.post('/transcribe',async(req,res)=>{
    const match=/^data:(audio\/[a-zA-Z0-9.+-]+(?:;codecs=[a-zA-Z0-9.,-]+)?);base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.audio||'');
    if(!match||match[2].length>1400000)return res.status(400).json({ok:false,error:'invalid_audio'});
    const audio=Buffer.from(match[2],'base64');
    if(!audio.length||audio.length>1024*1024)return res.status(413).json({ok:false,error:'audio_too_large'});
    const controller=new AbortController();const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
    try {
      // Local speech must not bypass the existing speaker-identity policy.
      if(biometrics?.gateEnabled){
        if(!(await biometrics.list(req.user.sub)).length)return res.status(403).json({ok:false,error:'voice_enrollment_required'});
        if(!(await biometrics.verify({ownerUserId:req.user.sub,audio:req.body.audio})).matched)return res.status(403).json({ok:false,error:'voice_not_authorized'});
      }
      const form=new FormData();form.append('file',new Blob([audio],{type:match[1]}),'speech.webm');
      const p=await fetch(voiceBase()+'/transcribe',{method:'POST',headers:{'X-Panthorium-Account':accountKey(req.user.sub)},body:form,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(140000)])});
      if(!p.ok)return res.status(p.status===429?429:503).json({ok:false,error:'local_voice_busy_or_unavailable'});
      const result=await p.json();res.json({ok:true,text:String(result.text||'').slice(0,2000),provider:'local',creditsCharged:0});
    }catch{if(!res.destroyed)res.status(503).json({ok:false,error:'local_transcription_unavailable'});}finally{res.off('close',cancel);}
  });
  return r;
}
module.exports={createHybridRouter,voiceBase};
