const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { CloudNotesError } = require('../services/cloudNotesRepository');

function publicMemory(memory) {
  return { ...memory,scope:memory.scope || 'personal',provenance:memory.provenance || null,confirmation:memory.confirmation || 'unconfirmed',sensitivity:memory.sensitivity || 'standard',confidence:memory.confidence ?? 0.8,expiresAt:memory.expiresAt || null };
}
function publicResult(result) {
  return { ...result,...(result.memory ? { memory:publicMemory(result.memory) } : {}),...(Array.isArray(result.memories) ? { memories:result.memories.map(publicMemory) } : {}) };
}
function requestScope(req) {
  const query=req.query.scope;
  const body=req.body?.scope;
  // Scope selects the existing record; there is no implicit move or wildcard.
  if (query!==undefined && body!==undefined && query!==body) return null;
  return query !== undefined ? query : body !== undefined ? body : 'personal';
}
function statusFor(result, success=200) {
  return result.ok ? success : result.error==='memory_not_found' ? 404 : result.error==='memory_requires_account' ? 403 : 400;
}

function createMemoryRouter(authService, memory) {
  const router=express.Router();
  const auth=requireAuth(authService);
  const limiter=rateLimit({ windowMs:60*1000,limit:60,standardHeaders:true,legacyHeaders:false });
  router.use((req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
  router.use(auth,requirePermission('chat'),limiter);

  router.get('/',async(req,res,next)=>{
    try {
      const out=req.query.kind==='calendar-event' && req.query.limit==='10000' && requestScope(req)==='personal' && memory.calendarList ? await memory.calendarList({user:req.user}) : await memory.list({ user:req.user,limit:Number(req.query.limit) || 30,kind:req.query.kind,scope:requestScope(req) });
      res.status(statusFor(out)).json(publicResult(out));
    } catch(error) { next(error); }
  });
  router.post('/',async(req,res,next)=>{
    try {
      const { kind,title,content,tags,source,importance,confidence,expiresAt,provenance,confirmation,sensitivity }=req.body || {};
      const out=await memory.remember({ user:req.user,scope:requestScope(req),kind,title,content,tags,source,importance,confidence,expiresAt,provenance,confirmation,sensitivity,requestId:req.requestId });
      res.status(statusFor(out,201)).json(publicResult(out));
    } catch(error) { next(error); }
  });
  router.post('/search',async(req,res,next)=>{
    try {
      const { query,limit }=req.body || {};
      const out=await memory.search({ user:req.user,query,limit,scope:requestScope(req),requestId:req.requestId });
      res.status(statusFor(out)).json(publicResult(out));
    } catch(error) { next(error); }
  });
  router.post('/context',async(req,res,next)=>{
    try {
      const { query,limit }=req.body || {};
      const out=await memory.context({ user:req.user,query,limit,scope:requestScope(req),requestId:req.requestId });
      res.status(statusFor(out)).json(publicResult(out));
    } catch(error) { next(error); }
  });
  router.get('/:memoryId',async(req,res,next)=>{
    try {
      const out=await memory.get({ user:req.user,memoryId:req.params.memoryId,scope:requestScope(req) });
      res.status(statusFor(out)).json(publicResult(out));
    } catch(error) { next(error); }
  });
  router.patch('/:memoryId',async(req,res,next)=>{
    try {
      const { title,content,tags,source,importance,confidence,expiresAt,provenance,confirmation,sensitivity }=req.body || {};
      const out=await memory.update({ user:req.user,memoryId:req.params.memoryId,scope:requestScope(req),title,content,tags,source,importance,confidence,expiresAt,provenance,confirmation,sensitivity,requestId:req.requestId });
      res.status(statusFor(out)).json(publicResult(out));
    } catch(error) { next(error); }
  });
  router.delete('/:memoryId',async(req,res,next)=>{
    try {
      const out=await memory.remove({ user:req.user,memoryId:req.params.memoryId,scope:requestScope(req),requestId:req.requestId });
      res.status(statusFor(out)).json(out);
    } catch(error) { next(error); }
  });
  router.use((error,req,res,next)=>{
    if (error instanceof CloudNotesError) return res.status(error.status).json({ ok:false,error:error.code,requestId:req.requestId || null });
    return next(error);
  });
  return router;
}

module.exports = { createMemoryRouter };
