'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'mcp-connect.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'mcp-connect.js'), 'utf8');
const actionId = '294fe5d4-b1aa-42bc-8e69-45784843c524';
const approvalHash = 'b'.repeat(64);
const session = { accessToken:'private-ui-session', user:{ sub:'owner-1', username:'<img src=x onerror=alert(1)>', roles:['user'] } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) { for (let n = 0; n < 100; n++) { if (predicate()) return; await sleep(5); } throw new Error(message); }
function setup(url, handler) {
  const dom = new JSDOM(html, { url:'https://panthorium.test' + url, runScripts:'outside-only' });
  const w = dom.window, calls = [];
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('JWT must not enter localStorage'); } });
  Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('JWT must not enter sessionStorage'); } });
  w.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    if (!url.startsWith('/api/auth/')) assert.equal(options.headers.Authorization, 'Bearer private-ui-session');
    const result = await handler(url, options, body, calls);
    return { ok:(result.status || 200) < 400, status:result.status || 200, json:async () => result.data };
  };
  w.eval(script);
  return { dom, w, d:w.document, calls };
}
function noSecretsInDom(d) { assert(!d.documentElement.outerHTML.includes(session.accessToken)); assert(!d.documentElement.outerHTML.includes(approvalHash)); assert.equal(d.querySelectorAll('[onerror], [onclick]').length, 0); }

async function main() {
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert(html.includes('src="/mcp-connect.js"'));
  let consentCalls = 0;
  const consent = setup('/oauth/authorize?redirect_uri=https://evil.test', async (url, options, body) => {
    if (url === '/api/auth/refresh') return { data:session };
    if (url === '/oauth/request') return { data:{ requestId:'server-flow', csrfToken:'server-csrf', client:{ client_name:'<img src=x onerror=alert(1)>' }, scopes:['panthorium:read','panthorium:media'], expiresAt:Date.now() + 600000 } };
    if (url === '/oauth/authorize') { consentCalls++; assert.equal(options.method, 'POST'); assert.deepEqual(body, { requestId:'server-flow', csrfToken:'server-csrf', approve:false }); return { status:400, data:{ error:'invalid_request' } }; }
    throw new Error('Unexpected ' + url);
  });
  await until(() => !consent.d.getElementById('consent-panel').hidden, 'Consent did not load');
  assert.equal(consentCalls, 0, 'Consent must never be granted on page load');
  assert.equal(consent.d.getElementById('client-name').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(consent.d.querySelectorAll('#scope-list li').length, 2);
  noSecretsInDom(consent.d);
  consent.d.getElementById('deny-button').click();
  await until(() => consentCalls === 1 && consent.d.getElementById('status').dataset.kind === 'error', 'Denial was not explicit');
  assert(!consent.calls.some(call => String(call.url).includes('evil.test')));
  consent.dom.window.close();

  let actionState = 'awaiting_confirmation', confirmationCalls = 0;
  const action = setup('/mcp/approve?actionId=' + actionId, async (url, options, body) => {
    if (url === '/api/auth/refresh') return { data:session };
    if (url === '/api/actions/' + actionId) return { data:{ ok:true, action:{ actionId, toolId:'media.video.generate', args:{ prompt:'<script>alert(1)</script>', durationSeconds:8 }, description:'A video', risk:'high', state:actionState, approvalHash, approvalExpiresAt:new Date(Date.now()+600000).toISOString() } } };
    if (url.endsWith('/confirm')) { confirmationCalls++; assert.deepEqual(body, { approvalHash }); actionState = 'succeeded'; return { data:{ ok:true, actionState } }; }
    throw new Error('Unexpected ' + url);
  });
  await until(() => !action.d.getElementById('action-panel').hidden, 'Action did not load');
  assert.equal(confirmationCalls, 0, 'Action must never execute before a click');
  assert.equal(action.d.getElementById('paid-notice').hidden, false);
  assert.equal(action.d.querySelectorAll('#action-args script').length, 0);
  noSecretsInDom(action.d);
  action.d.getElementById('confirm-action').click();
  action.d.getElementById('confirm-action').click();
  await until(() => action.d.getElementById('action-state').textContent === 'ดำเนินการสำเร็จ', 'Approved result did not load');
  assert.equal(confirmationCalls, 1, 'Double clicks cannot duplicate confirmation');
  assert.equal(action.d.getElementById('action-buttons').hidden, true);
  assert(!action.w.location.href.includes(approvalHash));
  action.dom.window.close();

  let expiredCalls = 0;
  const expired = setup('/mcp/approve?actionId=' + actionId, async url => {
    if (url === '/api/auth/refresh') return { data:session };
    if (url === '/api/actions/' + actionId) return { data:{ action:{ actionId, toolId:'media.video.render', args:{}, state:'awaiting_confirmation', approvalHash, approvalExpiresAt:new Date(Date.now()-1000).toISOString() } } };
    expiredCalls++; throw new Error('Expired approval must never be submitted');
  });
  await until(() => !expired.d.getElementById('action-panel').hidden, 'Expired action did not load');
  assert.equal(expired.d.getElementById('confirm-action').disabled, true);
  expired.d.getElementById('confirm-action').dispatchEvent(new expired.w.Event('click'));
  assert.equal(expiredCalls, 0);
  expired.dom.window.close();

  let grantRevoked = false, loginCalls = 0;
  const connections = setup('/mcp/connect', async (url, options, body) => {
    if (url === '/api/auth/refresh') return { status:401, data:{ error:'invalid_refresh_token' } };
    if (url === '/api/auth/login') { loginCalls++; assert.deepEqual(body, { username:'owner', password:'user-secret', rememberMe:false }); return { data:session }; }
    if (url === '/oauth/grants') return { data:{ grants:grantRevoked ? [] : [{ grantId:actionId, clientName:'ChatGPT', scopes:['panthorium:read'], createdAt:Date.now(), expiresAt:Date.now()+600000 }] } };
    if (url === '/oauth/grants/' + actionId) { assert.equal(options.method, 'DELETE'); grantRevoked = true; return { data:{ ok:true } }; }
    throw new Error('Unexpected ' + url);
  });
  await until(() => !connections.d.getElementById('login-panel').hidden, 'Login did not appear');
  assert.equal(connections.d.getElementById('mcp-endpoint').textContent, 'https://panthorium.test/mcp');
  connections.d.getElementById('username').value = 'owner'; connections.d.getElementById('password').value = 'user-secret';
  connections.d.getElementById('login-form').dispatchEvent(new connections.w.Event('submit', { cancelable:true }));
  await until(() => connections.d.querySelector('.grant'), 'Connected grant did not load');
  assert.equal(loginCalls, 1);
  assert.equal(connections.d.getElementById('password').value, '');
  noSecretsInDom(connections.d);
  connections.d.querySelector('.grant-header button').click();
  assert.equal(grantRevoked, false, 'Opening revoke review does not revoke');
  connections.d.querySelector('.revoke-confirm button').click();
  await until(() => grantRevoked && !connections.d.querySelector('.grant'), 'Grant was not revoked');
  connections.dom.window.close();
  console.log('MCP connect UI: login, explicit consent, XSS-safe display, paid action approval, expiry and grant revocation passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
