'use strict';

const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { Pool } = require('pg');
const { McpOAuthRepository } = require('../services/mcpOAuthRepository');
const { McpOAuthService, DEFAULT_REDIRECT } = require('../services/mcpOAuthService');

async function main() {
  // Never use DATABASE_URL: production credentials must not select this test's
  // database. A random, quoted schema is the only namespace created or dropped.
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (process.env.CI) throw new Error('TEST_DATABASE_URL is required for MCP OAuth PostgreSQL integration in CI');
    console.log('SKIP MCP OAuth PostgreSQL integration: TEST_DATABASE_URL is not set. No real database concurrency was tested.');
    return;
  }
  const schema = 'panthorium_mcp_ci_' + randomBytes(10).toString('hex');
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const pools = [];
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (let i = 0; i < 2; i++) pools.push(new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema},public -c statement_timeout=15000 -c lock_timeout=10000`, application_name: 'panthorium-mcp-integration-' + i }));
    const version = await pools[0].query('SHOW server_version_num');
    assert(Number(version.rows[0].server_version_num) >= 120000, 'This gate requires PostgreSQL 12 or later');
    const connections = await Promise.all(pools.map(pool => pool.query('SELECT pg_backend_pid() AS id')));
    assert.notEqual(connections[0].rows[0].id, connections[1].rows[0].id, 'Workers must use independent PostgreSQL connections');

    let now = Date.now();
    const userId = randomUUID();
    const otherUserId = randomUUID();
    let credentialVersion = 0;
    const authService = {
      repository: { findUserById: async id => [userId, otherUserId].includes(id) ? { id, username: 'mcp-integration', roles: [], permissions: ['chat', 'system:read'] } : null },
      accountPolicy: async () => ({ credentialVersion }),
      validateAccountPrincipal: async principal => {
        if (principal.accountVersion !== credentialVersion) throw new Error('account_session_revoked');
        return principal;
      }
    };
    const repositories = pools.map(pool => new McpOAuthRepository({ pool, required: true, now: () => now }));
    for (const repository of repositories) await repository.init();
    const workers = repositories.map(repository => new McpOAuthService({ repository, authService, baseUrl: 'https://mcp-integration.example', now: () => now }));
    const client = await workers[0].registerClient({ client_name: 'PostgreSQL integration', redirect_uris: [DEFAULT_REDIRECT], token_endpoint_auth_method: 'none' });
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const createCode = async () => {
      // Registration, request, and consent deliberately use different workers.
      const request = await workers[1].beginAuthorize({ client_id: client.client_id, redirect_uri: DEFAULT_REDIRECT,
        response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: workers[0].resource,
        scope: 'panthorium:read panthorium:media', state: randomBytes(12).toString('hex') });
      assert.equal((await workers[0].getAuthorizationRequest(request.requestId)).client.client_id, client.client_id);
      const approved = await workers[0].approveAuthorization({ requestId: request.requestId, user: { sub: userId, accountVersion: credentialVersion } });
      return new URL(approved.redirectUrl).searchParams.get('code');
    };
    const exchange = (worker, code) => worker.exchangeToken({ grant_type: 'authorization_code', client_id: client.client_id,
      code, code_verifier: verifier, redirect_uri: DEFAULT_REDIRECT, resource: worker.resource });
    const refresh = (worker, token) => worker.exchangeToken({ grant_type: 'refresh_token', client_id: client.client_id,
      refresh_token: token, resource: worker.resource });
    const rejectedAs = (promise, code) => assert.rejects(promise, error => error.code === code);
    const grantCount = async () => Number((await pools[1].query("SELECT COUNT(*) AS count FROM panthorium_mcp_oauth WHERE kind='grant' AND data->>'clientId'=$1", [client.client_id])).rows[0].count);

    const code = await createCode();
    const redemptions = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => exchange(workers[i % 2], code)));
    assert.equal(redemptions.filter(result => result.status === 'fulfilled').length, 1, 'One authorization code must create exactly one grant across workers');
    assert(redemptions.filter(result => result.status === 'rejected').every(result => result.reason.code === 'invalid_grant'));
    assert.equal(await grantCount(), 1);
    const first = redemptions.find(result => result.status === 'fulfilled').value;
    assert.equal((await workers[1].authenticate(first.access_token)).user.sub, userId);
    const durableRows = (await pools[0].query('SELECT kind,key,data FROM panthorium_mcp_oauth')).rows;
    for (const raw of [code, first.access_token, first.refresh_token]) assert(!JSON.stringify(durableRows).includes(raw), 'Raw bearer credentials must never be stored in PostgreSQL');
    const hashes = durableRows.filter(row => ['code', 'access', 'refresh'].includes(row.kind));
    assert(hashes.every(row => /^[a-f0-9]{64}$/.test(row.key)));

    const rotations = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => refresh(workers[i % 2], first.refresh_token)));
    assert.equal(rotations.filter(result => result.status === 'fulfilled').length, 1, 'Only one worker can consume a refresh token');
    assert(rotations.filter(result => result.status === 'rejected').every(result => result.reason.code === 'invalid_grant'));
    const rotated = rotations.find(result => result.status === 'fulfilled').value;
    // Reuse detected by any losing worker must durably revoke the whole family,
    // including tokens just issued by the successful worker.
    await rejectedAs(workers[0].authenticate(rotated.access_token), 'invalid_token');
    await rejectedAs(workers[1].authenticate(first.access_token), 'invalid_token');
    await rejectedAs(refresh(workers[1], rotated.refresh_token), 'invalid_grant');
    const revoked = (await pools[1].query("SELECT data FROM panthorium_mcp_oauth WHERE kind='grant' AND data->>'clientId'=$1", [client.client_id])).rows[0].data;
    assert.equal(revoked.revocationReason, 'refresh_token_reuse');

    const fresh = await exchange(workers[1], await createCode());
    const grant = await workers[0].authenticate(fresh.access_token);
    assert.equal((await workers[0].revokeGrant({ sub: otherUserId }, grant.grantId)).revoked, false, 'Another account cannot revoke this grant');
    await workers[1].authenticate(fresh.access_token);
    assert.equal((await workers[0].revokeGrant({ sub: userId }, grant.grantId)).revoked, true);
    await rejectedAs(workers[1].authenticate(fresh.access_token), 'invalid_token');
    await rejectedAs(refresh(workers[1], fresh.refresh_token), 'invalid_grant');

    const expiring = await exchange(workers[0], await createCode());
    now += 60 * 60 * 1000 + 1;
    await rejectedAs(workers[1].authenticate(expiring.access_token), 'invalid_token');
    const renewed = await refresh(workers[1], expiring.refresh_token);
    await workers[0].authenticate(renewed.access_token);
    credentialVersion++;
    await rejectedAs(workers[1].authenticate(renewed.access_token), 'invalid_token');
    await rejectedAs(refresh(workers[0], renewed.refresh_token), 'invalid_grant');

    const surviving = await exchange(workers[0], await createCode());
    const restartedRepository = new McpOAuthRepository({ pool: pools[1], required: true, now: () => now });
    await restartedRepository.init();
    const restarted = new McpOAuthService({ repository: restartedRepository, authService, baseUrl: workers[0].baseUrl, now: () => now });
    assert.equal((await restarted.authenticate(surviving.access_token)).user.sub, userId, 'Worker restart must preserve valid grants');
    now += 30 * 86400000 + 1;
    await rejectedAs(restarted.authenticate(surviving.access_token), 'invalid_token');
    await rejectedAs(refresh(restarted, surviving.refresh_token), 'invalid_grant');
    console.log('MCP OAuth PostgreSQL integration passed: independent-worker code and refresh races, durable replay revocation, hash-only credentials, owner isolation, cross-worker disconnect, expiry, account revocation, and restart persistence.');
  } finally {
    const closed = await Promise.allSettled(pools.map(pool => pool.end()));
    let cleanupError = closed.find(result => result.status === 'rejected')?.reason;
    try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    catch (error) { cleanupError ||= error; }
    finally { await admin.end(); }
    if (cleanupError) throw cleanupError;
  }
}

main().catch(error => { console.error('MCP OAuth PostgreSQL integration failed:', error.message); process.exitCode = 1; });
