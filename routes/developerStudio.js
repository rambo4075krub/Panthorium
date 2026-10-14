'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const {requireAuth}=require('../middleware/auth');
const {isFounderAccount}=require('../services/founderAccount');
function ownerOnly(req,res,next){if(!isFounderAccount(req.user?.sub||req.user?.id))return res.status(403).json({ok:false,error:'system_owner_required'});next();}
function createDeveloperStudioRouter(auth,service){
 const r=express.Router();r.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});r.use(requireAuth(auth),ownerOnly,rateLimit({windowMs:60000,max:60,standardHeaders:true,legacyHeaders:false}));
 const safe=fn=>async(req,res)=>{try{res.json({ok:true,...await fn(req)});}catch(e){const known=/^(?:invalid_|source_|secret_in_source|change_set_|studio_|github_|staging_changed|staging_acceptance_required|staging_deploy_not_passed|production_changed|repository_tree_truncated|proposal_|review_required|ci_not_passed|ai_|no_source_changes)/.test(e.message);res.status(known?e.status||400:503).json({ok:false,error:known?e.message:'studio_unavailable'});}};
 const owner=req=>req.user.sub||req.user.id;
 r.get('/status',safe(()=>service.status()));r.get('/tree',safe(async()=>{const sha=await service.branch();return {sha,files:await service.tree(sha)};}));r.get('/file',safe(async req=>({file:await service.file(req.query.path,req.query.sha)})));
 r.get('/proposals',safe(async req=>({proposals:await service.list(owner(req))})));r.get('/proposals/:id',safe(async req=>({proposal:await service.get(owner(req),req.params.id)})));
 r.post('/proposals',safe(async req=>({proposal:await service.proposal(owner(req),req.body||{})})));
 r.post('/ai',rateLimit({windowMs:60000,max:3,standardHeaders:true,legacyHeaders:false}),safe(async req=>({proposal:await service.ai(owner(req),req.body||{})})));
 r.post('/proposals/:id/commit',safe(async req=>({proposal:await service.commit(owner(req),req.params.id,req.body||{})})));
 r.post('/proposals/:id/merge',safe(async req=>({proposal:await service.merge(owner(req),req.params.id,req.body||{})})));
 r.post('/proposals/:id/promote',safe(async req=>({proposal:await service.promote(owner(req),req.params.id,req.body||{})})));
 r.post('/proposals/:id/merge-production',safe(async req=>({proposal:await service.mergeProduction(owner(req),req.params.id,req.body||{})})));
 r.get('/checks',safe(async req=>({checks:await service.checks(req.query.sha)})));r.get('/deployments',safe(async req=>({deployments:await service.deployments(req.query.environment||'staging')})));r.get('/cloud-run',safe(()=>service.cloudStatus()));return r;
}
module.exports={createDeveloperStudioRouter,ownerOnly};
