const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('crypto');
const { AuthService } = require('../services/authService');
const { installGuestAccess, restrictedPaths } = require('../middleware/guestAccess');
const { createApiRouter } = require('../routes/api');
const { createBiometricsRouter } = require('../routes/biometrics');
const { createAuthRouter } = require('../routes/auth');
const { createMemoryRouter } = require('../routes/memory');
const { AgentMemoryService } = require('../services/agentMemoryService');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const catalog = require('../voice-window-catalog');

(async () => {
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'guest-access-test-secret', accessTokenTtl: '1h' }, audit });
  const guest = auth.guest().principal;
  const user = { id: 'user-test', roles: [], permissions: ['chat', 'system:read', 'settings', 'sentinel:command'] };
  const admin = { id: 'admin-test', roles: ['administrator'], permissions: ['chat', 'settings', 'system:read', 'sentinel:command'] };
  const excluded = ['settings', 'security', 'ai-platform', 'sentinel-agent', 'agent-automation', 'memory-knowledge', 'multi-agent', 'integrations', 'training-lab', 'production', 'governance', 'sentinel-control'];
  const guestSessionId = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(auth.guest({ guestSessionId }).principal.id, auth.guest({ guestSessionId }).principal.id, 'same tab session id maps to stable guest profile owner');
  assert.notEqual(auth.guest().principal.id, auth.guest().principal.id, 'missing guest session id remains random');
  const sentinel = { status: () => ({ ready: true }), providerCatalog: () => [], chat: async () => ({ ok: true, text: 'test reply' }) };
  const agent = new AgentService({ tools: new ToolRegistry({ sentinel }), audit });
  const biometricOwners = [];
  const biometrics = {
    status: () => ({ configured: true, gateEnabled: false }),
    list: async ownerUserId => { biometricOwners.push(ownerUserId); return []; },
    enroll: async input => { biometricOwners.push(input.ownerUserId); return { profileId: 'voice-test', ownerUserId: input.ownerUserId, subjectType: input.subjectType }; },
    remove: async () => true,
    verify: async ({ ownerUserId }) => { biometricOwners.push(ownerUserId); return { ok: true, matched: false }; }
  };
  const deviceKey = 'b'.repeat(64);
  const deviceHash = crypto.createHash('sha256').update(deviceKey).digest('hex');
  const protectedGuestId = 'guest:' + guestSessionId;
  const deviceRepository = {
    findGuestOwnerByDeviceKeyHash: async hash => hash === deviceHash ? protectedGuestId : null,
    isDeviceBoundGuestOwner: async owner => owner === protectedGuestId
  };
  const app = express(); app.use(express.json()); installGuestAccess(app, auth);
  app.use('/api/auth', createAuthRouter(auth, { isProduction: false, refreshTokenDays: 30 }, null, deviceRepository));
  app.use('/api/biometrics', createBiometricsRouter(auth, biometrics));
  const memoryOwners = [];
  const memory = new AgentMemoryService({ repository: { list: async userId => { memoryOwners.push(userId); return []; } }, audit });
  app.use('/api/agent/memory', createMemoryRouter(auth, memory));
  app.use('/api', createApiRouter(sentinel, auth, audit, {}, agent, {}, {}, {}, {}));
  // Verify every namespace is denied before any service side effect.
  let serviceCalls = 0;
  app.all('*', (req, res) => { serviceCalls++; res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, principal, body) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(principal ? { Authorization: 'Bearer ' + auth.signAccessToken(principal) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const noDevice = await (await call('/api/auth/guest', null, { guestSessionId })).json();
    assert.notEqual(noDevice.user.id, protectedGuestId, 'known voice owner requires its device credential');
    const recognized = await (await call('/api/auth/guest', null, { guestSessionId: crypto.randomUUID(), deviceKey })).json();
    assert.equal(recognized.user.id, protectedGuestId, 'remembered device restores guest voice owner');
    assert.equal(recognized.deviceRecognized, true);
    const userNotes = await call('/api/agent/memory?limit=30', user);
    assert.equal(userNotes.status, 200, 'signed-in standard user can load personal cloud notes');
    assert.deepEqual((await userNotes.json()).memories, []);
    assert.deepEqual(memoryOwners, [user.id], 'notes remain scoped to the authenticated user id');
    const guestNotes = await call('/api/agent/memory?limit=30', guest);
    assert.equal(guestNotes.status, 403, 'guest cannot read personal cloud notes');
    assert.deepEqual(memoryOwners, [user.id], 'guest denial occurs before any memory data access');
    for (const route of restrictedPaths) {
      const url = route + '/access-check';
      assert.equal((await call(url, null)).status, 401);
      assert.equal((await call(url, guest)).status, 403, route);
      assert.equal((await call(url, { ...guest, permissions: admin.permissions })).status, 403, 'guest cannot bypass the exclusion using broad permissions');
      assert.equal((await call(url, user)).status, 403, 'registered standard user cannot access back-office APIs even with broad permissions');
      assert.equal((await call(url, admin)).status, 200, route);
    }
    assert.equal(serviceCalls, restrictedPaths.length);
    for (const entry of catalog.apps) {
      const guestAllowed = !entry.accountRequired && !excluded.includes(entry.id);
      assert.equal(catalog.allowed(entry, guest), guestAllowed, entry.id);
      assert.equal(catalog.allowed(entry, admin), true, entry.id);
      assert.equal(catalog.allowed(entry, user), !excluded.includes(entry.id), 'standard user access: ' + entry.id);
      const res = await call('/api/sentinel/command', guest, { command: 'เปิด ' + entry.aliases[0] });
      assert.equal(res.status, excluded.includes(entry.id) || entry.accountRequired ? 403 : 200, entry.id);
    }
    assert.equal(catalog.allowed(catalog.apps.find(entry => entry.id === 'voice-identity'), guest), true, 'guest can open voice enrollment');
    assert.equal((await call('/api/biometrics/status', guest)).status, 200, 'guest can read non-sensitive enrollment status');
    assert.equal((await call('/api/biometrics/voice/profiles', guest)).status, 200, 'guest can list only its own voice profiles');
    assert.equal((await call('/api/biometrics/voice/profiles', guest, { subjectType: 'user' })).status, 201, 'guest can enroll user voice');
    assert.equal((await call('/api/biometrics/voice/profiles', guest, { subjectType: 'family' })).status, 201, 'guest can enroll family voice');
    assert.equal((await call('/api/biometrics/voice/profiles', guest, { subjectType: 'user', ownerUserId: admin.id, actorRoles: ['administrator'] })).status, 201, 'request body cannot override authenticated voice owner');
    assert.equal((await call('/api/biometrics/voice/profiles', guest, { subjectType: 'administrator' })).status, 403, 'guest cannot enroll an administrator voice');
    assert.equal((await call('/api/biometrics/voice/profiles', admin, { subjectType: 'administrator' })).status, 201, 'administrator can enroll an administrator voice from the admin context');
    assert.equal((await call('/api/biometrics/voice/verify', guest, { audio: 'unused-by-fixture' })).status, 200, 'guest can verify their own temporary profiles');
    assert(biometricOwners.includes(admin.id), 'administrator voice enrollment stays on the administrator owner');
    assert(biometricOwners.filter(owner => owner !== admin.id).every(owner => owner === guest.id), 'guest voice data stays scoped to its guest session id');
    assert.equal((await call('/api/sentinel/command', guest, { command: 'ค้นความรู้ private' })).status, 403);
    assert.equal((await call('/api/chat', guest, { message: 'hello' })).status, 200);
    assert.equal((await call('/api/sentinel/status', guest)).status, 200);
    console.log('Access control: all 12 exclusions enforced for guest and standard users; admin retained; public apps remain available');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
