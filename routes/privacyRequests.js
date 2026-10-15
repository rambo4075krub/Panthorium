'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const { requireAuth }=require('../middleware/auth');

function createPrivacyRequestsRouter(authService,service) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  // Reuses current server-side account validation, not client-supplied identity.
  // Requesting review does not authorize or perform erasure of account data.
  router.use(requireAuth(authService));
  router.use(rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false}));
  router.use((req,res,next)=>{
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.get('sec-fetch-site')==='cross-site') return res.status(403).json({ok:false,error:'privacy_requests_cross_site_denied'});
      if (!req.is('application/json')) return res.status(415).json({ok:false,error:'privacy_requests_json_required'});
      if (!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Buffer.byteLength(JSON.stringify(req.body),'utf8')>16000) return res.status(413).json({ok:false,error:'privacy_requests_invalid_body'});
    }
    next();
  });
  const fields=(req,allowed)=>Object.keys(req.body || {}).every(key=>allowed.includes(key));
  const safe=handler=>async(req,res)=>{
    try { await handler(req,res); }
    catch(error) {
      const code=error.code || error.message || '';
      const known=/^privacy_requests_/.test(code);
      res.status(known ? error.status || 400 : 503).json({ok:false,error:known ? code : 'privacy_requests_unavailable'});
    }
  };
  router.get('/account-deletion',safe(async(req,res)=>res.json(await service.deletionStatus({user:req.user}))));
  router.post('/account-deletion',safe(async(req,res)=>{
    if (!fields(req,['confirmation','reason'])) return res.status(400).json({ok:false,error:'privacy_requests_invalid_body'});
    const result=await service.accountDeletion({user:req.user,confirmation:req.body.confirmation,reason:req.body.reason});
    res.status(result.created ? 201 : 200).json(result);
  }));
  router.post('/reports',safe(async(req,res)=>{
    if (!fields(req,['sourceType','sourceId','category','details'])) return res.status(400).json({ok:false,error:'privacy_requests_invalid_body'});
    const result=await service.report({...req.body,user:req.user});
    res.status(201).json(result);
  }));
  router.get('/requests',safe(async(req,res)=>res.json(await service.list({user:req.user,limit:req.query.limit}))));
  router.get('/operator/requests',safe(async(req,res)=>res.json(await service.operatorList({user:req.user,kind:req.query.kind,status:req.query.status,limit:req.query.limit}))));
  router.patch('/operator/requests/:id',safe(async(req,res)=>{
    if (!fields(req,['status','resolution'])) return res.status(400).json({ok:false,error:'privacy_requests_invalid_body'});
    res.json(await service.updateStatus({user:req.user,requestId:req.params.id,status:req.body.status,resolution:req.body.resolution}));
  }));
  return router;
}
module.exports={ createPrivacyRequestsRouter };
