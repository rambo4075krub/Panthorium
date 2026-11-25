"use strict";
const express=require("express");
const rateLimit=require("express-rate-limit");
const {requireAuth,requirePermission}=require("../middleware/auth");
const {account}=require("../services/socialService");
const {isAdmin}=require("../services/marketingService");
function createMarketingRouter(auth, service, social) {
  const r=express.Router();
  r.use(requireAuth(auth),requirePermission("chat"),(req,res,next)=>{
    res.set("Cache-Control","private, no-store");
    try { account(req.user); next(); } catch(e) { next(e); }
  },rateLimit({windowMs:60000,limit:90,standardHeaders:true,legacyHeaders:false}));
  const route=fn=>async(req,res,next)=>{try { res.json({ok:true,...await fn(req)}); } catch(e) { next(e); }};
  r.get("/preferences",route(async req=>({preferences:await service.preferences(req.user)})));
  r.put("/preferences",route(async req=>({preferences:await service.setPreference(req.user,req.body?.key,req.body?.value)})));
  r.post("/events",route(async req=>{await service.observe(req.user,req.body?.feature);}));
  r.get("/offers",route(async req=>{
    const thread=await social.support({user:req.user});
    return {items:thread.inbox?[]:await service.offers(req.user)};
  }));
  r.use("/admin",(req,res,next)=>isAdmin(req.user)?next():res.status(403).json({ok:false,error:"permission_denied"}));
  r.get("/admin",route(()=>service.dashboard()));
  r.post("/admin/run",route(async()=>{
    if (!service.runner.available()) throw Object.assign(Error("marketing_worker_unavailable"),{status:503});
    service.tick().catch(()=>console.warn("[MARKETING] daily check deferred")); return {scheduled:true};
  }));
  r.post("/admin/discover",route(req=>service.discover(req.user,req.body?.query)));
  r.post("/admin/campaigns",route(req=>service.publish(req.user,req.body || {})));
  r.post("/admin/campaigns/:id/stop",route(async req=>{
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(req.params.id)) throw Object.assign(Error("invalid_campaign"),{status:400});
    await service.stopCampaign(req.params.id);
  }));
  r.use((err,req,res,next)=>err.status?res.status(err.status).json({ok:false,error:err.message}):next(err));
  return r;
}
module.exports={createMarketingRouter};
