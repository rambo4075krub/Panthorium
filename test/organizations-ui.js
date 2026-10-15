'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(require.resolve('../' + name), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { for (let i = 0; i < 150; i++) { if (predicate()) return; await sleep(10); } throw Error(label); }

async function main() {
  const dom = new JSDOM('<div id="desktop-icons">original desktop</div><div id="orb">original orb</div><div id="sm-apps"><button class="sm-app" data-app-id="privacy-policy">Privacy</button><button class="sm-app" data-app-id="admin" hidden>Admin</button></div>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://panthorium.test' });
  const w = dom.window, d = w.document;
  w.OS = { config: { accessToken: 'fixture-token', backendUrl: '' }, state: { user: { id: 'u1', roles: ['user'], permissions: ['chat'] } }, windows: new Map() };
  w.PanthoriumWindowManager = { restore() {} };
  w.createWindow = (id, title, html) => { const win = d.createElement('div'); win.className = 'window'; win.dataset.id = id; win.innerHTML = '<div class="window-titlebar"></div><div class="window-body">' + html + '</div>'; d.body.append(win); w.OS.windows.set(id, win); };
  w.closeWindow = id => { w.OS.windows.get(id)?.remove(); w.OS.windows.delete(id); };
  let login = 0, report = null;
  w.PanthoriumAccounts = { openLogin() { login++; } }; w.PanthoriumPrivacyPolicy = { openAIReport(target) { report = target; } };
  Object.defineProperty(w, 'localStorage', { get() { throw Error('No organization user data in local storage'); } });
  Object.defineProperty(w, 'sessionStorage', { get() { throw Error('No organization session persistence'); } });
  const policy = { aiEnabled: false, exportEnabled: false, allowExternalGuests: false, maxAiClassification: 'internal' };
  const orgs = [{ id: 'org1', name: 'Alpha', profile: 'small', policy, version: 2, compartmentCatalog: ['finance'] }, { id: 'org2', name: 'Beta', profile: 'security', policy, version: 3, compartmentCatalog: [] }];
  let orgRole = 'owner', teamOnly = false, resourceCaps = { read: true, write: true, share: true, comment: true, export: false, ai: true, delete: true };
  let resource = { id: 'r1', kind: 'document', title: '<img src=x onerror=alert(1)>', body: 'private organization body', classification: 'internal', visibility: 'private', version: 4, aiAllowed: false, exportAllowed: false, readerIds: ['u2'], editorIds: [], teamIds: [], compartments: [] };
  const members = [{ userId: 'u1', role: 'owner', status: 'active', version: 2, displayName: 'Owner', clearance: 'confidential', compartments: ['finance'] }, { userId: 'u2', role: 'member', status: 'active', version: 3, displayName: 'Colleague', clearance: 'internal', compartments: [] }];
  const orgResponse = org => ({ ok: true, organization: org, membership: { ...members[0], role: orgRole }, capabilities: { manageMembers: orgRole === 'owner', manageTeams: orgRole === 'owner' && !teamOnly, managePolicy: orgRole === 'owner', viewAudit: orgRole === 'owner', createResource: orgRole !== 'viewer' } });
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  let calls = [], pendingOrg = null, pendingDetail = null, failNextPolicy = false;
  w.fetch = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-token'); assert.equal(options.credentials, 'include');
    const parsed = new URL(url, w.location.origin), path = parsed.pathname.replace('/api/organizations', ''), method = options.method || 'GET', body = options.body && JSON.parse(options.body);
    calls.push({ path, method, body, query: parsed.searchParams });
    if (path === '' && method === 'GET') return response({ ok: true, organizations: orgs.map(organization => ({ organization, membership: members[0] })), readiness: { durable: true, pilotLimits: { members: 200, teams: 100 } } });
    if (path === '' && method === 'POST') { const created = { ...orgs[0], ...body, id: 'created' }; orgs.push(created); return response(orgResponse(created)); }
    if (/^\/[^/]+$/.test(path)) {
      if (pendingOrg && path === '/org1' && method === 'GET') await pendingOrg;
      const org = orgs.find(org => '/' + org.id === path);
      if (method === 'PATCH') { if (failNextPolicy) { failNextPolicy = false; return response({ ok: false, error: 'org_version_conflict' }, 409); } Object.assign(org, body, { version: org.version + 1 }); }
      return response(orgResponse(org));
    }
    if (path.endsWith('/members')) return response({ ok: true, members });
    if (path.includes('/members/')) return response({ ok: true, membership: members[1] });
    if (path.endsWith('/teams') && method === 'GET') return response({ ok: true, teams: [{ id: 't1', name: 'Editorial', memberIds: ['u1', 'u2'], managerIds: ['u1'], parentId: null, version: 7, canManage: teamOnly }] });
    if (path.includes('/teams')) return response({ ok: true, team: { id: 't1', ...body } });
    if (path.endsWith('/invitations')) return response({ ok: true, invitation: { email: body.email }, token: 'secret-once' });
    if (path === '/invitations/accept') return response(orgResponse(orgs[0]));
    if (path.endsWith('/resources') && method === 'GET') return response({ ok: true, resources: [{ ...resource, capabilities: resourceCaps }] });
    if (path.endsWith('/resources') && method === 'POST') { resource = { ...resource, ...body, version: 1 }; return response({ ok: true, resource: { ...resource, capabilities: resourceCaps } }); }
    if (/\/resources\/r1$/.test(path)) { if (pendingDetail && method === 'GET') await pendingDetail; if (method === 'PATCH') resource = { ...resource, ...body, version: resource.version + 1 }; return response({ ok: true, resource: { ...resource, capabilities: resourceCaps } }); }
    if (path.endsWith('/comments')) return response({ ok: true, comments: [], comment: { id: 'comment1' } });
    if (path.endsWith('/revisions')) return response({ ok: true, revisions: [{ resourceVersion: 1, title: 'old', body: '<script>unsafe()</script>' }] });
    if (path.endsWith('/summarize')) return response({ ok: true, summary: { text: '<img src=x> draft', resourceVersion: resource.version } });
    if (path.endsWith('/access-requests')) return response({ ok: true, requests: [{ id: 'a1', resourceId: 'r1', access: 'read', status: 'pending', version: 8, requesterId: 'u2', canApprove: true, canReject: true, requiredApprovals: 1 }], request: { id: 'a1' } });
    if (/\/access-requests\/a1\/(approve|reject)$/.test(path)) return response({ ok: true, request: { status: 'approved' } });
    if (path.endsWith('/audit')) return response({ ok: true, events: [{ action: 'resource.created', targetId: 'r1' }], nextCursor: parsed.searchParams.has('cursor') ? null : 'opaque:cursor' });
    throw Error('Unexpected API ' + method + ' ' + path);
  };
  w.eval(read('start-menu-ui.js')); w.PanthoriumStartMenuUI.pinLast('privacy-policy'); w.eval(read('window-theme-ui.js')); w.eval(read('organization-catalog.js')); w.eval(read('organizations-ui.js')); d.dispatchEvent(new w.Event('DOMContentLoaded'));
  await until(() => d.querySelector('[data-start-group="organizations"]'), 'organization category missing');
  assert.equal(d.getElementById('sm-apps').lastElementChild.dataset.appId, 'privacy-policy');
  w.PanthoriumStartMenuUI.filter('องค์กรและทีม', d.getElementById('sm-apps'));
  assert.equal(d.querySelector('[data-app-id="organizations"]').dataset.searchHidden, undefined); assert.equal(d.querySelector('[data-app-id="admin"]').hidden, true);
  await w.PanthoriumOrganizations.open();
  const q = selector => d.querySelector('[data-organizations] ' + selector), mainText = () => q('[data-org-main]').textContent;
  const tab = name => q('[data-org-tab="' + name + '"]').click();
  const submit = form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const field = (form, name) => form.querySelector('[data-field="' + name + '"]');
  const textButton = text => Array.from(q('[data-org-main]').querySelectorAll('button')).find(button => button.textContent === text);
  await until(() => d.querySelector('.window[data-id="organizations"]').dataset.panthoriumTheme === 'reference-glass', 'shared window theme missing');
  assert.equal(q('[data-field="aiEnabled"]').checked, false); assert.equal(q('[data-field="maxAiClassification"]').options.length, 2);
  assert.match(mainText(), /แยก|สิทธิ์/); failNextPolicy = true; submit(q('form')); await until(() => q('[data-org-status]').textContent.includes('ข้อมูลเปลี่ยนแล้ว'), 'optimistic conflict feedback missing');
  tab('members'); await until(() => q('[data-member-id="u2"] form'), 'members missing');
  assert.equal(q('[data-member-id="u1"] form'), null, 'no self-authority edit'); assert.equal(q('[data-member-id="u2"] [data-field="status"] option[value="removed"]'), null);
  const invite = Array.from(q('[data-org-main]').querySelectorAll('form')).find(form => field(form, 'email'));
  field(invite, 'email').value = 'colleague@example.test'; field(invite, 'compartments').options[0].selected = true; submit(invite);
  await until(() => q('[data-invitation-receipt]'), 'invitation missing'); assert.match(q('[data-invitation-receipt]').textContent, /ยังไม่ได้ส่งอีเมล/); assert.deepEqual(calls.find(call => call.path.endsWith('/invitations')).body.compartments, ['finance']);
  tab('teams'); await until(() => q('[data-team-id="t1"]'), 'team editor missing');
  assert.match(q('[data-team-id="t1"] [data-field="memberIds"]').textContent, /Colleague/);
  submit(q('[data-team-id="t1"]')); await until(() => calls.some(call => call.method === 'PATCH' && call.path.endsWith('/teams/t1')), 'team PATCH missing'); assert.equal(calls.find(call => call.path.endsWith('/teams/t1')).body.version, 7);
  tab('resources'); await until(() => q('[data-resource-id="r1"]'), 'resources missing'); q('[data-resource-id="r1"]').click();
  await until(() => q('[data-ai-summary]') && textButton('บันทึกความคิดเห็น'), 'resource details missing'); assert.equal(q('[data-resource-detail] img'), null);
  q('[data-ai-summary]').click(); await until(() => q('[data-org-summary]'), 'AI summary missing'); assert.equal(q('[data-org-summary] img'), null); q('[data-report-org-summary]').click(); assert.deepEqual(JSON.parse(JSON.stringify(report)), { sourceType: 'general' }, 'no organization content enters report API');
  q('[data-edit-resource]').click(); await until(() => q('[data-field="readerIds"]'), 'resource editor missing'); assert(q('[data-field="readerIds"]').multiple); assert(q('[data-field="kind"]').disabled);
  submit(q('form')); await until(() => calls.some(call => call.method === 'PATCH' && call.path.endsWith('/resources/r1')), 'resource PATCH missing'); const edit = calls.find(call => call.method === 'PATCH' && call.path.endsWith('/resources/r1')); assert.equal(edit.body.kind, undefined); assert.equal(edit.body.expectedVersion, 4);
  tab('approvals'); await until(() => q('[data-access-request]'), 'approvals missing'); textButton('อนุมัติ').click(); await until(() => calls.some(call => call.path.endsWith('/a1/approve')), 'approval missing'); assert.deepEqual(calls.find(call => call.path.endsWith('/a1/approve')).body, { expectedVersion: 8 });
  tab('audit'); await until(() => q('[data-audit-more]'), 'audit page missing'); q('[data-audit-more]').click(); await until(() => calls.some(call => call.path.endsWith('/audit') && call.query.get('cursor') === 'opaque:cursor'), 'audit cursor missing');
  // Late content must never cross organization or account boundaries.
  tab('resources'); await until(() => q('[data-resource-id="r1"]'), 'resource reload missing'); let releaseDetail; pendingDetail = new Promise(resolve => { releaseDetail = resolve; }); q('[data-resource-id="r1"]').click();
  q('[data-org-switch]').value = 'org2'; q('[data-org-switch]').dispatchEvent(new w.Event('change'));
  await until(() => mainText().includes('Beta'), 'organization switch failed'); releaseDetail(); pendingDetail = null; await sleep(30); assert(!mainText().includes('private organization body')); assert.equal(q('[data-field="aiEnabled"]').disabled, true);
  let releaseOrg; pendingOrg = new Promise(resolve => { releaseOrg = resolve; }); q('[data-org-switch]').value = 'org1'; q('[data-org-switch]').dispatchEvent(new w.Event('change'));
  q('[data-org-switch]').value = 'org2'; q('[data-org-switch]').dispatchEvent(new w.Event('change')); await until(() => mainText().includes('Beta'), 'second switch failed'); releaseOrg(); pendingOrg = null; await sleep(20); assert(!mainText().includes('Alpha'));
  orgRole = 'manager'; teamOnly = true; q('[data-org-refresh]').click(); await until(() => q('[data-org-status]').textContent.includes('manager'), 'manager refresh missing'); tab('teams'); await until(() => q('[data-team-id="t1"]'), 'assigned manager team missing'); assert.equal(q('[data-team-id="new"]'), null); assert.equal(q('[data-field="parentId"]'), null); submit(q('[data-team-id="t1"]')); await until(() => calls.filter(call => call.path.endsWith('/teams/t1')).length === 2, 'manager update missing'); assert.deepEqual(Object.keys(calls.filter(call => call.path.endsWith('/teams/t1')).at(-1).body).sort(), ['memberIds', 'name', 'version']);
  orgRole = 'viewer'; resourceCaps = { read: true }; q('[data-org-refresh]').click(); await until(() => q('[data-org-status]').textContent.includes('viewer'), 'viewer refresh missing'); assert.equal(q('[data-org-tab="audit"]'), null); tab('resources'); await until(() => q('[data-resource-id="r1"]'), 'viewer list missing'); assert.equal(q('[data-create-resource]'), null); q('[data-resource-id="r1"]').click(); await until(() => q('[data-resource-detail]'), 'viewer detail missing'); assert.equal(q('[data-edit-resource]'), null); assert.equal(q('[data-ai-summary]'), null);
  w.OS.state.user = { id: 'guest_test', roles: ['guest'] }; w.dispatchEvent(new w.Event('panthorium:auth-changed')); await sleep(20); assert.equal(d.querySelector('[data-organizations]'), null); assert.equal(d.querySelector('[data-start-group="organizations"]'), null); assert.equal(await w.PanthoriumOrganizations.open(), false); assert.equal(login, 1);
  assert.equal(d.getElementById('desktop-icons').textContent, 'original desktop'); assert.equal(d.getElementById('orb').textContent, 'original orb');
  dom.window.close(); console.log('Organizations UI: menu/theme, roles, policy, named selectors, versioned actions, safe rendering, scoped summaries, audit paging and stale-account/org isolation passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
