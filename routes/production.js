const express=require('express');
const rateLimit=require('express-rate-limit');
const{requireAuth,requirePermission}=require('../middleware/auth');

function createProductionRouter(authService,intelligence){
  const router=express.Router();
  const auth=requireAuth(authService);
  const systemRead=requirePermission('system:read');
  const limiter=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false});

  router.get('/overview',auth,systemRead,limiter,async(req,res,next)=>{
    try{
      const hours=Math.min(Math.max(Number(req.query.hours)||24,1),168);
      const result=await intelligence.overview(hours,{persist:false});
      res.status(200).json(result);
    }catch(error){next(error);}
  });

  router.post('/snapshot',auth,systemRead,limiter,async(req,res,next)=>{
    try{
      const hours=Math.min(Math.max(Number(req.body?.hours)||24,1),168);
      const result=await intelligence.overview(hours,{persist:true});
      res.status(201).json(result);
    }catch(error){next(error);}
  });

  router.get('/readiness',auth,systemRead,limiter,async(req,res,next)=>{
    try{res.status(200).json(await intelligence.readiness());}catch(error){next(error);}
  });

  return router;
}

module.exports={createProductionRouter};