'use strict';
const express=require('express');
const { billingTraffic } = require('../middleware/billingTraffic');
const {requireAuth}=require('../middleware/auth');
const {CheckoutError}=require('../services/checkoutOrderStore');
function createGooglePlayBillingRouter(auth,service){
  const router=express.Router();
  const limits = billingTraffic();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.use(limits.ip);
  const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error instanceof CheckoutError?error.status:503).json({ok:false,error:error instanceof CheckoutError?error.message:'billing_unavailable'});}};
  router.get('/status',safe(async(req,res)=>res.json({ok:true,...await service.status()})));
  router.use(requireAuth(auth));router.use((req,res,next)=>(req.user.roles||[]).includes('guest')?res.status(403).json({ok:false,error:'registered_account_required'}):next());
  const user=req=>req.user.sub||req.user.id;
  router.post('/prepare',limits.write,safe(async(req,res)=>{if(req.body?.policyVersion!==require('../privacy-notice').version)return res.status(409).json({ok:false,error:'policy_version_changed'});if(service.live?req.body?.liveAcknowledged!==true:req.body?.testAcknowledged!==true)return res.status(400).json({ok:false,error:'payment_acknowledgement_required'});res.json({ok:true,order:await service.prepare(user(req),req.body?.productId,req.body?.requestKey)});}));
  router.post('/verify',limits.write,safe(async(req,res)=>res.json({ok:true,order:await service.verify(user(req),req.body?.orderId,req.body?.purchaseToken)})));
  router.get('/orders',limits.read,safe(async(req,res)=>res.json({ok:true,orders:await service.pending(user(req))})));
  router.get('/orders/:id',limits.read,safe(async(req,res)=>res.json({ok:true,order:await service.order(user(req),req.params.id)})));
  router.post('/orders/:id/cancel',limits.write,safe(async(req,res)=>res.json({ok:true,order:await service.cancel(user(req),req.params.id)})));
  return router;
}
module.exports={createGooglePlayBillingRouter};
