const express=require('express');const rateLimit=require('express-rate-limit');const{requireAuth,requirePermission}=require('../middleware/auth');
function createProductionRouter(authService,intelligence){const router=express.Router(),auth=requireAuth(authService),systemRead=requirePermission('system:read'),limiter=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false});
router.get('/overview',auth,systemRead,limiter,async(req,res,next)=>{try{res.status(200).json(await intelligence.overview(Math.min(Math.max(Number(req.query.hours)||24,1),168),{persist:false}));}catch(e){next(e);}});
router.get('/history',auth,systemRead,limiter,async(req,res,next)=>{try{res.status(200).json({ok:true,items:await intelligence.history(req.query.limit)});}catch(e){next(e);}});
router.post('/snapshot',auth,systemRead,limiter,async(req,res,next)=>{try{res.status(201).json(await intelligence.overview(Math.min(Math.max(Number(req.body?.hours)||24,1),168),{persist:true}));}catch(e){next(e);}});
router.get('/readiness',auth,systemRead,limiter,async(req,res,next)=>{try{res.status(200).json(await intelligence.readiness());}catch(e){next(e);}});return router;}
module.exports={createProductionRouter};
