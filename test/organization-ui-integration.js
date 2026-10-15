'use strict';

// Exercise browser-generated requests against the actual three routers and
// services. Only authentication/account fixtures and window chrome are stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { JSDOM } = require('jsdom');
const { OrganizationRepository } = require('../services/organizationRepository');
const { OrganizationService } = require('../services/organizationService');
const { OrganizationResourceService } = require('../services/organizationResourceService');
const { OrganizationGovernanceService } = require('../services/organizationGovernanceService');
const { createOrganizationsRouter } = require('../routes/organizations');
const { createOrganizationResourcesRouter } = require('../routes/organizationResources');
const { createOrganizationGovernanceRouter } = require('../routes/organizationGovernance');
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate, label) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('Timed out: ' + label); await pause(); }
}

async function main() {
  const accountRows = ['alice', 'bob', 'charlie'].map(id => ({ id, username: id, email: id + '@example.test', emailVerifiedAt: '2026-01-01T00:00:00.000Z' }));
  const authRepository = {
    async findUserById(id) { return structuredClone(accountRows.find(row => row.id === id) || null); },
    async findUserByEmail(email) { return structuredClone(accountRows.find(row => row.email === email) || null); }
  };
  const authService = {
    verifyAccessToken(token) { if (!accountRows.some(row => row.id === token)) throw new Error('invalid_token'); return { sub: token, permissions: ['chat'], roles: [] }; },
    async validateAccountPrincipal(user) { return user; }
  };
  const repository = new OrganizationRepository({ allowMemory: true, required: false });
  await repository.init();
  const organizations = new OrganizationService({ repository, authRepository });
  const resources = new OrganizationResourceService({ organizations });
  const governance = new OrganizationGovernanceService({ organizations });
  const app = express();
  app.use(express.json({ limit: '2mb', type: 'application/json' }));
  app.use('/api/organizations', createOrganizationsRouter(authService, organizations));
  app.use('/api/organizations', createOrganizationResourcesRouter(authService, resources));
  app.use('/api/organizations', createOrganizationGovernanceRouter(authService, governance));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browsers = [], traffic = [];
  function browser(id) {
    const dom = new JSDOM('<!doctype html><body></body>', { url: base + '/', runScripts: 'outside-only' });
    const window = dom.window;
    const state = { dom, window, pending: 0, hold: null, errors: [] };
    browsers.push(state);
    window.OS = { state: { user: { sub: id, permissions: ['chat'], roles: [] } }, config: { backendUrl: base, accessToken: id } };
    window.createWindow = (windowId, title, markup) => {
      const node = window.document.createElement('section'); node.className = 'window'; node.dataset.id = windowId; node.innerHTML = markup; window.document.body.append(node);
    };
    window.closeWindow = windowId => window.document.querySelector('.window[data-id="' + windowId + '"]')?.remove();
    window.addEventListener('error', event => state.errors.push(event.error || event.message));
    window.fetch = async (url, options = {}) => {
      state.pending++;
      try {
        const response = await fetch(url, options);
        const record = { owner: id, path: new URL(url).pathname, method: options.method || 'GET', status: response.status, body: options.body ? JSON.parse(options.body) : undefined };
        traffic.push(record);
        const hold = state.hold;
        if (hold && hold.matches(record)) { state.hold = null; hold.reached = true; await hold.promise; }
        return response;
      } finally { state.pending--; }
    };
    for (const file of ['organization-catalog.js', 'organizations-ui.js']) window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    state.find = selector => window.document.querySelector(selector);
    state.all = selector => [...window.document.querySelectorAll(selector)];
    state.text = () => window.document.body.textContent;
    return state;
  }
  async function settle(ui) {
    await until(() => ui.pending === 0, 'browser requests complete');
    await pause();
    await until(() => ui.pending === 0, 'follow-up browser requests complete');
    await pause();
    assert.deepEqual(ui.errors, []);
  }
  function required(ui, selector) { const node = ui.find(selector); assert.ok(node, 'Missing UI control: ' + selector + '\n' + ui.text()); return node; }
  function set(form, name, value) { const input = form.querySelector('[data-field="' + name + '"]'); assert.ok(input, 'Missing field ' + name); input.value = value; return input; }
  function selectMany(form, name, values) { const input = form.querySelector('[data-field="' + name + '"]'); assert.ok(input); for (const option of input.options) option.selected = values.includes(option.value); }
  async function click(ui, selector) { const node = required(ui, selector); await node.onclick({ currentTarget: node, preventDefault() {} }); await settle(ui); }
  async function clickText(ui, text, within) { const node = [...(within || ui.window.document).querySelectorAll('button')].find(button => button.textContent === text); assert.ok(node, 'Missing button ' + text); await node.onclick({ currentTarget: node, preventDefault() {} }); await settle(ui); }
  async function submit(ui, form) { await form.onsubmit({ preventDefault() {} }); await settle(ui); }
  async function tab(ui, name) { await click(ui, '[data-org-tab="' + name + '"]'); }
  async function choose(ui, orgId) { const control = required(ui, '[data-org-switch]'); control.value = orgId; await control.onchange({ target: control }); await settle(ui); }
  function holdNext(ui, matches) { let release; const hold = { matches, reached: false, promise: new Promise(resolve => { release = resolve; }) }; ui.hold = hold; return { hold, release }; }

  try {
    const alice = browser('alice'), bob = browser('bob');
    await alice.window.PanthoriumOrganizations.open(); await settle(alice);
    let form = required(alice, '[data-field="name"]').closest('form');
    set(form, 'name', 'Workspace A'); set(form, 'profile', 'small'); set(form, 'compartments', 'finance, projects');
    await submit(alice, form);
    const orgA = required(alice, '[data-org-switch]').value;
    assert.equal(required(alice, '[data-org-tab="overview"]').getAttribute('aria-pressed'), 'true');
    assert.ok(alice.text().includes('Workspace A'));

    await click(alice, '[data-org-create]');
    form = required(alice, '[data-field="name"]').closest('form');
    set(form, 'name', 'Workspace B'); await submit(alice, form);
    const orgB = required(alice, '[data-org-switch]').value;
    assert.notEqual(orgA, orgB);
    await choose(alice, orgA);

    await tab(alice, 'members');
    form = required(alice, '[data-field="email"]').closest('form');
    set(form, 'email', 'bob@example.test'); await submit(alice, form);
    const invitation = required(alice, '[data-field="invitationToken"]').value;
    assert.ok(invitation.startsWith(orgA + '.'));
    assert.ok(alice.text().includes('ยังไม่ได้ส่งอีเมล'));

    await bob.window.PanthoriumOrganizations.open(); await settle(bob);
    await click(bob, '[data-org-join]');
    form = required(bob, '[data-field="token"]').closest('form'); set(form, 'token', invitation); await submit(bob, form);
    assert.equal(required(bob, '[data-org-switch]').value, orgA);
    assert.equal(bob.find('[data-field="token"]'), null);
    assert.equal(bob.find('[data-org-tab="audit"]'), null);

    await tab(alice, 'teams');
    form = required(alice, 'form[data-team-id="new"]'); set(form, 'name', 'Delivery team'); selectMany(form, 'memberIds', ['bob']); await submit(alice, form);
    const teamForm = alice.all('form[data-team-id]').find(node => node.dataset.teamId !== 'new');
    assert.ok(teamForm); const teamId = teamForm.dataset.teamId;
    assert.equal(teamForm.querySelector('[data-field="name"]').value, 'Delivery team');

    await tab(alice, 'resources'); await click(alice, '[data-create-resource]');
    form = required(alice, '[data-field="title"]').closest('form');
    set(form, 'title', 'Private roadmap'); set(form, 'body', 'PRIVATE-BODY-BEFORE-SHARING'); await submit(alice, form);
    const resourceId = required(alice, '[data-resource-detail]').dataset.resourceDetail;
    assert.equal(required(alice, '[data-resource-detail] pre').textContent, 'PRIVATE-BODY-BEFORE-SHARING');
    await click(alice, '[data-edit-resource]');
    form = required(alice, '[data-field="title"]').closest('form');
    assert.equal(form.querySelector('[data-field="kind"]').disabled, true);
    set(form, 'title', 'Private roadmap v2'); set(form, 'body', 'CURRENT-ROADMAP-BODY'); await submit(alice, form);
    assert.ok(alice.text().includes('v2'));
    form = required(alice, 'form [data-field="body"]').closest('form'); set(form, 'body', 'PRIVATE-COMMENT-BEFORE-SHARING'); await submit(alice, form);
    assert.ok(alice.text().includes('PRIVATE-COMMENT-BEFORE-SHARING'));

    await tab(bob, 'resources'); assert.equal(bob.find('[data-resource-id="' + resourceId + '"]'), null);
    await tab(bob, 'approvals');
    form = required(bob, '[data-field="resourceId"]').closest('form'); set(form, 'resourceId', resourceId); set(form, 'reason', 'Review delivery schedule'); await submit(bob, form);
    const requestId = required(bob, '[data-access-request]').dataset.accessRequest;
    assert.ok(!required(bob, '[data-access-request]').textContent.includes('Private roadmap'));
    assert.equal([...required(bob, '[data-access-request]').querySelectorAll('button')].length, 0);
    await tab(alice, 'approvals');
    await clickText(alice, 'อนุมัติ', required(alice, '[data-access-request="' + requestId + '"]'));
    assert.ok(required(alice, '[data-access-request="' + requestId + '"]').textContent.includes('approved'));

    await tab(bob, 'resources'); await click(bob, '[data-resource-id="' + resourceId + '"]');
    assert.equal(required(bob, '[data-resource-detail] pre').textContent, 'CURRENT-ROADMAP-BODY');
    assert.equal(bob.find('[data-edit-resource]'), null);
    assert.ok(!bob.text().includes('PRIVATE-COMMENT-BEFORE-SHARING'));
    form = required(bob, 'form [data-field="body"]').closest('form'); set(form, 'body', 'Shared review comment'); await submit(bob, form);
    assert.ok(bob.text().includes('Shared review comment'));
    await clickText(bob, 'ดูประวัติรุ่น');
    assert.ok(!bob.text().includes('PRIVATE-BODY-BEFORE-SHARING'));

    // Task-specific fields, team picker and assignment must survive the real
    // service's strict unknown-field and assignee-read-access checks.
    await tab(alice, 'resources'); await click(alice, '[data-create-resource]');
    form = required(alice, '[data-field="title"]').closest('form');
    set(form, 'title', 'Team delivery task'); const kind = set(form, 'kind', 'task'); kind.onchange();
    set(form, 'visibility', 'team'); selectMany(form, 'teamIds', [teamId]); selectMany(form, 'assigneeIds', ['bob']); set(form, 'taskStatus', 'in_progress'); set(form, 'dueAt', '2026-11-01T10:30');
    await submit(alice, form);
    const taskId = required(alice, '[data-resource-detail]').dataset.resourceDetail;
    assert.ok(alice.text().includes('in_progress'));
    await tab(bob, 'resources'); await click(bob, '[data-resource-id="' + taskId + '"]'); assert.ok(bob.text().includes('in_progress'));

    // Invitation secrets and displayed resource data are discarded when the
    // organization changes; the UI does not write them to browser storage.
    await tab(alice, 'members'); form = required(alice, '[data-field="email"]').closest('form'); set(form, 'email', 'charlie@example.test'); await submit(alice, form);
    const secondInvitation = required(alice, '[data-field="invitationToken"]').value;
    await choose(alice, orgB);
    assert.equal(alice.find('[data-invitation-receipt]'), null);
    assert.ok(!alice.window.document.body.innerHTML.includes(secondInvitation));
    assert.ok(!alice.text().includes('CURRENT-ROADMAP-BODY'));
    assert.ok(!alice.text().includes('Shared review comment'));
    for (const ui of [alice, bob]) { assert.equal(ui.window.localStorage.length, 0); assert.equal(ui.window.sessionStorage.length, 0); }

    // A real old-organization response arriving after a switch must not render
    // into the new organization's main panel.
    await choose(alice, orgA); await tab(alice, 'resources');
    const delayed = holdNext(alice, record => record.method === 'GET' && record.path.endsWith('/resources/' + resourceId));
    const item = required(alice, '[data-resource-id="' + resourceId + '"]'); item.onclick({ currentTarget: item });
    await until(() => delayed.hold.reached, 'old organization response fetched');
    const switcher = required(alice, '[data-org-switch]'); switcher.value = orgB; await switcher.onchange({ target: switcher });
    delayed.release(); await settle(alice);
    assert.equal(required(alice, '[data-org-switch]').value, orgB);
    assert.equal(alice.find('[data-resource-detail]'), null);
    assert.ok(!alice.text().includes('CURRENT-ROADMAP-BODY'));

    // Switching account removes the entire old window, including loaded data.
    bob.window.OS.state.user = { sub: 'alice', permissions: ['chat'], roles: [] };
    bob.window.OS.config.accessToken = 'alice';
    bob.window.dispatchEvent(new bob.window.Event('panthorium:auth-changed'));
    assert.equal(bob.find('[data-organizations]'), null);
    assert.ok(!bob.text().includes('Team delivery task'));
    assert.deepEqual(traffic.filter(record => record.status >= 400), [], 'All browser-generated API requests must satisfy real routes');
    const edit = traffic.find(record => record.method === 'PATCH' && record.path.endsWith('/resources/' + resourceId));
    assert.equal(edit.body.kind, undefined); assert.equal(edit.body.expectedVersion, 1);
    console.log('Organization UI integration passed: ' + traffic.length + ' real HTTP requests, two accounts, organizations, invitations, teams, resources, comments, approval and scoped data clearing');
  } finally {
    for (const ui of browsers) ui.dom.window.close();
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
