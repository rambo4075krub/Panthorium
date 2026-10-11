'use strict';
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const catalog = require('../billing-catalog');

// UI rollout only. Never create charges or grant entitlements until the durable
// order ledger, verified Omise callbacks and quota enforcement are integrated.
function createBillingRouter(authService) {
  const router = express.Router();
  router.get('/catalog', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, version: catalog.version, taxStatus: catalog.taxStatus, products: catalog.products, checkoutEnabled: false });
  });
  router.post('/checkout', requireAuth(authService), (req, res) => {
    if ((req.user.roles || []).includes('guest')) return res.status(403).json({ ok: false, error: 'registered_account_required' });
    const product = catalog.get(req.body?.productId);
    if (!product || product.kind === 'free') return res.status(400).json({ ok: false, error: 'invalid_product' });
    // Client prices and payment status are never authoritative.
    res.status(503).json({ ok: false, error: 'checkout_not_configured', message: 'กำลังเตรียมระบบชำระเงิน ยังไม่มีการเรียกเก็บเงิน' });
  });
  return router;
}
module.exports = { createBillingRouter };
