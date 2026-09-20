const assert = require('node:assert/strict');
const express = require('express');
const { AuthService } = require('../services/authService');
const { installGuestAccess, restrictedPaths } = require('../middleware/guestAccess');
const { createApiRouter } = require('../routes/api');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const catalog = require('../voice-window-catalog');

(async () => {
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'guest-access-test-secret', accessTokenTtl: '1h' }, audit });
  const guest = auth.guest().principal;
  const admin = { id: 'admin-test', roles: ['administrator'], permissions: ['chat', 'settings', 'system:read', 'sentinel:command'] };
  const excluded = ['settings', 'security', 'ai-platform', 'sentinel-agent', 'agent-automation', 'memory-knowledge', 'multi-agent', 'integrations', 'training-lab', 'production', 'governance', 'sentinel-control'];
  const sentinel = { status: () => ({ ready: true }), providerCatalog: () => [], chat: async () => ({ ok: true, text: 'test reply' }) };
  const agent = new AgentService({ tools: new ToolRegistry({ sentinel }), audit });
  const app = express(); app.use(express.json()); installGuestAccess(app, auth);
  app.use('/api', createApiRouter(sentinel, auth, audit, {}, agent, {}, {}, {}, {}));
  // Verify every namespace is denied before any service side effect.
  let serviceCalls = 0;
  app.all('*', (req, res) => { serviceCalls++; res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, principal, body) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(principal ? { Authorization: 'Bearer ' + auth.signAccessToken(principal) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const route of restrictedPaths) {
      const url = route + '/access-check';
      assert.equal((await call(url, null)).status, 401);
      assert.equal((await call(url, guest)).status, 403, route);
      assert.equal((await call(url, { ...guest, permissions: admin.permissions })).status, 403, 'guest cannot bypass the exclusion using broad permissions');
      assert.equal((await call(url, admin)).status, 200, route);
    }
    assert.equal(serviceCalls, restrictedPaths.length);
    for (const entry of catalog.apps) {
      assert.equal(catalog.allowed(entry, guest), !excluded.includes(entry.id), entry.id);
      assert.equal(catalog.allowed(entry, admin), true, entry.id);
      const res = await call('/api/sentinel/command', guest, { command: 'เปิด ' + entry.aliases[0] });
      assert.equal(res.status, excluded.includes(entry.id) ? 403 : 200, entry.id);
    }
    assert.equal((await call('/api/sentinel/command', guest, { command: 'ค้นความรู้ private' })).status, 403);
    assert.equal((await call('/api/chat', guest, { message: 'hello' })).status, 200);
    assert.equal((await call('/api/sentinel/status', guest)).status, 200);
    console.log('Guest access: all 12 exclusions enforced; admin retained; chat, status, Sentinel AI and six external apps allowed; API and direct commands cannot bypass exclusions');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
