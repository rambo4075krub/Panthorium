'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { CheckoutError } = require('../services/checkoutOrderStore');
function safe(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (error) { res.status(error instanceof CheckoutError ? error.status : 503).json({ ok: false, error: error instanceof CheckoutError ? error.message : 'billing_unavailable' }); }
  };
}
function stripeWebhook(service) {
  return safe(async (req, res) => res.json({ ok: true, ...await service.webhook(req.body, req.get('stripe-signature')) }));
}
function createStripeBillingRouter(authService, service) {
  const router = express.Router();
  router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  router.use(rateLimit({ windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false }));
  router.use(requireAuth(authService));
  router.use((req,res,next) => (req.user.roles || []).includes('guest') ? res.status(403).json({ok:false,error:'registered_account_required'}) : next());
  const owner = req => req.user.sub || req.user.id;
  router.post('/checkout', safe(async (req, res) => {
    if (req.body?.policyVersion !== require('../privacy-notice').version) return res.status(409).json({ok:false,error:'policy_version_changed'});
    if (service.live ? req.body?.liveAcknowledged !== true : req.body?.testAcknowledged !== true) return res.status(400).json({ok:false,error:service.live ? 'live_acknowledgement_required' : 'test_acknowledgement_required'});
    res.json({ ok: true, order: await service.checkout(owner(req), req.body?.productId, req.body?.requestKey) });
  }));
  router.get('/orders', safe(async (req, res) => res.json({ok:true,orders:await service.pending(owner(req))})));
  router.get('/orders/:id', safe(async (req, res) => res.json({ok:true,order:await service.order(owner(req),req.params.id)})));
  router.post('/orders/:id/cancel', safe(async (req, res) => res.json({ok:true,order:await service.cancel(owner(req),req.params.id)})));
  return router;
}
module.exports = { createStripeBillingRouter, stripeWebhook };
