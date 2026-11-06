'use strict';
const express=require('express'),rateLimit=require('express-rate-limit');
const {requireAuth}=require('../middleware/auth');
const {owner}=require('../services/mailbox/store');
function createUserMailboxRouter(auth,service){const r=express.Router();r.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();});
 r.get('/oauth/:provider/callback',async(req,res)=>{try{await service.callback(req.params.provider,req.query.code,req.query.state);res.type('html').send('<!doctype html><meta charset="utf-8"><title>เชื่อมอีเมลแล้ว</title><h1>เชื่อมต่ออีเมลสำเร็จ</h1><p>ปิดหน้าต่างนี้แล้วกลับไป Panthorium กดตรวจการเชื่อมต่อ</p>');}catch(e){res.status(e.status||503).type('text').send('เชื่อมต่อไม่สำเร็จ: '+(e.status?e.message:'mailbox_unavailable'));}});
 r.use(requireAuth(auth),(req,res,next)=>{try{owner(req.user);next();}catch(e){res.status(e.status).json({ok:false,error:e.message});}},rateLimit({windowMs:60000,max:90,standardHeaders:true,legacyHeaders:false}));
 const safe=fn=>async(req,res)=>{try{res.json({ok:true,...await fn(req)});}catch(e){res.status(e.status||503).json({ok:false,error:e.status?e.message:'mailbox_unavailable'});}};
 r.get('/status',safe(req=>service.status(req.user)));
 r.post('/connect',safe(req=>service.connect(req.user,req.body.provider)));
 r.get('/read',safe(req=>service.read(req.user,{...req.query,limit:req.query.limit?Number(req.query.limit):undefined})));
 r.post('/prepare',safe(req=>service.prepare(req.user,req.body)));
 r.post('/confirm',rateLimit({windowMs:60000,max:10,standardHeaders:true,legacyHeaders:false}),safe(req=>service.execute(req.user,req.body.proposalId)));
 r.post('/analyze',rateLimit({windowMs:60000,max:5,standardHeaders:true,legacyHeaders:false}),safe(req=>service.analyze(req.user,req.body)));
 r.get('/drafts',safe(async req=>({items:(await service.store.list(req.user,'draft')).map(({id,preview})=>({id,...preview}))})));
 r.delete('/connection',safe(req=>service.disconnect(req.user)));
 return r;
}
module.exports={createUserMailboxRouter};
