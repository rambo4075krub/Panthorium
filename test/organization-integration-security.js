'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { OrganizationRepository } = require('../services/organizationRepository');
const { OrganizationService } = require('../services/organizationService');
const { OrganizationResourceService } = require('../services/organizationResourceService');
const { OrganizationGovernanceService } = require('../services/organizationGovernanceService');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out: ' + label)), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
const rejected = result => result.status === 'rejected';
const succeeded = result => result.status === 'fulfilled';
const code = error => error.code || error.message;

// Shared adverse scenarios: memory mode checks service integration in one process;
// organization-postgres-security.js supplies independent repositories and pools.
async function runSecurityScenarios(repositories, { exerciseAuditCapacity = true } = {}) {
  const ids = Object.fromEntries(['ownerA', 'ownerB', 'writer', 'reader', 'outsider'].map(name => [name, randomUUID()]));
  const accounts = new Map(Object.values(ids).map(id => [id, { id, email: id + '@example.test', username: 'Test account', emailVerifiedAt: new Date().toISOString() }]));
  const authRepository = {
    findUserById: async id => accounts.get(id) || null,
    findUserByEmail: async email => [...accounts.values()].find(item => item.email === email) || null
  };
  const suspendedAccounts = new Set();
  const validatePrincipal = async principal => {
    if (suspendedAccounts.has(principal.sub)) throw Object.assign(new Error('account_suspended'), { status: 403 });
    return principal;
  };
  const user = name => ({ sub: ids[name], permissions: ['chat'], roles: ['user'] });
  const organizations = repositories.map(repository => new OrganizationService({ repository, authRepository, validatePrincipal }));
  const resources = organizations.map(service => new OrganizationResourceService({ organizations: service }));
  const governance = organizations.map(service => new OrganizationGovernanceService({ organizations: service }));
  const orgId = (await organizations[0].create(user('ownerA'), { name: 'Isolated organization A', profile: 'small' })).organization.id;
  const otherOrgId = (await organizations[1].create(user('outsider'), { name: 'Isolated organization B', profile: 'micro' })).organization.id;
  async function join(name, role = 'member', targetOrg = orgId) {
    const invitation = await organizations[0].invite(user('ownerA'), targetOrg, { email: accounts.get(ids[name]).email, role, clearance: 'confidential' });
    return organizations[1].acceptInvitation(user(name), { token: invitation.token });
  }
  await join('ownerB', 'owner');
  await join('writer');
  await join('reader');
  const getMember = async name => repositories[1].read(orgId, tx => tx.get('membership', ids[name]));
  async function memberChange(name, patch) {
    const membership = await getMember(name);
    return organizations[0].updateMember(user('ownerA'), orgId, ids[name], { ...patch, version: membership.version });
  }
  const create = (input = {}) => resources[0].create({ user: user('writer'), orgId,
    input: { kind: 'document', title: 'Need-to-know source', body: 'ORG-A-SECRET-' + randomUUID(), ...input } });

  const privateDocument = await create();
  await assert.rejects(() => resources[1].get({ user: user('ownerA'), orgId, resourceId: privateDocument.id }), /org_resource_not_found/,
    'Organization owner must not bypass another member\'s private ACL');
  await assert.rejects(() => resources[1].get({ user: user('outsider'), orgId: otherOrgId, resourceId: privateDocument.id }), /org_resource_not_found/);
  await assert.rejects(() => resources[1].get({ user: user('outsider'), orgId, resourceId: privateDocument.id }), /org_access_denied/);
  await assert.rejects(() => resources[1].export({ user: user('writer'), orgId, resourceId: privateDocument.id }), /org_access_denied/,
    'Read permission alone must not authorize export');
  assert.deepEqual(await resources[1].list({ user: user('outsider'), orgId: otherOrgId, q: privateDocument.title }), []);

  // Even an authenticated requester who guesses an ID receives no classification,
  // title, version binding, approval count, or content existence signal.
  const hidden = await governance[1].requestAccess(user('reader'), orgId, { resourceId: privateDocument.id, access: 'read', reason: 'Review my assigned task' });
  const unknown = await governance[1].requestAccess(user('reader'), orgId, { resourceId: randomUUID(), access: 'read', reason: 'Review my assigned task' });
  assert.deepEqual(Object.keys(hidden.request).sort(), Object.keys(unknown.request).sort());
  assert.equal(hidden.request.status, unknown.request.status);
  for (const field of ['title', 'body', 'classification', 'requiredApprovals', 'resourceVersion', 'organizationPolicyVersion', 'requesterMembershipVersion']) {
    assert.equal(Object.hasOwn(hidden.request, field), false, 'Requester must not learn ' + field);
  }
  await assert.rejects(() => governance[1].approveRequest(user('reader'), orgId, hidden.request.id, { expectedVersion: 1 }), /self_approval_forbidden/);

  // Two distinct actors race the same version of a confidential access request.
  // Both approvals must count, but a stale client must reload before its vote.
  const confidential = await create({ classification: 'confidential', editorIds: [ids.ownerA] });
  const approval = (await governance[1].requestAccess(user('reader'), orgId,
    { resourceId: confidential.id, access: 'read', reason: 'Need this document for assigned work' })).request;
  const approvers = ['writer', 'ownerA'];
  const votes = await Promise.allSettled(approvers.map((name, i) => governance[i].approveRequest(user(name), orgId, approval.id, { expectedVersion: approval.version })));
  assert.equal(votes.filter(succeeded).length, 1);
  assert.equal(votes.filter(rejected).length, 1);
  assert.match(code(votes.find(rejected).reason), /version_conflict/);
  const first = votes.find(succeeded).value.request;
  assert.equal(first.status, 'pending');
  assert.equal(first.approvals.length, 1);
  await assert.rejects(() => resources[1].get({ user: user('reader'), orgId, resourceId: confidential.id }), /org_resource_not_found/);
  const remaining = votes.findIndex(rejected);
  const granted = await governance[remaining].approveRequest(user(approvers[remaining]), orgId, approval.id, { expectedVersion: first.version });
  assert.equal(granted.request.status, 'approved');
  assert.equal(granted.request.approvals.length, 2);
  const persisted = await repositories[1].read(orgId, tx => tx.get('resource', confidential.id));
  assert.equal(persisted.version, confidential.version + 1, 'The final grant must advance the resource exactly once');
  assert.equal(persisted.readerIds.filter(id => id === ids.reader).length, 1);
  assert.equal((await resources[1].get({ user: user('reader'), orgId, resourceId: confidential.id })).body, confidential.body);

  // Duplicate approval deliveries from independently instantiated services may
  // authorize only one grant. No replay can re-apply the write.
  const single = await create();
  const oneRequest = (await governance[0].requestAccess(user('reader'), orgId,
    { resourceId: single.id, access: 'read', reason: 'Single reviewer request' })).request;
  const duplicate = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => governance[i % 2].approveRequest(user('writer'), orgId, oneRequest.id, { expectedVersion: oneRequest.version })));
  assert.equal(duplicate.filter(succeeded).length, 1);
  assert(duplicate.filter(rejected).every(result => /version_conflict|not_pending/.test(code(result.reason))));
  assert.equal((await repositories[1].read(orgId, tx => tx.get('resource', single.id))).version, single.version + 1);
  const grants = await repositories[1].read(orgId, async tx => (await tx.list('audit')).filter(event => event.event === 'resource_access_granted' && event.details.requestId === oneRequest.id));
  assert.equal(grants.length, 1, 'The audit must record one grant despite duplicate approval delivery');

  // Offboarding commits on worker A; worker B must use current membership even
  // though the caller still carries the same previously valid principal.
  await memberChange('reader', { status: 'suspended' });
  await assert.rejects(() => resources[1].get({ user: user('reader'), orgId, resourceId: confidential.id }), /org_access_denied/);
  await assert.rejects(() => governance[1].listRequests(user('reader'), orgId), /org_access_denied/);
  await memberChange('reader', { status: 'active' });

  const staleApproverDocument = await create({ classification: 'confidential', editorIds: [ids.ownerA] });
  const staleApproverRequest = (await governance[1].requestAccess(user('reader'), orgId,
    { resourceId: staleApproverDocument.id, access: 'read', reason: 'Prior reviewer leaves before quorum' })).request;
  const partialApproval = await governance[0].approveRequest(user('writer'), orgId, staleApproverRequest.id, { expectedVersion: staleApproverRequest.version });
  await memberChange('writer', { status: 'suspended' });
  await assert.rejects(() => governance[1].approveRequest(user('ownerA'), orgId, staleApproverRequest.id, { expectedVersion: partialApproval.request.version }), /approval_context_changed/,
    'A suspended earlier approver must not count toward the final quorum');
  await memberChange('writer', { status: 'active' });

  async function pendingDocument(reason) {
    const document = await create();
    const request = (await governance[1].requestAccess(user('reader'), orgId, { resourceId: document.id, access: 'read', reason })).request;
    return { document, request };
  }
  const staleAcl = await pendingDocument('ACL version changes during review');
  await resources[0].update({ user: user('writer'), orgId, resourceId: staleAcl.document.id,
    patch: { readerIds: [ids.ownerB], expectedVersion: staleAcl.document.version } });
  await assert.rejects(() => governance[1].approveRequest(user('writer'), orgId, staleAcl.request.id, { expectedVersion: staleAcl.request.version }), /context_changed/);
  assert.equal((await repositories[1].read(orgId, tx => tx.get('resource', staleAcl.document.id))).readerIds.includes(ids.reader), false);
  assert.equal((await repositories[1].read(orgId, tx => tx.get('accessRequest', staleAcl.request.id))).status, 'rejected', 'Invalidation must commit even though the API reports a conflict');

  const staleMember = await pendingDocument('Membership changes during review');
  await memberChange('reader', { status: 'suspended' });
  await memberChange('reader', { status: 'active' });
  await assert.rejects(() => governance[1].approveRequest(user('writer'), orgId, staleMember.request.id, { expectedVersion: staleMember.request.version }), /context_changed/,
    'Reactivation must not resurrect approval bound to a previous membership version');

  const stalePolicy = await pendingDocument('Organization policy changes during review');
  let organization = (await organizations[0].get(user('ownerA'), orgId)).organization;
  await organizations[0].update(user('ownerA'), orgId, { version: organization.version, policy: { aiEnabled: true } });
  await assert.rejects(() => governance[1].approveRequest(user('writer'), orgId, stalePolicy.request.id, { expectedVersion: stalePolicy.request.version }), /context_changed/);

  // The provider completion starts with valid rights, then another worker
  // suspends the requesting member before completion. The draft must be withheld.
  const inputReachedProvider = deferred(), providerDone = deferred();
  const aiService = new OrganizationResourceService({ organizations: organizations[1], complete: async () => {
    inputReachedProvider.resolve();
    await providerDone.promise;
    return { text: JSON.stringify({ draft: 'MUST-NOT-BE-DELIVERED-AFTER-REVOCATION', sourceIds: [], unknowns: [], nextActions: [] }) };
  } });
  const aiDocument = await create({ aiAllowed: true, readerIds: [ids.reader] });
  const aiResult = aiService.summarize({ user: user('reader'), orgId, resourceId: aiDocument.id, expectedVersion: aiDocument.version });
  // Attach the rejection observer before changing rights to avoid unhandled
  // rejection if a contract regression rejects earlier than expected.
  const observedAi = aiResult.then(value => ({ value }), error => ({ error }));
  try {
    await within(inputReachedProvider.promise, 'AI provider entry');
    await memberChange('reader', { status: 'suspended' });
  } finally { providerDone.resolve(); }
  const outcome = await within(observedAi, 'AI post-revocation response');
  assert(outcome.error, 'Revoked AI requester must not receive a late draft');
  assert.equal(code(outcome.error), 'org_access_denied');

  const accountProviderEntered = deferred(), accountProviderDone = deferred();
  const accountAiService = new OrganizationResourceService({ organizations: organizations[1], complete: async () => {
    accountProviderEntered.resolve();
    await accountProviderDone.promise;
    return { text: JSON.stringify({ draft: 'MUST-NOT-BE-DELIVERED-AFTER-ACCOUNT-SUSPENSION', sourceIds: [], unknowns: [], nextActions: [] }) };
  } });
  const accountAi = accountAiService.summarize({ user: user('writer'), orgId, resourceId: aiDocument.id, expectedVersion: aiDocument.version });
  const observedAccountAi = accountAi.then(value => ({ value }), error => ({ error }));
  try {
    await within(accountProviderEntered.promise, 'account-wide AI provider entry');
    suspendedAccounts.add(ids.writer);
  } finally { accountProviderDone.resolve(); }
  const accountOutcome = await within(observedAccountAi, 'AI account revalidation');
  assert(accountOutcome.error, 'Account-wide suspension must deny output even while organization membership remains active');
  assert.equal(code(accountOutcome.error), 'org_account_access_denied');
  suspendedAccounts.delete(ids.writer);

  // Mutation rollback must not leave even a partial ACL or audit event.
  const beforeRollback = await repositories[0].read(orgId, tx => tx.get('resource', privateDocument.id));
  await assert.rejects(() => repositories[0].transact(orgId, async tx => {
    await tx.put('resource', privateDocument.id, { ...beforeRollback, readerIds: [ids.outsider] }, beforeRollback.version);
    throw new Error('injected_before_commit');
  }), /injected_before_commit/);
  assert.deepEqual(await repositories[1].read(orgId, tx => tx.get('resource', privateDocument.id)), beforeRollback);
  await assert.rejects(() => repositories[0].read(orgId, tx => tx.put('resource', privateDocument.id, beforeRollback)), /read_only_transaction/);

  if (exerciseAuditCapacity) {
    // Fill the former 2000-event ceiling. Security changes must remain possible
    // without dropping history. This is a regression for offboarding lockout.
    const auditOrg = (await organizations[0].create(user('ownerA'), { name: 'Audit capacity regression', profile: 'micro' })).organization.id;
    await join('writer', 'member', auditOrg);
    await repositories[0].transact(auditOrg, async tx => {
      for (let i = 0; i < 2001; i++) await tx.put('audit', randomUUID(), {
        actorId: ids.ownerA, event: 'test.audit_capacity', target: { kind: 'organization', id: auditOrg }, details: {}, occurredAt: new Date().toISOString()
      });
    });
    const member = await repositories[1].read(auditOrg, tx => tx.get('membership', ids.writer));
    await organizations[1].updateMember(user('ownerA'), auditOrg, ids.writer, { version: member.version, status: 'revoked' });
    await assert.rejects(() => organizations[0].get(user('writer'), auditOrg), /org_access_denied/);
    const events = await organizations[1].listAudit(user('ownerA'), auditOrg);
    assert(events.events.some(event => event.event === 'membership.updated'), 'Revocation evidence must be retained after the old audit ceiling');
    assert(events.events.length <= 200, 'Audit reads must remain bounded');
    const seen = new Set();
    let cursor;
    do {
      const page = await organizations[1].listAudit(user('ownerA'), auditOrg, { limit: 137, cursor });
      assert(page.events.length <= 137);
      for (const event of page.events) {
        assert.equal(seen.has(event.id), false, 'Keyset pagination must not repeat audit events');
        seen.add(event.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 2005, 'Pagination must retain 2001 seeded events plus creation, invitation, acceptance and revocation');
  }

  // Two owners try to demote each other at once. The second transaction must
  // re-read the actor's reduced authority rather than trust its old role.
  const ownerA = await getMember('ownerA'), ownerB = await getMember('ownerB');
  const demotions = await Promise.allSettled([
    organizations[0].updateMember(user('ownerA'), orgId, ids.ownerB, { version: ownerB.version, role: 'member' }),
    organizations[1].updateMember(user('ownerB'), orgId, ids.ownerA, { version: ownerA.version, role: 'member' })
  ]);
  assert.equal(demotions.filter(succeeded).length, 1);
  assert.equal(demotions.filter(rejected).length, 1);
  const finalMembers = await repositories[1].read(orgId, tx => tx.list('membership'));
  const activeOwners = finalMembers.filter(member => member.role === 'owner' && member.status === 'active');
  assert.equal(activeOwners.length, 1, 'Concurrent demotions must preserve an active owner');
  return { orgId, otherOrgId, activeOwnerId: activeOwners[0].userId };
}

async function main() {
  const repository = new OrganizationRepository({ allowMemory: true, required: false });
  await repository.init();
  await runSecurityScenarios([repository, repository]);
  console.log('Organization security integration passed (single-process memory): tenant isolation, need-to-know, immutable approvals, suspension and ACL/policy freshness, AI late-output denial, rollback, audit capacity and last-owner races. Real PostgreSQL is a separate gate.');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runSecurityScenarios };
