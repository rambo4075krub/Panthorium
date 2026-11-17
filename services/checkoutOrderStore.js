'use strict';
const { randomUUID } = require('node:crypto');
const catalog = require('../billing-catalog');
const policy = require('../privacy-notice');
const { EntitlementService } = require('./entitlementService');
const { BillingAdminService } = require('./billingAdminService');

class CheckoutError extends Error {
  constructor(code, status = 503) { super(code); this.status = status; }
}
const fail = (code, status) => { throw new CheckoutError(code, status); };
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');

// Every payment channel uses the same account entitlements and membership lock.
// Sandbox orders have their own tables and can never grant production rights.
class CheckoutOrderStore {
  constructor({ pool, live = false, notifications = null }) {
    this.pool = pool; this.live = live; this.notifications = notifications; this.ready = null;
    this.orders = live ? 'panthorium_checkout_live_orders' : 'panthorium_checkout_test_orders';
    this.rights = new EntitlementService({ pool });
  }
  async init() {
    if (!this.pool) fail('checkout_not_configured');
    if (!this.ready) this.ready = (async () => {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.orders} (
        id UUID PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('stripe','google_play')),
        user_id TEXT NOT NULL, request_key UUID NOT NULL, product_id TEXT NOT NULL,
        product_snapshot JSONB NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'creating', provider_id TEXT, payment_id TEXT,
        checkout_url TEXT, expires_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, collected_amount INTEGER CHECK(collected_amount>=0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider,user_id,request_key), UNIQUE(provider,provider_id));
        ALTER TABLE ${this.orders} ADD COLUMN IF NOT EXISTS collected_amount INTEGER CHECK(collected_amount>=0);
        CREATE INDEX IF NOT EXISTS ${this.orders}_owner ON ${this.orders}(user_id,created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS ${this.orders}_pending_membership ON ${this.orders}(user_id)
          WHERE product_id IN ('life','work','work-pro') AND status IN ('creating','pending','verification_required');`);
      if (this.live) {
        await this.rights.init();
        await new BillingAdminService({ pool: this.pool }).init();
      }
    })().catch(error => { this.ready = null; throw error; });
    await this.ready;
  }
  async transaction(userId, fn) {
    await this.init(); const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['billing:' + userId]);
      const result = await fn(c); await c.query('COMMIT'); return result;
    } catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
  async begin(provider, userId, productId, requestKey) {
    const product = catalog.get(productId);
    if (!product || product.kind === 'free') fail('invalid_product', 400);
    if (!uuid(requestKey)) fail('invalid_request_key', 400);
    return this.transaction(userId, async c => {
      const old = (await c.query(`SELECT * FROM ${this.orders} WHERE provider=$1 AND user_id=$2 AND request_key=$3`, [provider, userId, requestKey])).rows[0];
      if (old) { if (old.product_id !== productId) fail('request_key_conflict', 409); return old; }
      if (this.live) {
        const active = await this.rights.active(c, userId);
        const member = active.some(row => row.snapshot.category === 'membership');
        if (product.paidMembershipRequired && !member) fail('paid_membership_required', 403);
        if (product.category === 'membership' && member) fail('membership_already_active', 409);
      }
      if (product.category === 'membership') {
        const pending = await c.query(`SELECT id FROM ${this.orders} WHERE user_id=$1 AND product_id IN ('life','work','work-pro') AND status IN ('creating','pending','verification_required')`, [userId]);
        if (pending.rows.length) fail('pending_membership_exists', 409);
        // Preserve unresolved legacy PromptPay orders during a provider migration.
        if (this.live && (await c.query("SELECT to_regclass('panthorium_omise_live_orders') AS existing")).rows[0]?.existing) {
          const legacy = await c.query("SELECT id FROM panthorium_omise_live_orders WHERE user_id=$1 AND product_id IN ('life','work','work-pro') AND status IN ('creating','pending','verification_required')", [userId]);
          if (legacy.rows.length) fail('pending_membership_exists', 409);
        }
      }
      return (await c.query(`INSERT INTO ${this.orders}(id,provider,user_id,request_key,product_id,product_snapshot,amount,currency)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [randomUUID(), provider, userId, requestKey, product.id, JSON.stringify({...product,purchaseTerms:{version:policy.version,catalogVersion:catalog.version,refundPolicy:catalog.refundSummary,acceptedAt:new Date().toISOString()}}), product.amountSatang, product.currency])).rows[0];
    });
  }
  async get(id, provider, userId) {
    await this.init(); if (!uuid(id)) fail('invalid_order', 400);
    const row = (await this.pool.query(`SELECT * FROM ${this.orders} WHERE id=$1 AND provider=$2${userId === undefined ? '' : ' AND user_id=$3'}`, userId === undefined ? [id, provider] : [id, provider, userId])).rows[0];
    if (!row) fail('order_not_found', 404); return row;
  }
  async pending(userId, provider) {
    await this.init();
    return (await this.pool.query(`SELECT * FROM ${this.orders} WHERE user_id=$1 AND provider=$2 AND status IN ('creating','pending','verification_required') ORDER BY created_at DESC LIMIT 20`, [userId, provider])).rows;
  }
  async uncertain(id) {
    await this.pool.query(`UPDATE ${this.orders} SET status='verification_required',updated_at=NOW() WHERE id=$1 AND status='creating'`, [id]);
  }
  async settle(initial, result) {
    const row = await this.transaction(initial.user_id, async c => {
      const current = (await c.query(`SELECT * FROM ${this.orders} WHERE id=$1 FOR UPDATE`, [initial.id])).rows[0];
      if (!current || current.provider !== initial.provider) fail('order_not_found', 404);
      if (current.provider_id && result.providerId && current.provider_id !== result.providerId) fail('payment_mismatch', 409);
      if (current.payment_id && result.paymentId && current.payment_id !== result.paymentId) fail('payment_mismatch', 409);
      let status = result.status;
      if (current.status === 'refunded') status = 'refunded';
      else if (current.status === 'paid_conflict' && status === 'paid') status = 'paid_conflict';
      else if (current.status === 'disputed' && status === 'paid' && result.disputeWon !== true) status = 'disputed';
      else if (['paid', 'disputed', 'paid_conflict'].includes(current.status) && !['refunded', 'disputed', 'paid'].includes(status)) status = current.status;
      const paidAt = current.paid_at || result.paidAt || null;
      const collected = result.collectedAmount ?? current.collected_amount ?? current.amount;
      if (!Number.isSafeInteger(collected) || collected < 0 || collected > current.amount || (current.collected_amount !== null && current.collected_amount !== undefined && current.collected_amount !== collected)) fail('payment_mismatch',409);
      if (status === 'paid' && !paidAt) status = 'verification_required';
      if (status === 'paid' && this.live && current.product_snapshot.category === 'membership') {
        const active = await this.rights.active(c, current.user_id);
        if (active.some(grant => grant.snapshot.category === 'membership' && grant.order_id !== current.id)) status = 'paid_conflict';
      }
      const saved = (await c.query(`UPDATE ${this.orders} SET status=$2,provider_id=COALESCE($3,provider_id),payment_id=COALESCE($4,payment_id),
        checkout_url=COALESCE($5,checkout_url),expires_at=COALESCE($6,expires_at),paid_at=COALESCE(paid_at,$7),collected_amount=COALESCE(collected_amount,$8),updated_at=NOW() WHERE id=$1 RETURNING *`,
      [current.id, status, result.providerId || null, result.paymentId || null, result.checkoutUrl || null, result.expiresAt || null, paidAt, paidAt ? collected : null])).rows[0];
      if (this.live && status === 'paid') {
        await this.rights.grant(c, saved, paidAt);
        if (current.status === 'disputed' && result.disputeWon === true) await c.query('UPDATE panthorium_entitlement_grants SET revoked_at=NULL WHERE order_id=$1', [current.id]);
      }
      if (this.live && ['refunded', 'disputed'].includes(status)) await c.query('UPDATE panthorium_entitlement_grants SET revoked_at=COALESCE(revoked_at,NOW()) WHERE order_id=$1', [current.id]);
      if (this.live && paidAt && result.paymentId) {
        if (collected > 0) await c.query(`INSERT INTO panthorium_finance_entries(id,source_key,kind,occurred_at,amount,description,evidence,order_id,actor)
          VALUES($1,$2,'income',$3,$4,$5,$6,$7,$8) ON CONFLICT(source_key) DO NOTHING`,
        [randomUUID(), initial.provider + ':payment:' + result.paymentId, paidAt, collected, 'ขายแพ็กเกจ ' + saved.product_id, result.paymentId, saved.id, initial.provider]);
        for (const refund of result.refunds || []) await c.query(`INSERT INTO panthorium_finance_entries(id,source_key,kind,occurred_at,amount,description,evidence,order_id,actor)
          VALUES($1,$2,'refund',$3,$4,$5,$6,$7,$8) ON CONFLICT(source_key) DO NOTHING`,
        [randomUUID(), initial.provider + ':refund:' + refund.id, refund.at, refund.amount, 'คืนเงิน ' + saved.product_id, refund.id, saved.id, initial.provider]);
      }
      return saved;
    });
    const messages = { paid: ['ชำระเงินสำเร็จ', 'เปิดสิทธิ์แพ็กเกจในบัญชีของคุณแล้ว'], refunded: ['คืนเงินแล้ว', 'ปรับสิทธิ์ตามสถานะการคืนเงินแล้ว'], disputed: ['กำลังตรวจสอบรายการชำระเงิน', 'พักสิทธิ์ของรายการที่มีข้อโต้แย้งการชำระเงิน'], paid_conflict: ['ได้รับเงินแล้ว กำลังตรวจสิทธิ์', 'มีแพ็กเกจสมาชิกที่ยังใช้งานได้ กรุณาติดต่อ account@panthorium.net พร้อมเลขคำสั่งซื้อ'], failed: ['ชำระเงินไม่สำเร็จ', 'ตรวจสถานะก่อนเริ่มรายการใหม่'] };
    const message = messages[row.status];
    if (message) try { await this.notifications?.publish({ userId: row.user_id, category: 'billing', type: 'billing.' + row.status, title: (this.live ? '' : 'ทดสอบ: ') + message[0], body: (this.live ? message[1] : 'รายการทดสอบไม่เพิ่มสิทธิ์จริง') + ' · ' + row.id, sourceId: row.provider + ':' + this.live + ':' + row.id + ':' + row.status, sensitive: true }); } catch {}
    return row;
  }
  view(row) {
    return { id: row.id, requestKey: row.request_key, provider: row.provider, productId: row.product_id, amountSatang: row.amount, currency: row.currency,
      status: row.status, checkoutUrl: row.status === 'pending' ? row.checkout_url : null, expiresAt: row.expires_at,
      mode: this.live ? 'live' : 'test', grantsRealEntitlements: this.live, paidAt: row.paid_at, collectedAmountSatang: row.collected_amount ?? null };
  }
}
module.exports = { CheckoutOrderStore, CheckoutError, fail, uuid };
