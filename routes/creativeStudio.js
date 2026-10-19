'use strict';
const { OfficeArtifactError } = require('../services/officeArtifactService');
const express = require('express');
const {validateEdit}=require('../services/studioEditorService');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { CreativeStudioError } = require('../services/creativeStudioService');
const { CloudFilesError } = require('../services/cloudFilesService');
const { CreativeStudioRepositoryError } = require('../services/creativeStudioRepository');

function createCreativeStudioRouter(authService, studio) {
  const router = express.Router();
  router.use(requireAuth(authService));
  router.use((req,res,next) => { res.set('Cache-Control','private, no-store'); next(); });
  const submit = rateLimit({ windowMs: 60000, limit: 8, standardHeaders: true, legacyHeaders: false });
  const progress = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const handle = fn => async (req,res,next) => { try { await fn(req,res); } catch(error) { next(error); } };
  const drafts = rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false});
  router.get('/editor/:fileId/draft',handle(async(req,res)=>{
    const user=await studio.principal(req.user);await studio.files.findObject(user.sub,req.params.fileId);
    res.json({ok:true,...await studio.repository.getDraft(user.sub,req.params.fileId)});
  }));
  router.put('/editor/:fileId/draft',drafts,handle(async(req,res)=>{
    const user=await studio.principal(req.user),body=req.body||{};
    if(Object.keys(body).some(k=>!['version','revision','operations','name'].includes(k))||!Number.isSafeInteger(body.version)||body.version<0||body.version>1000000||!/^[a-f0-9]{64}$/.test(body.revision||'')||!Array.isArray(body.operations)||typeof body.name!=='string'||body.name.length>150)throw new CreativeStudioError(400,'invalid_editor_draft');
    if(body.operations.length)validateEdit({fileId:req.params.fileId,revision:body.revision,operations:body.operations});
    await studio.files.findObject(user.sub,req.params.fileId);
    try{const saved=await studio.repository.saveDraft(user.sub,req.params.fileId,body.version,body.operations.length?{revision:body.revision,operations:body.operations,name:body.name}:null);res.json({ok:true,...saved});}
    catch(error){if(['editor_draft_conflict','editor_draft_limit'].includes(error.code))throw new CreativeStudioError(error.status,error.code);throw error;}
  }));
  router.get('/editor/:fileId', handle(async(req,res) => { const user=await studio.principal(req.user); res.json({ok:true,...await studio.editor.read(user,req.params.fileId)}); }));
  router.get('/catalog', handle(async(req,res) => res.json({ok:true,...await studio.catalog({user:req.user})})));
  router.get('/jobs', handle(async(req,res) => res.json({ok:true,...await studio.list({user:req.user})})));
  router.get('/jobs/:jobId', handle(async(req,res) => res.json({ok:true,...await studio.get({user:req.user,jobId:req.params.jobId})})));
  router.post('/jobs', submit, handle(async(req,res) => {
    const body = req.body || {};
    if (Object.keys(body).some(key => !['pluginId','input','sourceFileIds','idempotencyKey','confirmed','steps'].includes(key))) throw new CreativeStudioError(400,'unsupported_studio_request');
    const result = await studio.start({user:req.user,pluginId:body.pluginId,input:body.input,sourceFileIds:body.sourceFileIds,idempotencyKey:body.idempotencyKey,confirmed:body.confirmed,steps:body.steps});
    res.status(result.job.status === 'completed' ? 200 : 202).json({ok:true,...result});
  }));
  router.post('/jobs/:jobId/advance', progress, handle(async(req,res) => res.json({ok:true,...await studio.advance({user:req.user,jobId:req.params.jobId})})));
  router.put('/plugins/:pluginId/mode', submit, handle(async(req,res) => {
    if (Object.keys(req.body || {}).some(key => key !== 'mode')) throw new CreativeStudioError(400,'invalid_studio_mode');
    res.json({ok:true,...await studio.setMode({user:req.user,pluginId:req.params.pluginId,mode:req.body?.mode})});
  }));
  router.use((error,req,res,next) => {
    if (error instanceof OfficeArtifactError || error instanceof CreativeStudioError || error instanceof CloudFilesError || error instanceof CreativeStudioRepositoryError) return res.status(error.status || 500).json({ok:false,error:error.code || 'studio_operation_failed'});
    next(error);
  });
  return router;
}
module.exports = { createCreativeStudioRouter };
