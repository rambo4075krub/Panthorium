'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');
function createCloudAppsRouter(authService,runtime) {
  const router = express.Router();
  router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  router.use(requireAuth(authService),requirePermission('chat'));
  router.use(rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}));
  // The API accepts Bearer credentials only (requireAuth); mutations require JSON,
  // and cross-site browser mutation attempts are rejected independently of cookies.
  router.use((req,res,next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ok:false,error:'cloud_apps_cross_site_denied'});
      if (!req.is('application/json')) return res.status(415).json({ok:false,error:'cloud_apps_json_required'});
      if (Buffer.byteLength(JSON.stringify(req.body || {}),'utf8') > 32000) return res.status(413).json({ok:false,error:'cloud_apps_input_too_large'});
    }
    next();
  });
  const safe = handler => async (req,res) => {
    try { await handler(req,res); }
    catch(error) {
      const code = error.code || error.message || '';
      const known = /^cloud_apps_|^minor_provider_policy_not_verified$/.test(code);
      res.status(known ? error.status || 400 : 503).json({ok:false,error:known ? code : 'cloud_apps_unavailable'});
    }
  };
  router.get('/catalog',safe(async(req,res) => res.json({ok:true,...runtime.catalog(req.user)})));
  router.post('/sessions',safe(async(req,res) => res.status(201).json({ok:true,session:await runtime.launch({user:req.user,packId:req.body?.packId,scope:req.body?.scope})})));
  const execute = safe(async(req,res) => res.json({ok:true,run:await runtime.execute({...req.body,user:req.user,sessionId:req.params.id || req.body?.sessionId})}));
  router.post('/sessions/:id/execute',execute);
  router.post('/runs',execute);
  router.get('/runs',safe(async(req,res) => res.json({ok:true,runs:await runtime.list({user:req.user,packId:typeof req.query.packId === 'string' ? req.query.packId : '',idempotencyKey:typeof req.query.idempotencyKey === 'string' ? req.query.idempotencyKey : '',limit:req.query.limit,scope:typeof req.query.scope === 'string' ? req.query.scope : 'personal'})})));
  router.get('/runs/:id/export',safe(async(req,res) => {
    const artifact = await runtime.export({user:req.user,runId:req.params.id});
    res.set('Content-Disposition','attachment; filename="panthorium-cloud-draft-'+artifact.run.id+'.json"').type('application/json').send(JSON.stringify(artifact,null,2));
  }));
  router.get('/runs/:id',safe(async(req,res) => res.json({ok:true,run:await runtime.get({user:req.user,runId:req.params.id})})));
  router.post('/runs/:id/cancel',safe(async(req,res) => res.json({ok:true,run:await runtime.cancel({user:req.user,runId:req.params.id})})));
  return router;
}
module.exports = { createCloudAppsRouter };
