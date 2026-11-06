'use strict';
const express=require('express'),rateLimit=require('express-rate-limit');
const {requireAuth}=require('../middleware/auth');
const {owner}=require('../services/mailbox/store');
function createUserMailboxRouter(auth,service){const r=express.Router();r.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();});
 r.get('/oauth/:provider/callback',async(req,res)=>{
  const page=(heading,message)=>'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+heading+'</title><main style="font:18px system-ui;max-width:640px;margin:10vh auto;padding:24px"><h1>'+heading+'</h1><p>'+message+'</p><p><a href="/">กลับไป Panthorium</a></p></main>';
  if(req.query.error)return res.status(400).type('html').send(page('ยังไม่ได้เชื่อมต่ออีเมล','คุณยกเลิกหรือผู้ให้บริการไม่อนุญาต กรุณากลับไป Panthorium แล้วลองเชื่อมต่ออีกครั้ง'));
  try{const result=await service.callback(req.params.provider,req.query.code,req.query.state);res.type('html').send(page(result.purpose==='agent'?'เชื่อมต่ออีเมลสำหรับ AI และเสียงสำเร็จ':'เชื่อมต่ออีเมลสำเร็จ','กลับไป Panthorium ระบบจะตรวจการเชื่อมต่ออีกครั้ง หรือกดปุ่มตรวจการเชื่อมต่อในหน้ากล่องอีเมล'));}
  catch(e){const messages={mailbox_registration_email_mismatch:'ต้องเลือกอีเมลเดียวกับที่ใช้สมัคร Panthorium',mailbox_scope_missing:'กรุณาอนุญาตสิทธิ์อีเมลที่ระบบร้องขอให้ครบ',mailbox_offline_permission_required:'กรุณาเชื่อมต่ออีกครั้งและอนุญาตให้ระบบเข้าถึงอีเมล',mailbox_oauth_expired:'ลิงก์เชื่อมต่อหมดอายุ กรุณาเริ่มใหม่จาก Panthorium',mailbox_record_not_found:'ลิงก์หมดอายุหรือถูกใช้แล้ว กรุณาตรวจการเชื่อมต่อใน Panthorium'};res.status(e.status||503).type('html').send(page('เชื่อมต่อไม่สำเร็จ',messages[e.message]||'กรุณากลับไป Panthorium แล้วเริ่มเชื่อมต่อใหม่ หากยังไม่สำเร็จให้ติดต่อผู้ดูแล'));}
 });
 r.use(requireAuth(auth),(req,res,next)=>{try{owner(req.user);next();}catch(e){res.status(e.status).json({ok:false,error:e.message});}},rateLimit({windowMs:60000,max:90,standardHeaders:true,legacyHeaders:false}));
 const safe=fn=>async(req,res)=>{try{res.json({ok:true,...await fn(req)});}catch(e){res.status(e.status||503).json({ok:false,error:e.status?e.message:'mailbox_unavailable'});}};
 r.get('/status',safe(req=>service.status(req.user)));
 r.post('/connect',safe(req=>service.connect(req.user,req.body.provider,req.body.purpose)));
 r.get('/read',safe(req=>service.manualRead(req.user,{...req.query,limit:req.query.limit?Number(req.query.limit):undefined})));
 r.post('/prepare',safe(req=>service.manualPrepare(req.user,req.body)));
 r.post('/confirm',rateLimit({windowMs:60000,max:10,standardHeaders:true,legacyHeaders:false}),safe(req=>service.manualExecute(req.user,req.body.proposalId)));
 r.post('/analyze',rateLimit({windowMs:60000,max:5,standardHeaders:true,legacyHeaders:false}),safe(req=>service.analyze(req.user,req.body)));
 r.get('/drafts',safe(async req=>({items:(await service.store.list(req.user,'draft')).map(({id,preview})=>({id,...preview}))})));
 r.delete('/connection',safe(req=>service.disconnect(req.user,req.query.purpose)));
 return r;
}
module.exports={createUserMailboxRouter};
