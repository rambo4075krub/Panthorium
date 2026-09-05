const express=require('express');const rateLimit=require('express-rate-limit');const{requireAuth,requirePermission}=require('../middleware/auth');
function createTrainingRouter(authService,training){
  const router=express.Router();const auth=requireAuth(authService);const readLimiter=rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false});const teacherLimiter=rateLimit({windowMs:60000,limit:6,standardHeaders:true,legacyHeaders:false});const admin=[auth,requirePermission('settings')];
  router.get('/status',...admin,readLimiter,async(req,res,next)=>{try{res.json(await training.list({limit:1}));}catch(error){next(error);}});
  router.get('/examples',...admin,readLimiter,async(req,res,next)=>{try{res.json(await training.list({status:req.query.status,limit:req.query.limit}));}catch(error){next(error);}});
  router.post('/examples',...admin,readLimiter,async(req,res,next)=>{try{const result=await training.addExample({...req.body,user:req.user,requestId:req.requestId});res.status(result.ok?201:400).json(result);}catch(error){next(error);}});
  router.post('/teachers/draft',...admin,teacherLimiter,async(req,res,next)=>{try{const result=await training.draftWithTeachers({prompt:req.body?.prompt,providerNames:req.body?.providers,tags:req.body?.tags,user:req.user,requestId:req.requestId});res.status(result.ok?201:result.error==='no_teacher_provider'?409:400).json(result);}catch(error){next(error);}});
  router.post('/auto/run',...admin,teacherLimiter,async(req,res,next)=>{try{const result=await training.autoProcessPending({limit:req.body?.limit});res.status(result.ok?200:409).json(result);}catch(error){next(error);}});
  router.post('/examples/:exampleId/approve',...admin,readLimiter,async(req,res,next)=>{try{const result=await training.review({exampleId:req.params.exampleId,status:'approved',user:req.user,requestId:req.requestId});res.status(result.ok?200:404).json(result);}catch(error){next(error);}});
  router.post('/examples/:exampleId/reject',...admin,readLimiter,async(req,res,next)=>{try{const result=await training.review({exampleId:req.params.exampleId,status:'rejected',user:req.user,requestId:req.requestId});res.status(result.ok?200:404).json(result);}catch(error){next(error);}});
  router.get('/export.jsonl',...admin,readLimiter,async(req,res,next)=>{try{const data=await training.exportJsonl();res.set('Content-Type','application/x-ndjson; charset=utf-8');res.set('Content-Disposition','attachment; filename="sentinel-training.jsonl"');res.send(data?`${data}\n`:'');}catch(error){next(error);}});
  return router;
}
module.exports={createTrainingRouter};
