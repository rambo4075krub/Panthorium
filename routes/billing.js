'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const { requireAuth }=require('../middleware/auth');
const catalog=require('../billing-catalog');
const { billingTraffic } = require('../middleware/billingTraffic');
const { OmiseBillingService }=require('../services/omiseBillingService');
function createBillingRouter(authService,service=new OmiseBillingService(),options={}) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const limits = billingTraffic();
  const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const known=['checkout_not_configured','invalid_product','invalid_request_key','request_key_conflict','invalid_order','order_not_found','invalid_event','invalid_charge','charge_mismatch','invalid_qr_url','qr_unavailable','paid_membership_required','membership_already_active','pending_membership_exists','omise_unavailable','omise_auth_failed','omise_request_failed'];res.status(known.includes(error.message) ? error.status || 503 : 503).json({ok:false,error:known.includes(error.message) ? error.message:'billing_unavailable'});}};
  const registered=(req,res,next)=>{if((req.user.roles || []).includes('guest'))return res.status(403).json({ok:false,error:'registered_account_required'});next();};
  router.get('/catalog',(req,res)=>res.json({ok:true,version:catalog.version,quotaPolicy:catalog.quotaPolicy,serviceDescription:catalog.serviceDescription,conversionDetails:catalog.conversionDetails,refundSummary:catalog.refundSummary,taxStatus:catalog.taxStatus,products:catalog.products.map(product=>({...product,details:catalog.displayDetails(product)})),promotion:catalog.promotionAt(),checkoutEnabled:false}));
  router.get('/status',limits.ip,safe(async(req,res)=>res.json({ok:true,...await (options.stripePrimary ? options.stripe : service).status()})));
  router.post('/checkout',limits.ip,requireAuth(authService),registered,limits.write,safe(async(req,res)=>{
    if(options.stripePrimary)return res.status(409).json({ok:false,error:'payment_provider_changed'});
    const product=catalog.get(req.body?.productId);if(!product || product.kind==='free')return res.status(400).json({ok:false,error:'invalid_product'});
    if(!service.configured())return res.status(503).json({ok:false,error:'checkout_not_configured'});
    if(service.live ? req.body?.liveAcknowledged!==true : req.body?.testAcknowledged!==true)return res.status(400).json({ok:false,error:service.live ? 'live_acknowledgement_required':'test_acknowledgement_required'});
    res.json({ok:true,order:await service.checkout(req.user.sub || req.user.id,product.id,req.body.requestKey)});
  }));
  router.get('/orders/:id',limits.ip,requireAuth(authService),registered,limits.read,safe(async(req,res)=>res.json({ok:true,order:await service.order(req.user.sub || req.user.id,req.params.id)})));
  router.get('/orders/:id/qr',limits.ip,requireAuth(authService),registered,limits.read,safe(async(req,res)=>{const qr=await service.qr(req.user.sub || req.user.id,req.params.id);res.set('Content-Security-Policy',"default-src 'none'; sandbox").type(qr.type).send(qr.body);}));
  router.get('/entitlements',limits.ip,requireAuth(authService),registered,limits.read,safe(async(req,res)=>res.json({ok:true,...await service.entitlements().state(req.user.sub || req.user.id)})));
  // Payload is only a hint: independently retrieve both event and charge using the server key.
  router.post('/webhook',rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false}),safe(async(req,res)=>res.json({ok:true,...await service.webhook(req.body?.id)})));
  return router;
}
module.exports={createBillingRouter};
