'use strict';
const Stripe = require('stripe');
const { CheckoutOrderStore, fail, uuid } = require('./checkoutOrderStore');
const INTEGRATION = 'panthorium_hosted_checkout_nvkqfdra';
const API_VERSION = '2026-10-28.endive';
const EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']);
const idOf = value => typeof value === 'string' ? value : value?.id;
function checkoutUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.username && !u.password && !u.port ? u.href : null; } catch { return null; }
}
class StripeBillingService {
  constructor({ pool, notifications, secret = process.env.STRIPE_SECRET_KEY || '', webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '', mode = process.env.STRIPE_MODE || 'test', liveEnabled = process.env.STRIPE_LIVE_ENABLED === '1', origin = process.env.STRIPE_PUBLIC_ORIGIN || 'https://panthorium.net', client, store } = {}) {
    this.provider = 'stripe'; this.pool = pool; this.secret = secret; this.webhookSecret = webhookSecret; this.mode = mode; this.live = mode === 'live'; this.liveEnabled = liveEnabled;
    this.origin = origin.replace(/\/$/, '');
    this.store = store || new CheckoutOrderStore({ pool, live: this.live, notifications });
    this.client = client || (secret ? new Stripe(secret, { apiVersion: API_VERSION, timeout: 20000, maxNetworkRetries: 2 }) : null);
  }
  configured() {
    let origin; try { origin = new URL(this.origin); } catch { return false; }
    return !!(this.pool && this.client && ['live','test'].includes(this.mode) && new RegExp('^(rk|sk)_' + this.mode + '_').test(this.secret) && /^whsec_\S+$/.test(this.webhookSecret) && (!this.live || this.liveEnabled) && origin.protocol === 'https:' && origin.origin === this.origin && !origin.username && !origin.password);
  }
  requireConfig() { if (!this.configured()) fail('checkout_not_configured'); }
  async status() {
    const base = { provider: 'stripe', policyVersion: require('../privacy-notice').version, configured: this.configured(), connected: false, mode: this.mode, checkoutEnabled: false, paymentMethods: ['stripe_checkout'], grantsRealEntitlements: this.live, automaticRenewal: false };
    if (!base.configured) return base;
    if (!this.health || Date.now() - this.health.at > 60000) {
      try { await this.client.checkout.sessions.list({ limit: 1 }); this.health = { at: Date.now(), ok: true }; }
      catch { this.health = { at: Date.now(), ok: false }; }
    }
    return { ...base, connected: this.health.ok, checkoutEnabled: this.health.ok };
  }
  async checkout(userId, productId, requestKey) {
    this.requireConfig();
    const row = await this.store.begin('stripe', userId, productId, requestKey);
    if (row.provider_id) return this.store.view(await this.reconcile(row));
    if (!['creating','verification_required'].includes(row.status)) return this.store.view(row);
    // Stripe retains idempotency keys for at least 24 hours. Never recreate an
    // ambiguous order after that window; its webhook can still reconcile it.
    if (Date.now() - new Date(row.created_at).getTime() > 23 * 3600000) { await this.store.uncertain(row.id); fail('payment_verification_required', 409); }
    const metadata = { panthorium_order_id: row.id, panthorium_product_id: row.product_id, integration: INTEGRATION };
    try {
      const session = await this.client.checkout.sessions.create({
        mode: 'payment', client_reference_id: row.id, metadata,
        integration_identifier: INTEGRATION,
        line_items: [{ price_data: { currency: row.currency.toLowerCase(), unit_amount: row.amount, product_data: { name: 'Panthorium ' + row.product_snapshot.name, description: row.product_snapshot.kind === 'subscription' ? '1 month of access. No automatic renewal.' : '30 days of access. One-time purchase.' } }, quantity: 1 }],
        payment_intent_data: { metadata },
        success_url: this.origin + '/payment-return.html?result=complete',
        cancel_url: this.origin + '/payment-return.html?result=cancelled'
      }, { idempotencyKey: INTEGRATION + ':' + row.id });
      this.validateSession(session, row);
      const saved = await this.store.settle(row, { providerId: session.id, checkoutUrl: checkoutUrl(session.url), expiresAt: new Date(session.expires_at * 1000).toISOString(), status: 'pending' });
      return this.store.view(session.payment_status === 'paid' ? await this.reconcile(saved) : saved);
    } catch (error) { await this.store.uncertain(row.id); if (error.message === 'payment_mismatch') throw error; fail('stripe_unavailable'); }
  }
  validateSession(session, row) {
    if (!session || session.object !== 'checkout.session' || session.livemode !== this.live || session.mode !== 'payment' || session.client_reference_id !== row.id || session.metadata?.panthorium_order_id !== row.id || session.metadata?.panthorium_product_id !== row.product_id || session.metadata?.integration !== INTEGRATION || session.amount_total !== row.amount || String(session.currency).toUpperCase() !== row.currency || (row.provider_id && row.provider_id !== session.id)) fail('payment_mismatch', 409);
  }
  async reconcile(row, hint = {}) {
    this.requireConfig();
    const session = await this.client.checkout.sessions.retrieve(row.provider_id || hint.sessionId, { expand: ['payment_intent.latest_charge.balance_transaction'] });
    this.validateSession(session, row);
    let status = session.status === 'expired' ? 'expired' : 'pending';
    let paidAt = null; let paymentId = null; let refunds = []; let disputeWon = false;
    const pi = session.payment_intent;
    if (pi && typeof pi !== 'string') {
      if (pi.livemode !== this.live || pi.amount !== row.amount || String(pi.currency).toUpperCase() !== row.currency || pi.metadata?.panthorium_order_id !== row.id || pi.metadata?.integration !== INTEGRATION) fail('payment_mismatch', 409);
      const charge = pi.latest_charge;
      if (session.payment_status === 'paid' && pi.status === 'succeeded') {
        if (!charge || typeof charge === 'string' || charge.paid !== true || charge.captured !== true || charge.livemode !== this.live || charge.amount !== row.amount || charge.amount_captured !== row.amount || String(charge.currency).toUpperCase() !== row.currency || idOf(charge.payment_intent) !== pi.id || !Number.isInteger(charge.created)) fail('payment_mismatch', 409);
        const balance = charge.balance_transaction;
        if (!balance || typeof balance === 'string' || balance.object !== 'balance_transaction' || idOf(balance.source) !== charge.id || !Number.isInteger(balance.created)) fail('payment_verification_required');
        // Async methods can create the charge before payment completes. Anchor
        // access to the verified balance transaction, never a retry's wall clock.
        paymentId = pi.id; paidAt = new Date(balance.created * 1000).toISOString(); status = 'paid';
        if (charge.amount_refunded > 0) {
          for await (const refund of this.client.refunds.list({ charge: charge.id, limit: 100 })) {
            if (refund.status !== 'succeeded') continue;
            if (idOf(refund.charge) !== charge.id || String(refund.currency).toUpperCase() !== row.currency || !Number.isSafeInteger(refund.amount) || refund.amount <= 0 || !Number.isInteger(refund.created)) fail('payment_mismatch', 409);
            refunds.push({ id: refund.id, amount: refund.amount, at: new Date(refund.created * 1000).toISOString() });
          }
          if (refunds.reduce((sum, r) => sum + r.amount, 0) !== charge.amount_refunded) fail('payment_verification_required');
          // A refund (including a partial refund) suspends this order's grant.
          status = 'refunded';
        } else if (charge.disputed || row.status === 'disputed' || hint.disputeId) {
          const disputes = hint.disputeId ? [await this.client.disputes.retrieve(hint.disputeId)] : await this.client.disputes.list({ payment_intent: pi.id, limit: 100 });
          const list = Array.isArray(disputes) ? disputes : disputes.data;
          if (!list?.length || disputes.has_more) fail('payment_verification_required');
          for (const dispute of list) if (idOf(dispute.charge) !== charge.id || dispute.livemode !== this.live) fail('payment_mismatch', 409);
          disputeWon = list.every(dispute => ['won','warning_closed'].includes(dispute.status));
          status = disputeWon ? 'paid' : 'disputed';
        }
      } else if (hint.failed === true && session.status === 'complete' && ['requires_payment_method','canceled'].includes(pi.status)) status = 'failed';
    }
    return this.store.settle(row, { providerId: session.id, paymentId, paidAt, status, refunds, disputeWon, checkoutUrl: checkoutUrl(session.url), expiresAt: new Date(session.expires_at * 1000).toISOString() });
  }
  async order(userId, orderId) {
    this.requireConfig(); const row = await this.store.get(orderId, 'stripe', userId);
    return this.store.view(row.provider_id ? await this.reconcile(row) : row);
  }
  async pending(userId) {
    this.requireConfig(); const rows = await this.store.pending(userId, 'stripe');
    const orders = [];
    for (const row of rows) orders.push(this.store.view(row.provider_id ? await this.reconcile(row) : row));
    return orders;
  }
  async cancel(userId, orderId) {
    this.requireConfig(); const row = await this.store.get(orderId, 'stripe', userId);
    if (!row.provider_id) fail('payment_verification_required', 409);
    const session = await this.client.checkout.sessions.retrieve(row.provider_id);
    this.validateSession(session, row);
    if (session.status === 'open') await this.client.checkout.sessions.expire(session.id);
    return this.store.view(await this.reconcile(row));
  }
  async webhook(raw, signature) {
    this.requireConfig(); let event;
    try { event = this.client.webhooks.constructEvent(raw, signature, this.webhookSecret); } catch { fail('invalid_signature', 400); }
    if (event.livemode !== this.live || event.account) fail('payment_mismatch', 400);
    if (!EVENTS.has(event.type)) return { ignored: true };
    const object = event.data.object;
    let orderId, hint = {};
    if (event.type.startsWith('checkout.session.')) {
      if (object.metadata?.integration !== INTEGRATION) return { ignored: true };
      orderId = object.metadata?.panthorium_order_id;
      hint = { sessionId: object.id, failed: event.type === 'checkout.session.async_payment_failed' };
    } else {
      const charge = event.type.startsWith('charge.dispute.') ? await this.client.charges.retrieve(idOf(object.charge)) : object;
      if (!idOf(charge.payment_intent)) return { ignored: true };
      const pi = await this.client.paymentIntents.retrieve(idOf(charge.payment_intent));
      if (pi.metadata?.integration !== INTEGRATION) return { ignored: true };
      orderId = pi.metadata.panthorium_order_id;
      if (event.type.startsWith('charge.dispute.')) hint.disputeId = object.id;
    }
    if (!uuid(orderId)) fail('payment_mismatch', 400);
    const row = await this.store.get(orderId, 'stripe');
    // Session metadata also recovers creation responses lost to a timeout.
    if (!row.provider_id && !hint.sessionId) fail('payment_verification_required');
    await this.reconcile(row, hint);
    return { received: true };
  }
}
module.exports = { StripeBillingService, checkoutUrl, INTEGRATION, API_VERSION, EVENTS };
