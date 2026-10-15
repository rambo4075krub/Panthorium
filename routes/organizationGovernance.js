'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const { requireAuth }=require('../middleware/auth');
function createOrganizationGovernanceRouter(authService,service){
  const router=express.Router(),auth=requireAuth(authService);
  router.use('/:orgId/access-requests',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(req.get('Sec-Fetch-Site')==='cross-site')return res.status(403).json({ok:false,error:'org_cross_site_request_denied'});
    if(req.method==='POST' && !req.is('application/json'))return res.status(415).json({ok:false,error:'org_json_required'});
    next();
  });
  const fields=allowed=>(req,res,next)=>{
    if(!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).some(key=>!allowed.includes(key)))return res.status(400).json({ok:false,error:'invalid_access_request_fields'});
    next();
  };
  const limiter=rateLimit({windowMs:60000,limit:40,standardHeaders:true,legacyHeaders:false});
  const call=(handler,status=200)=>async(req,res)=>{
    try{res.status(status).json(await handler(req));}
    catch(error){
      const safe=Number(error.status)>=400 && Number(error.status)<500 && /^[a-z_]+$/.test(String(error.code || ''));
      res.status(safe?error.status:503).json({ok:false,error:safe?error.code:'organization_service_unavailable',...(safe&&error.request?{request:error.request}:{})});
    }
  };
  router.get('/:orgId/access-requests',auth,limiter,call(req=>service.listRequests(req.user,req.params.orgId)));
  router.post('/:orgId/access-requests',auth,limiter,fields(['resourceId','access','reason']),call(req=>service.requestAccess(req.user,req.params.orgId,{resourceId:req.body?.resourceId,access:req.body?.access,reason:req.body?.reason}),201));
  router.post('/:orgId/access-requests/:requestId/approve',auth,limiter,fields(['expectedVersion']),call(req=>service.approveRequest(req.user,req.params.orgId,req.params.requestId,{expectedVersion:req.body?.expectedVersion})));
  router.post('/:orgId/access-requests/:requestId/reject',auth,limiter,fields(['expectedVersion']),call(req=>service.rejectRequest(req.user,req.params.orgId,req.params.requestId,{expectedVersion:req.body?.expectedVersion})));
  return router;
}
module.exports={createOrganizationGovernanceRouter};
