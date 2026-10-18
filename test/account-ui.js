'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
async function main() {
  const dom = new JSDOM('<div id="windows"></div>', { runScripts: 'outside-only', url: 'https://panthorium.test/' });
  const w = dom.window, requests = [], logins = [];
  w.OS = { state: { user: { id: 'guest:1', roles: ['guest'] } }, config: {}, windows: new Map() };
  let signups = 0, logouts = 0;
  w.PanthoriumVoiceIdentity = { openRegistration: () => { signups++; } };
  w.PanthoriumAuth = {
    isGuest: () => w.OS.state.user.roles.includes('guest'), getBackendUrl: () => '',
    login: async (...args) => { logins.push(args); }, savePassword: async () => {},
    logout: async () => { logouts++; w.OS.state.user = { id: 'guest:2', roles: ['guest'] }; w.dispatchEvent(new w.Event('panthorium:auth-changed')); }
  };
  w.createWindow = (id, title, html) => {
    const el = w.document.createElement('div'); el.className = 'window'; el.dataset.id = id; el.innerHTML = html;
    w.document.getElementById('windows').appendChild(el); w.OS.windows.set(id, { el });
  };
  w.PanthoriumWindowManager = { restore: () => {}, close: id => { w.OS.windows.get(id)?.el.remove(); w.OS.windows.delete(id); } };
  w.fetch = async (path, options) => { requests.push({ path, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; };
  w.eval(fs.readFileSync(require.resolve('../account-ui.js'), 'utf8'));
  const ui = w.PanthoriumAccounts;
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  ui.openRegistration(); assert.ok(w.document.querySelector('[data-registration-form]')); assert.equal(signups, 0); w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  ui.openLogin(); ui.openLogin(); assert.equal(w.document.querySelectorAll('.window').length, 1);
  const root = w.document.querySelector('[data-account-root]');
  root.querySelector('[data-login-email]').value = 'test@example.com';
  root.querySelector('[data-login-password]').value = 'test-password-123';
  root.querySelector('[data-login-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(); assert.deepEqual(logins[0], ['test@example.com', 'test-password-123', false]);
  assert.equal(w.document.querySelector('[data-account-root]'), null);
  ui.openForgot();
  const reset = w.document.querySelector('[data-account-root]');
  reset.querySelector('[data-reset-email]').value = 'test@example.com';
  reset.querySelector('[data-reset-request-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(); assert.equal(requests[0].path, '/api/auth/password/forgot');
  reset.querySelector('[data-reset-code]').value = '123456';
  reset.querySelector('[data-reset-password]').value = 'new-password-123';
  reset.querySelector('[data-reset-password-confirm]').value = 'mismatch-password';
  reset.querySelector('[data-reset-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(); assert.equal(requests.length, 1, 'mismatch never reaches the API');
  reset.querySelector('[data-reset-password-confirm]').value = 'new-password-123';
  reset.querySelector('[data-reset-form]').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(); assert.equal(requests[1].path, '/api/auth/password/reset');
  assert.equal(requests[1].body.confirmPassword, 'new-password-123');
  assert.equal(reset.querySelector('[data-reset-password]').value, '');
  w.OS.state.user = { id: 'user:1', email: 'test@example.com', roles: ['user'] };
  w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert.equal(w.document.querySelectorAll('[data-account-root]').length, 0, 'account changes discard credentials and OTP forms');
  ui.openLogout(); assert.equal(logouts, 0, 'opening the logout window does not revoke the session');
  w.document.querySelector('[data-logout-cancel]').click(); assert.equal(logouts, 0);
  ui.openLogout(); w.document.querySelector('[data-logout-confirm]').click(); await tick();
  assert.equal(logouts, 1); assert.equal(w.document.querySelectorAll('[data-account-root]').length, 0);
  dom.window.close();
  console.log('Account windows: separate registration/login/reset/logout, single-window restore, API paths, validation and secret clearing passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
