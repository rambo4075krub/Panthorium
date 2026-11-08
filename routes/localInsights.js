'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const {requireAuth,requirePermission}=require('../middleware/auth');
const {canUseLocal}=require('../services/localAiAccess');
const {UUID,FEATURES}=require('../services/localInsightsService');
const {failure}=require('../services/notificationRepository');
function createLocalInsightsRouter(auth,service) {
  const router=express.Router();
  router.use(requireAuth(auth),requirePermission('chat'));
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!UUID.test(req.user?.sub||'') || req.user.roles?.includes('guest')) return res.status(403).json({ok:false,error:'account_required'});
    next();
  });
  router.use(rateLimit({windowMs:60000,limit:40,standardHeaders:true,legacyHeaders:false}));
  const wrap=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){if(e.status)res.status(e.status).json({ok:false,error:e.code||e.message});else next(e);}};
  router.get('/me',wrap(async req=>({ok:true,...await service.repository.preferences(req.user.sub),features:FEATURES,operator:await canUseLocal(service.providers,req.user.sub)})));
  router.put('/preferences',wrap(async req=>{
    if(Object.keys(req.body||{}).length!==1 || typeof req.body.enabled!=='boolean') throw failure('invalid_insights_preferences');
    await service.repository.setConsent(req.user.sub,req.body.enabled);
    return {ok:true,...await service.repository.preferences(req.user.sub)};
  }));
  router.delete('/me',wrap(async req=>{await service.repository.setConsent(req.user.sub,false);return {ok:true};}));
  router.get('/operator',wrap(async req=>({ok:true,...await service.overview(req.user.sub)})));
  router.put('/control',wrap(async req=>{
    if(Object.keys(req.body||{}).length!==1 || typeof req.body.enabled!=='boolean') throw failure('invalid_insights_control');
    await service.setEnabled(req.user.sub,req.body.enabled);return {ok:true};
  }));
  router.post('/analyze',wrap(async req=>{
    await service.operator(req.user.sub);
    // A request only wakes the idle worker; it cannot supply model prompts or tools.
    if(Object.keys(req.body||{}).length) throw failure('invalid_insights_request');
    await service.repository.pool.query("UPDATE panthorium_insights_control SET next_analysis=NOW() WHERE id=1 AND enabled=TRUE AND worker_status<>'analyzing'");
    service.tick().catch(()=>{});return {ok:true,state:'waiting_idle'};
  }));
  router.post('/incidents/:id/plan',wrap(async req=>{
    if(!UUID.test(req.params.id)||Object.keys(req.body||{}).length) throw failure('invalid_insights_request');
    return service.plan(req.user,req.params.id,req.ip);
  }));
  router.post('/incidents/:id/undo',wrap(async req=>{
    if(!UUID.test(req.params.id)||Object.keys(req.body||{}).length) throw failure('invalid_insights_request');
    return service.undo(req.user.sub,req.params.id);
  }));
  return router;
}
module.exports={createLocalInsightsRouter};
