'use strict';
// Read-only deployed probe: no client registration, credentials or paid calls.
const assert = require('node:assert/strict');
(async () => {
  const target = new URL(process.env.MCP_SMOKE_URL).origin;
  const expected = new URL(process.env.MCP_EXPECTED_BASE_URL).origin;
  const get = path => fetch(target + path, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  const metadataResponse = await get('/.well-known/oauth-authorization-server');
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.issuer, expected);
  assert.equal(metadata.authorization_endpoint, expected + '/oauth/authorize');
  assert.equal(metadata.token_endpoint, expected + '/oauth/token');
  assert.ok(metadata.code_challenge_methods_supported.includes('S256'));
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  const resource = await (await get('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(resource.resource, expected + '/mcp');
  assert.deepEqual(resource.authorization_servers, [expected]);
  const mcp = await fetch(target + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), signal: AbortSignal.timeout(30000), redirect: 'error' });
  assert.equal(mcp.status, 401);
  assert.ok(mcp.headers.get('www-authenticate').includes(expected + '/.well-known/oauth-protected-resource/mcp'));
  const setup = await get('/mcp/connect');
  assert.equal(setup.status, 200);
  assert.equal(setup.headers.get('cache-control'), 'no-store');
  assert.match(await setup.text(), /mcp-connect\.js/);
  assert.equal((await get('/mcp-connect.js')).status, 200);
  console.log('Deployed MCP: canonical discovery, PKCE, protected endpoint and account-connection page passed. User OAuth linking remains a separate step.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
