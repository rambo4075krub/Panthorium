'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const catalog = require('../billing-catalog');
(async () => {
  const base = String(process.env.PROMOTION_SMOKE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('PROMOTION_SMOKE_URL must be an HTTPS deployment URL');
  const request = (path, options = {}) => fetch(base + path, { ...options, signal: AbortSignal.timeout(30000) });
  for (const file of ['account-ui.js', 'voice-identity-ui.js', 'billing-catalog.js', 'billing-ui.js']) {
    const response = await request('/' + file); assert.equal(response.status, 200);
    assert.equal(await response.text(), fs.readFileSync(require.resolve('../' + file), 'utf8'), 'deployed asset: ' + file);
  }
  const response = await request('/api/billing/catalog'); assert.equal(response.status, 200);
  const listing = await response.json();
  assert.deepEqual(listing.promotion, catalog.promotionAt());
  assert.deepEqual(listing.products.find(p => p.id === 'free').details, catalog.displayDetails(catalog.get('free')));
  const post = (path, body, token) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const guestResponse = await post('/api/auth/guest', {}); assert.equal(guestResponse.status, 200);
  const guest = await guestResponse.json();
  const paused = await post('/api/auth/register/voice', {}, guest.accessToken);
  assert.equal(paused.status, 503); assert.equal((await paused.json()).error, 'voice_registration_paused');
  // Do not create accounts or send mail: prove the new route enforces verified email.
  const unverified = await post('/api/auth/register/email', { email: 'invalid-proof@example.com', password: 'test-password-123', confirmPassword: 'test-password-123' }, guest.accessToken);
  assert.equal(unverified.status, 400); assert.equal((await unverified.json()).error, 'email_verification_required');
  console.log('Deployed promotion and email registration checks passed: ' + base);
})().catch(error => { console.error(error); process.exitCode = 1; });
