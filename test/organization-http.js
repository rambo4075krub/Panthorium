'use strict';

// Real router composition: core middleware also protects the later resource and
// access-request routers. Storage is deliberately local; PostgreSQL semantics
// are covered by the separate integration test.
const assert = require('node:assert/strict');
const express = require('express');
const { OrganizationRepository } = require('../services/organizationRepository');
const { OrganizationService } = require('../services/organizationService');
const { OrganizationResourceService } = require('../services/organizationResourceService');
const { OrganizationGovernanceService } = require('../services/organizationGovernanceService');
const { createOrganizationsRouter } = require('../routes/organizations');
const { createOrganizationResourcesRouter } = require('../routes/organizationResources');
const { createOrganizationGovernanceRouter } = require('../routes/organizationGovernance');

async function main() {
  const accounts = new Map(['alice', 'bob', 'carol', 'platform-admin', 'guest_session'].map(id => [id, {
    id, email: id + '@example.test', emailVerifiedAt: '2026-01-01T00:00:00.000Z', status: 'active'
  }]));
  const tokens = new Map([...accounts.keys()].map(id => [id, {
    sub: id, permissions: ['chat'], roles: id === 'platform-admin' ? ['admin'] : [], isGuest: id === 'guest_session'
  }]));
  tokens.set('bob-no-chat', { sub: 'bob', permissions: [], roles: [] });
  const authService = {
    verifyAccessToken(token) { if (!tokens.has(token)) throw new Error('invalid_token'); return structuredClone(tokens.get(token)); },
    async validateAccountPrincipal(user) {
      const account = accounts.get(user.sub);
      if (!account || account.status !== 'active') throw Object.assign(new Error('account_suspended'), { status: 403 });
      return user;
    }
  };
  const authRepository = {
    async findUserById(id) { return structuredClone(accounts.get(id) || null); },
    async findUserByEmail(email) { return structuredClone([...accounts.values()].find(account => account.email === email) || null); }
  };
  const repository = new OrganizationRepository({ allowMemory: true, required: false });
  await repository.init();
  const organizations = new OrganizationService({ repository, authRepository });
  const resources = new OrganizationResourceService({ organizations });
  const governance = new OrganizationGovernanceService({ organizations });
  const app = express();
  app.use(express.json({ limit: '2mb', type: 'application/json' }));
  // Keep this order identical to server.js: integration depends on the core
  // router's generic Bearer, origin, content-type and body-shape middleware.
  app.use('/api/organizations', createOrganizationsRouter(authService, organizations));
  app.use('/api/organizations', createOrganizationResourcesRouter(authService, resources));
  app.use('/api/organizations', createOrganizationGovernanceRouter(authService, governance));
  app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/organizations';
  let requests = 0;
  async function request(method, path, token, body, expected, options = {}) {
    const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}), ...options.headers };
    if (body !== undefined && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: options.raw ? body : JSON.stringify(body) } : {}) });
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { assert.fail('Non-JSON response: ' + raw); }
    requests++;
    assert.equal(response.status, expected, method + ' ' + path + ' as ' + token + ': ' + raw);
    assert.equal(response.headers.get('cache-control'), 'no-store', 'organization responses must not be cached');
    return { data, headers: response.headers, raw };
  }

  try {
    for (const path of ['', '/unknown/resources', '/unknown/access-requests']) await request('GET', path, null, undefined, 401);
    await request('GET', '', null, undefined, 401, { headers: { cookie: 'access_token=alice' } });
    await request('GET', '', 'invalid', undefined, 401);
    await request('GET', '', 'guest_session', undefined, 403);
    await request('POST', '', 'guest_session', { name: 'Guest organization' }, 403);
    await request('POST', '', 'alice', { name: 'Forged organization', role: 'owner' }, 400);
    assert.deepEqual((await request('GET', '', 'alice', undefined, 200)).data.organizations, []);

    const created = (await request('POST', '', 'alice', { name: 'Organization A', profile: 'small' }, 201)).data;
    const orgId = created.organization.id;
    const org = '/' + orgId;
    assert.equal(created.membership.role, 'owner');
    assert.equal(created.capabilities.manageMembers, true);
    const foreign = (await request('POST', '', 'carol', { name: 'Organization B' }, 201)).data.organization.id;
    await request('GET', org, 'carol', undefined, 403);
    await request('GET', org, 'platform-admin', undefined, 403);

    // The common middleware must apply to every mounted router, not only CRUD
    // endpoints declared in routes/organizations.js.
    for (const path of ['', org + '/resources', org + '/access-requests']) {
      await request('POST', path, 'alice', {}, 403, { headers: { 'sec-fetch-site': 'cross-site' } });
      await request('POST', path, 'alice', '{}', 415, { raw: true, headers: { 'content-type': 'text/plain' } });
    }
    await request('POST', org + '/access-requests', 'alice', [], 413);

    const invitation = (await request('POST', org + '/invitations', 'alice', { email: 'bob@example.test', role: 'member', clearance: 'internal' }, 201)).data;
    assert.equal(typeof invitation.token, 'string');
    assert.equal(invitation.invitation.tokenHash, undefined);
    await request('POST', '/invitations/accept', 'carol', { token: invitation.token }, 403);
    const accepted = (await request('POST', '/invitations/accept', 'bob', { token: invitation.token }, 200)).data;
    assert.equal(accepted.membership.role, 'member');
    assert.equal(accepted.capabilities.manageMembers, false);
    await request('POST', '/invitations/accept', 'bob', { token: invitation.token }, 409);
    await request('PATCH', org + '/members/bob', 'bob', { role: 'owner', version: accepted.membership.version }, 403);
    await request('PATCH', org, 'bob', { version: 1, policy: { exportEnabled: true } }, 403);
    await request('POST', org + '/resources', 'bob', { kind: 'document', title: 'Forged owner', ownerId: 'alice' }, 400);
    await request('POST', org + '/access-requests', 'bob', { resourceId: 'unknown', access: 'read', reason: 'Review', role: 'owner' }, 400);

    const configured = (await request('PATCH', org, 'alice', { version: created.organization.version, policy: { exportEnabled: true } }, 200)).data;
    await request('PATCH', org, 'alice', { version: created.organization.version, name: 'Stale change' }, 409);
    assert.equal((await request('GET', org, 'alice', undefined, 200)).data.organization.version, configured.organization.version);
    const resource = (await request('POST', org + '/resources', 'alice', {
      kind: 'document', title: 'Private title marker', body: 'Original private body marker', exportAllowed: true
    }, 201)).data.resource;
    const path = org + '/resources/' + resource.id;
    await request('POST', path + '/comments', 'alice', { body: 'Original private comment marker', expectedVersion: 1 }, 201);
    const hidden = await request('GET', org + '/resources?q=Private', 'bob', undefined, 200);
    assert.deepEqual(hidden.data.resources, []);
    assert.ok(!hidden.raw.includes('Private title marker'));
    for (const suffix of ['', '/revisions', '/comments', '/export']) {
      const denied = await request('GET', path + suffix, 'bob', undefined, 404);
      assert.equal(denied.data.error, 'org_resource_not_found');
      assert.ok(!denied.raw.includes('Private title marker'));
    }
    // A valid resource ID in the wrong tenant cannot fall through to its owner.
    await request('GET', '/' + foreign + '/resources/' + resource.id, 'carol', undefined, 404);
    await request('GET', path, 'carol', undefined, 403);

    const shared = (await request('PATCH', path, 'alice', { readerIds: ['bob'], body: 'Current shared body', expectedVersion: 1 }, 200)).data.resource;
    assert.equal(shared.version, 2);
    await request('PATCH', path, 'alice', { title: 'Stale replacement', expectedVersion: 1 }, 409);
    const bobRead = (await request('GET', path, 'bob', undefined, 200)).data.resource;
    assert.equal(bobRead.body, 'Current shared body');
    assert.equal(bobRead.capabilities.write, false);
    assert.equal(bobRead.capabilities.share, false);
    assert.equal(bobRead.readerIds, undefined);
    const history = (await request('GET', path + '/revisions', 'bob', undefined, 200)).data.revisions;
    assert.deepEqual(history.map(item => item.resourceVersion), [2]);
    assert.ok(!JSON.stringify(history).includes('Original private body marker'));
    assert.deepEqual((await request('GET', path + '/comments', 'bob', undefined, 200)).data.comments, []);
    await request('POST', path + '/comments', 'alice', { body: 'Current shared comment', expectedVersion: 2 }, 201);
    assert.deepEqual((await request('GET', path + '/comments', 'bob', undefined, 200)).data.comments.map(comment => comment.body), ['Current shared comment']);
    await request('PATCH', path, 'bob', { body: 'Forged edit', expectedVersion: 2 }, 403);
    const exported = await request('GET', path + '/export', 'bob', undefined, 200);
    assert.equal(exported.data.resource.body, 'Current shared body');
    assert.match(exported.headers.get('content-disposition'), /^attachment;/);
    await request('GET', path, 'bob-no-chat', undefined, 403);

    // Revoking ACL access must hide current content and historical snapshots on
    // the next HTTP request even with the same already-issued Bearer token.
    await request('PATCH', path, 'alice', { readerIds: [], expectedVersion: 2 }, 200);
    for (const suffix of ['', '/revisions', '/comments', '/export']) await request('GET', path + suffix, 'bob', undefined, 404);
    assert.deepEqual((await request('GET', org + '/resources', 'bob', undefined, 200)).data.resources, []);

    // Requests may name hidden IDs but may not disclose their classification or
    // title, impersonate an approver, or bypass the current resource revision.
    const access = (await request('POST', org + '/access-requests', 'bob', { resourceId: resource.id, access: 'read', reason: 'Need to review current document' }, 201)).data.request;
    assert.equal(access.title, undefined);
    assert.equal(access.requiredApprovals, undefined);
    assert.equal(access.classification, undefined);
    await request('POST', org + '/access-requests/' + access.id + '/approve', 'bob', { expectedVersion: access.version }, 403);
    const granted = (await request('POST', org + '/access-requests/' + access.id + '/approve', 'alice', { expectedVersion: access.version }, 200)).data.request;
    assert.equal(granted.status, 'approved');
    await request('POST', org + '/access-requests/' + access.id + '/approve', 'alice', { expectedVersion: granted.version }, 409);
    await request('GET', path, 'bob', undefined, 200);

    // A team created by core must be usable by the resource router without a
    // second format or permissive test fixtures bypassing the real boundary.
    const team = (await request('POST', org + '/teams', 'alice', { name: 'Review team', memberIds: ['bob'], managerIds: [] }, 201)).data.team;
    const teamDocument = (await request('POST', org + '/resources', 'alice', { kind: 'document', title: 'Team document', visibility: 'team', teamIds: [team.id] }, 201)).data.resource;
    await request('GET', org + '/resources/' + teamDocument.id, 'bob', undefined, 200);

    await request('PATCH', org + '/members/bob', 'alice', { status: 'suspended', version: accepted.membership.version }, 200);
    for (const target of [org, path, path + '/comments', path + '/revisions', org + '/access-requests']) await request('GET', target, 'bob', undefined, 403);
    assert.deepEqual((await request('GET', '', 'bob', undefined, 200)).data.organizations, []);
    accounts.get('alice').status = 'suspended';
    assert.equal((await request('GET', org, 'alice', undefined, 403)).data.error, 'account_suspended');
    console.log('Organization HTTP tests passed: ' + requests + ' requests, router composition, Bearer-only auth, tenancy, invitation one-use, ACL history, approval, and immediate revocation');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
