'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const {requireAuth,requirePermission}=require('../middleware/auth');
const {LIMITS}=require('../services/organizationResourceService');
function createOrganizationResourcesRouter(authService,service){
  const router=express.Router();
  router.use('/:orgId/resources',(req,res,next)=>{res.set('Cache-Control','no-store');next();},requireAuth(authService),requirePermission('chat'),rateLimit({windowMs:60000,limit:90,standardHeaders:true,legacyHeaders:false}));
  router.use('/:orgId/resources',(req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({ok:false,error:'org_cross_site_denied'});
      if(!req.is('application/json'))return res.status(415).json({ok:false,error:'org_json_required'});
      if(Buffer.byteLength(JSON.stringify(req.body||{}),'utf8')>80000)return res.status(413).json({ok:false,error:'org_payload_too_large'});
    }
    next();
  });
  const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const code=error.code||error.message||'';const known=/^org_/.test(code);res.status(known?error.status||400:503).json({ok:false,error:known?code:'org_resources_unavailable'});}};
  const args=req=>({user:req.user,orgId:req.params.orgId,resourceId:req.params.id});
  router.get('/:orgId/resources',safe(async(req,res)=>res.json({ok:true,resources:await service.list({...args(req),q:req.query.q||'',kind:req.query.kind||'',limit:req.query.limit||50})})));
  router.post('/:orgId/resources',safe(async(req,res)=>res.status(201).json({ok:true,resource:await service.create({...args(req),input:req.body})})));
  router.get('/:orgId/resources/:id',safe(async(req,res)=>res.json({ok:true,resource:await service.get(args(req))})));
  router.patch('/:orgId/resources/:id',safe(async(req,res)=>res.json({ok:true,resource:await service.update({...args(req),patch:req.body})})));
  router.delete('/:orgId/resources/:id',safe(async(req,res)=>{
    if(!req.body||Object.keys(req.body).some(key=>key!=='expectedVersion'))return res.status(400).json({ok:false,error:'org_unrecognized_field'});
    res.json({ok:true,resource:await service.remove({...args(req),expectedVersion:req.body.expectedVersion})});
  }));
  router.get('/:orgId/resources/:id/revisions',safe(async(req,res)=>res.json({ok:true,revisions:await service.revisions(args(req)),viewLimit:LIMITS.revisionDisplayCount,view:'latest_authorized_within_bounded_history'})));
  router.get('/:orgId/resources/:id/comments',safe(async(req,res)=>res.json({ok:true,comments:await service.comments(args(req))})));
  router.post('/:orgId/resources/:id/comments',safe(async(req,res)=>res.status(201).json({ok:true,comment:await service.addComment({...args(req),input:req.body})})));
  router.get('/:orgId/resources/:id/export',safe(async(req,res)=>{
    const artifact=await service.export(args(req));
    res.set('Content-Disposition','attachment; filename="panthorium-organization-resource-'+artifact.resource.id+'.json"').type('application/json').send(JSON.stringify(artifact,null,2));
  }));
  router.post('/:orgId/resources/:id/summarize',safe(async(req,res)=>{
    if(!req.body||Object.keys(req.body).some(key=>key!=='expectedVersion'))return res.status(400).json({ok:false,error:'org_unrecognized_field'});
    res.json({ok:true,summary:await service.summarize({...args(req),expectedVersion:req.body.expectedVersion})});
  }));
  return router;
}
module.exports={createOrganizationResourcesRouter};
