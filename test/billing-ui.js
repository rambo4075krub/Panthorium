'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const express = require('express');
const catalog = require('../billing-catalog');
const { createBillingRouter } = require('../routes/billing');
const read = name => fs.readFileSync(require.resolve('../' + name), 'utf8');

async function main() {
  assert.equal(catalog.products.length, 17);
  assert.equal(catalog.get('work-pro').amountSatang, 108900);
  assert.equal(catalog.get('download-10').paidMembershipRequired, true);
  const dom = new JSDOM('<div id="windows"></div>', { runScripts: 'outside-only', url: 'https://panthorium.test' });
  const w = dom.window;
  w.OS = { state: { user: { id: 'user-1', roles: ['user'] } }, windows: new Map() };
  let restored = null;
  w.PanthoriumWindowManager = { restore: id => { restored = id; } };
  w.createWindow = (id, title, html) => {
    const win = w.document.createElement('div');
    win.className = 'window'; win.dataset.id = id; win.innerHTML = html;
    w.document.getElementById('windows').appendChild(win);
    w.OS.windows.set(id, { el: win });
  };
  w.eval(read('billing-catalog.js'));
  w.eval(read('billing-ui.js'));
  assert.equal(w.PanthoriumBilling.open(), true);
  const root = w.document.querySelector('[data-billing-root]');
  assert.equal(root.querySelectorAll('.pb-card').length, 4);
  root.querySelector('[data-product-id="work-pro"]').click();
  assert.match(root.querySelector('.pb-total').textContent, /1,089 บาท/);
  assert.equal(root.querySelector('.pb-primary').disabled, true, 'no payment before backend verification is integrated');
  assert.equal(root.querySelectorAll('input:not([type=checkbox])').length, 0, 'never collect card data for an unconfigured checkout');
  root.querySelector('.pb-back').click();
  assert.equal(root.querySelectorAll('.pb-card').length, 4);
  root.querySelectorAll('.pb-tab')[1].click();
  root.querySelector('[data-product-id="voice-s"]').click();
  assert.match(root.querySelector('.pb-summary').textContent, /30 วัน/);
  assert.match(root.querySelector('.pb-total').textContent, /59 บาท/);
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert.equal(root.querySelector('.pb-summary'), null, 'clear stale checkout on account change');
  assert.equal(w.PanthoriumBilling.open(), true);
  assert.equal(restored, 'billing');
  assert.equal(w.document.querySelectorAll('[data-billing-root]').length, 1);
  let paymentCalls=0;
  w.PanthoriumAuth = {getAccessToken:()=> 'fixture-token'};
  w.fetch = async (url, options) => {
    if (url.endsWith('/status')) return {ok:true,json:async()=>({ok:true,checkoutEnabled:true,mode:'test'})};
    paymentCalls++;
    assert.equal(options.headers.Authorization,'Bearer fixture-token');
    const body=JSON.parse(options.body);assert.equal(body.testAcknowledged,true);assert.equal(body.productId,'life');
    return {ok:true,json:async()=>({ok:true,order:{id:'fixture-order',productId:'life',status:'pending',chargeId:'chrg_test_fixture',mode:'test'}})};
  };
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  root.querySelector('.pb-tab').click();
  root.querySelector('[data-product-id="life"]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  let pay=root.querySelector('.pb-primary');assert.equal(pay.disabled,false);
  pay.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(paymentCalls,0,'must acknowledge test mode');
  root.querySelector('input[type=checkbox]').checked=true;pay.click();pay.click();
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(paymentCalls,1,'disable double submit');
  assert.match(root.querySelector('[data-payment-result]').textContent,/รอยืนยันจาก Omise/);
  w.Capacitor = { isNativePlatform: () => true };
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert([...root.querySelectorAll('[data-product-id]')].every(el => el.disabled), 'no web purchase buttons inside the native app');
  dom.window.close();

  const app = express(); app.use(express.json());
  app.use('/api/billing', createBillingRouter({ verifyAccessToken: token => ({ sub: token, roles: token === 'guest' ? ['guest'] : ['user'] }) }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const base = 'http://127.0.0.1:' + server.address().port + '/api/billing';
    const listing = await (await fetch(base + '/catalog')).json();
    assert.equal(listing.checkoutEnabled, false);
    assert.equal(listing.products.find(item => item.id === 'work-pro').amountSatang, 108900);
    const checkout = token => fetch(base + '/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ productId: 'work-pro', amount: 1, status: 'paid' }) });
    assert.equal((await checkout()).status, 401);
    assert.equal((await checkout('guest')).status, 403);
    assert.equal((await checkout('user-1')).status, 503, 'client payment claims cannot grant a subscription');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('Billing UI: catalog, checkout summary, account reset, window reuse, native app restriction and fail-closed checkout passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
