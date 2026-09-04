const express=require('express');
const rateLimit=require('express-rate-limit');
const{requireAuth,requirePermission}=require('../middleware/auth');
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createIntegrationsRouter(authService,integrations){const router=express.Router();const auth=requireAuth(authService);const settings=requirePermission('settings');const limiter=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false});
 router.get('/',auth,settings,limiter,async(req,res,next)=>{try{const r=await integrations.list(req.user,Number(req.query.limit)||50);res.status(r.ok?200:403).json(r);}catch(e){next(e);}});
 router.get('/history',auth,settings,limiter,async(req,res,next)=>{try{const integrationId=req.query.integrationId?String(req.query.integrationId):null;if(integrationId&&!UUID_RE.test(integrationId))return res.status(400).json({ok:false,error:'invalid_integration_id'});const r=await integrations.history(req.user,{integrationId,limit:Number(req.query.limit)||50});res.status(r.ok?200:403).json(r);}catch(e){next(e);}});
 router.post('/',auth,settings,limiter,async(req,res,next)=>{try{const{name,endpointUrl,secretEnvKey}=req.body||{};const r=await integrations.create({user:req.user,name,endpointUrl,secretEnvKey});res.status(r.ok?201:r.error==='integration_settings_required'?403:400).json(r);}catch(e){next(e);}});
 router.post('/:integrationId/enabled',auth,settings,limiter,async(req,res,next)=>{try{if(!UUID_RE.test(req.params.integrationId))return res.status(400).json({ok:false,error:'invalid_integration_id'});if(typeof req.body?.enabled!=='boolean')return res.status(400).json({ok:false,error:'invalid_enabled'});const r=await integrations.setEnabled({user:req.user,integrationId:req.params.integrationId,enabled:req.body.enabled});res.status(r.ok?200:r.error==='integration_not_found'?404:403).json(r);}catch(e){next(e);}});
 router.delete('/:integrationId',auth,settings,limiter,async(req,res,next)=>{try{if(!UUID_RE.test(req.params.integrationId))return res.status(400).json({ok:false,error:'invalid_integration_id'});const r=await integrations.remove({user:req.user,integrationId:req.params.integrationId});res.status(r.ok?200:r.error==='integration_not_found'?404:403).json(r);}catch(e){next(e);}});
 return router;}
module.exports={createIntegrationsRouter,UUID_RE};
