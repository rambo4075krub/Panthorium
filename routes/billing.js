'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const { requireAuth }=require('../middleware/auth');
const catalog=require('../billing-catalog');
const { OmiseBillingService }=require('../services/omiseBillingService');
function createBillingRouter(authService,service=new OmiseBillingService()) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const limited=rateLimit({windowMs:60000,max:20,standardHeaders:true,legacyHeaders:false});
  const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const known=['checkout_not_configured','invalid_product','invalid_request_key','request_key_conflict','invalid_order','order_not_found','invalid_event','invalid_charge','charge_mismatch','invalid_qr_url','omise_unavailable','omise_auth_failed','omise_request_failed'];res.status(known.includes(error.message) ? error.status || 503 : 503).json({ok:false,error:known.includes(error.message) ? error.message:'billing_unavailable'});}};
  const registered=(req,res,next)=>{if((req.user.roles || []).includes('guest'))return res.status(403).json({ok:false,error:'registered_account_required'});next();};
  router.get('/catalog',(req,res)=>res.json({ok:true,version:catalog.version,taxStatus:catalog.taxStatus,products:catalog.products,checkoutEnabled:false}));
  router.get('/status',limited,safe(async(req,res)=>res.json({ok:true,...await service.status()})));
  router.post('/checkout',limited,requireAuth(authService),registered,safe(async(req,res)=>{
    const product=catalog.get(req.body?.productId);if(!product || product.kind==='free')return res.status(400).json({ok:false,error:'invalid_product'});
    if(!service.configured())return res.status(503).json({ok:false,error:'checkout_not_configured'});
    if(req.body?.testAcknowledged!==true)return res.status(400).json({ok:false,error:'test_acknowledgement_required'});
    res.json({ok:true,order:await service.checkout(req.user.sub || req.user.id,product.id,req.body.requestKey)});
  }));
  router.get('/orders/:id',limited,requireAuth(authService),registered,safe(async(req,res)=>res.json({ok:true,order:await service.order(req.user.sub || req.user.id,req.params.id)})));
  // Payload is only a hint: independently retrieve both event and charge using the server key.
  router.post('/webhook',rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false}),safe(async(req,res)=>res.json({ok:true,...await service.webhook(req.body?.id)})));
  return router;
}
module.exports={createBillingRouter};
