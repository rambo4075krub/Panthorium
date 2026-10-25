'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');

function createNotificationRouter(authService, notifications) {
  const router = express.Router();
  const reads = rateLimit({windowMs:60000,limit:90,standardHeaders:true,legacyHeaders:false,keyGenerator:req=>req.user.sub});
  const writes = rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false,keyGenerator:req=>req.user.sub});
  router.post('/push/revoke',rateLimit({windowMs:60000,limit:20,standardHeaders:true,legacyHeaders:false}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    try { res.json(await notifications.push.revoke(req.body?.id,req.body?.token)); } catch { res.status(400).json({ok:false,error:'invalid_push_revocation'}); }
  });
  router.use(requireAuth(authService),requirePermission('chat'));
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const route = fn => async(req,res,next)=>{
    try { const result=await fn(req);res.json(result); }
    catch(error) {
      if (Number.isInteger(error.status) && error.status>=400 && error.status<600) return res.status(error.status).json({ok:false,error:error.code||error.message});
      next(error);
    }
  };
  const body = (req,keys) => {
    const input=req.body;
    if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!keys.includes(key))) throw Object.assign(new Error('invalid_notification_request'),{status:400});
    return input;
  };
  router.get('/push/config',reads,route(req=>{notifications.assertUser(req.user);return notifications.push?.config()||{ok:true,available:false,nativeAvailable:false};}));
  router.post('/push/subscribe',writes,route(req=>notifications.push.subscribe(req.user,body(req,['subscription']))));
  router.delete('/push/subscribe',writes,route(req=>notifications.push.unsubscribe(req.user,body(req,['id']).id)));
  router.get('/settings',reads,route(req=>notifications.settings({user:req.user})));
  router.patch('/settings',writes,route(req=>notifications.updateSettings({user:req.user,patch:req.body})));
  router.get('/',reads,route(req=>{
    if (Object.keys(req.query).some(key=>!['limit','before','unreadOnly'].includes(key)) || req.query.unreadOnly!=null&&!['true','false'].includes(req.query.unreadOnly)) throw Object.assign(new Error('invalid_notification_query'),{status:400});
    return notifications.list({user:req.user,limit:req.query.limit,before:req.query.before,unreadOnly:req.query.unreadOnly==='true'});
  }));
  router.post('/read',writes,route(req=>notifications.markRead({user:req.user,...body(req,['ids','all'])})));
  router.delete('/',writes,route(req=>notifications.remove({user:req.user,...body(req,['ids'])})));
  router.post('/send',writes,route(req=>notifications.send({user:req.user,...body(req,['title','body','category']),requestId:req.get('Idempotency-Key')||undefined})));
  return router;
}
module.exports = { createNotificationRouter };
