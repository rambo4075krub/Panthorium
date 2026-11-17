'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const {requireAuth,requirePermission}=require('../middleware/auth');
const {owner}=require('../services/remoteWorkspaceProtocol');

function createRemoteWorkspaceRouter(authService,service) {
  const router=express.Router();
  const publicLimiter=rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false});
  const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json({ok:true,...await fn(req)});}catch(e){
    if(e.code==='personal_storage_full'&&req.user) { try { await service.warn(req.user.sub,await service.quota(req.user),true); } catch {} }
    res.status(e.status||500).json({ok:false,error:e.status?e.code||e.message:'remote_workspace_unavailable'});
  }};
  router.post('/pairing/start',publicLimiter,wrap(req=>service.startPairing(req.body)));
  router.post('/pairing/status',publicLimiter,wrap(req=>service.pairingStatus(req.body?.pairingId,req.body?.deviceSecret)));
  const deviceAuth=async(req,res,next)=>{try{
    const token=String(req.headers.authorization||'').match(/^Device ([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/);
    req.device=await service.authenticateDevice(token?.[1],token?.[2]);next();
  }catch(e){res.status(e.status||503).json({ok:false,error:e.status?e.code||e.message:'device_validation_unavailable'});}};
  router.post('/agent/disconnect',deviceAuth,wrap(async req=>({device:await service.updateDevice({sub:req.device.owner,permissions:['chat']},req.device.id,{revoke:true})})));
  router.post('/agent/poll',deviceAuth,wrap(req=>service.poll(req.device,req.body)));
  router.post('/agent/jobs/:id/result',deviceAuth,wrap(async req=>({job:await service.complete(req.device,req.params.id,req.body)})));
  router.use(requireAuth(authService),requirePermission('chat'),(req,res,next)=>{try{owner(req.user);next();}catch(e){res.status(e.status).json({ok:false,error:e.code});}});
  router.use(rateLimit({windowMs:60000,limit:180,standardHeaders:true,legacyHeaders:false,keyGenerator:req=>req.user.sub}));
  router.get('/quota',wrap(async req=>({quota:await service.quota(req.user)})));
  router.post('/pairing/inspect',wrap(req=>service.inspectPairing(req.user,req.body?.code)));
  router.post('/pairing/confirm',wrap(req=>service.confirmPairing(req.user,req.body?.code)));
  router.get('/devices',wrap(async req=>({devices:await service.devices(req.user)})));
  router.patch('/devices/:id',wrap(async req=>({device:await service.updateDevice(req.user,req.params.id,req.body)})));
  router.get('/chats',wrap(async req=>({chats:await service.threads(req.user)})));
  router.put('/chats/:id',wrap(req=>service.putThread(req.user,{...req.body,id:req.params.id})));
  router.delete('/chats/:id',wrap(req=>service.deleteThread(req.user,req.params.id)));
  router.post('/chats/:id/sync',wrap(async req=>({job:await service.syncChat(req.user,req.params.id,req.body?.content)})));
  router.post('/chats/:id/retrieve',wrap(async req=>({job:await service.retrieveChat(req.user,req.params.id)})));
  router.get('/jobs',wrap(async req=>({jobs:await service.jobs(req.user,req.query.chatId)})));
  router.post('/jobs',wrap(async req=>({job:await service.submit(req.user,req.body,req.headers['idempotency-key'])})));
  router.get('/jobs/:id',wrap(async req=>({job:await service.job(req.user,req.params.id,{preview:true,result:true})})));
  router.post('/jobs/:id/approve',wrap(async req=>({job:await service.approve(req.user,req.params.id,req.body?.approvalHash)})));
  router.post('/jobs/:id/cancel',wrap(async req=>({job:await service.cancel(req.user,req.params.id)})));
  return router;
}
module.exports={createRemoteWorkspaceRouter};
