'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { newDb } = require('pg-mem');
const { McpOAuthRepository } = require('../services/mcpOAuthRepository');
const { McpOAuthService, DEFAULT_REDIRECT } = require('../services/mcpOAuthService');

const USER_ID = '2c3dc380-9807-4915-b498-e5f1ada346cc';
const OTHER_ID = '4c3dc380-9807-4915-b498-e5f1ada346cc';
const VERIFIER = 'a'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

async function fixture(pool) {
  let now = Date.UTC(2026, 0, 1);
  let version = 0;
  let suspended = false;
  let permissions = ['chat', 'system:read'];
  const repository = new McpOAuthRepository({ pool, required: !!pool, allowMemory: !pool, now: () => now });
  await repository.init();
  const authService = {
    repository: { findUserById: async id => [USER_ID, OTHER_ID].includes(id) ? { id, username: 'test-user', roles: [], permissions } : null },
    accountPolicy: async () => ({ credentialVersion: version }),
    validateAccountPrincipal: async principal => {
      if (suspended) throw new Error('account_suspended');
      if (principal.accountVersion !== version) throw new Error('account_session_revoked');
      return { ...principal, permissions };
    }
  };
  const oauth = new McpOAuthService({ repository, authService, baseUrl: 'https://panthorium.example', now: () => now });
  const client = await oauth.registerClient({ client_name: 'ChatGPT', redirect_uris: [DEFAULT_REDIRECT], token_endpoint_auth_method: 'none' });
  const request = () => oauth.beginAuthorize({ client_id: client.client_id, redirect_uri: DEFAULT_REDIRECT, response_type: 'code', code_challenge_method: 'S256', code_challenge: CHALLENGE, state: 'state-value', scope: 'panthorium:read panthorium:media', resource: oauth.resource });
  const authorize = async () => {
    const pending = await request();
    const redirect = new URL((await oauth.approveAuthorization({ requestId: pending.requestId, user: { sub: USER_ID, accountVersion: version } })).redirectUrl);
    assert.equal(redirect.searchParams.get('state'), 'state-value');
    assert.equal(redirect.searchParams.get('iss'), oauth.baseUrl);
    return { code: redirect.searchParams.get('code'), pending };
  };
  const exchange = code => oauth.exchangeToken({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: VERIFIER, redirect_uri: DEFAULT_REDIRECT, resource: oauth.resource });
  const issue = async () => exchange((await authorize()).code);
  return { oauth, repository, client, request, authorize, exchange, issue, change: values => {
    if (values.version != null) version = values.version;
    if (values.suspended != null) suspended = values.suspended;
    if (values.permissions) permissions = values.permissions;
    if (values.advance) now += values.advance;
  } };
}

async function rejectsCode(promise, code) { await assert.rejects(promise, error => error.code === code, code); }

async function runCore(pool) {
  const f = await fixture(pool);
  const { oauth, client } = f;
  assert.equal(oauth.metadata().code_challenge_methods_supported[0], 'S256');
  await rejectsCode(oauth.registerClient({ redirect_uris: ['https://attacker.example/callback'] }), 'invalid_redirect_uri');
  await rejectsCode(oauth.registerClient({ redirect_uris: [DEFAULT_REDIRECT], token_endpoint_auth_method: 'client_secret_post' }), 'invalid_client_metadata');
  await rejectsCode(oauth.beginAuthorize({ client_id: client.client_id, redirect_uri: `${DEFAULT_REDIRECT}?different=1` }), 'invalid_redirect_uri');
  await rejectsCode(oauth.beginAuthorize({ client_id: client.client_id, redirect_uri: DEFAULT_REDIRECT, response_type: 'code', code_challenge_method: 'plain', code_challenge: VERIFIER }), 'invalid_request');

  const pending = await f.request();
  const view = await oauth.getAuthorizationRequest(pending.requestId);
  assert.equal(view.client.client_id, client.client_id);
  assert.equal('challenge' in view, false);
  assert.equal('state' in view, false);
  await rejectsCode(oauth.approveAuthorization({ requestId: pending.requestId, user: { sub: 'guest:abc', roles: ['guest'] } }), 'access_denied');
  const denied = new URL((await oauth.approveAuthorization({ requestId: pending.requestId, user: { sub: USER_ID }, approved: false })).redirectUrl);
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  await rejectsCode(oauth.getAuthorizationRequest(pending.requestId), 'invalid_request');

  const { code } = await f.authorize();
  await rejectsCode(oauth.exchangeToken({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: 'b'.repeat(64), redirect_uri: DEFAULT_REDIRECT }), 'invalid_grant');
  const tokens = await f.exchange(code);
  await rejectsCode(f.exchange(code), 'invalid_grant');
  const authenticated = await oauth.authenticate(tokens.access_token);
  assert.equal(authenticated.user.sub, USER_ID);
  assert.deepEqual(authenticated.scopes, ['panthorium:media', 'panthorium:read']);
  await rejectsCode(oauth.authenticate('eyJhbGciOiJIUzI1NiJ9.ui.jwt'), 'invalid_token');
  f.change({ permissions: ['chat'] });
  assert.deepEqual((await oauth.authenticate(tokens.access_token)).user.permissions, ['chat']);

  const rotate = token => oauth.exchangeToken({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: token, resource: oauth.resource });
  const rotated = await rotate(tokens.refresh_token);
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  await oauth.authenticate(rotated.access_token);
  await rejectsCode(rotate(tokens.refresh_token), 'invalid_grant');
  await rejectsCode(oauth.authenticate(rotated.access_token), 'invalid_token');
  await rejectsCode(rotate(rotated.refresh_token), 'invalid_grant');

  const versionTokens = await f.issue();
  f.change({ version: 1 });
  await rejectsCode(oauth.authenticate(versionTokens.access_token), 'invalid_token');
  await rejectsCode(rotate(versionTokens.refresh_token), 'invalid_grant');
  const fresh = await f.issue();
  f.change({ suspended: true });
  await rejectsCode(oauth.authenticate(fresh.access_token), 'invalid_token');
  f.change({ suspended: false });
  const identity = await oauth.authenticate(fresh.access_token);
  const grants = await oauth.listGrants({ sub: USER_ID, accountVersion: 1 });
  assert(grants.some(grant => grant.grantId === identity.grantId));
  assert.equal((await oauth.revokeGrant({ sub: OTHER_ID, accountVersion: 1 }, identity.grantId)).revoked, false);
  await oauth.authenticate(fresh.access_token);
  await oauth.revoke({ token: fresh.refresh_token, client_id: client.client_id });
  await rejectsCode(oauth.authenticate(fresh.access_token), 'invalid_token');

  const expiring = await f.issue();
  f.change({ advance: 60 * 60 * 1000 + 1 });
  await rejectsCode(oauth.authenticate(expiring.access_token), 'invalid_token');
  await rotate(expiring.refresh_token);
  const expiredRequest = await f.request();
  f.change({ advance: 10 * 60 * 1000 + 1 });
  await rejectsCode(oauth.getAuthorizationRequest(expiredRequest.requestId), 'invalid_request');
}

async function concurrency() {
  const f = await fixture();
  const { code } = await f.authorize();
  const results = await Promise.allSettled([f.exchange(code), f.exchange(code)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const tokens = results.find(result => result.status === 'fulfilled').value;
  const rotate = () => f.oauth.exchangeToken({ grant_type: 'refresh_token', client_id: f.client.client_id, refresh_token: tokens.refresh_token });
  const rotations = await Promise.allSettled([rotate(), rotate()]);
  assert.equal(rotations.filter(result => result.status === 'fulfilled').length, 1);
  const winner = rotations.find(result => result.status === 'fulfilled').value;
  await rejectsCode(f.oauth.authenticate(winner.access_token), 'invalid_token');
}

(async () => {
  await assert.rejects(new McpOAuthRepository().init(), /database_required/);
  await runCore();
  await concurrency();
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  try { await runCore(pool); } finally { await pool.end(); }
  console.log('MCP OAuth: PKCE, account policy, expiry, one-time codes, refresh replay, revocation, ownership, and PostgreSQL path passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
