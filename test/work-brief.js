'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const Ajv = require('ajv/dist/2020');
const { fixture } = require('./work-assistant');
const { WorkBriefService } = require('../services/workBriefService');
const { createWorkBriefRouter, bodyProblem } = require('../routes/workBrief');
const { createHealthProbes } = require('../routes/healthProbes');
const spec = require('../docs/openapi/work-briefs.json');
const rules = require('../work-brief');
const ajv = new Ajv();
for (const [name, schema] of Object.entries(spec.components.schemas)) ajv.addSchema(JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'urn:scheme:')), 'urn:scheme:' + name);
function check(schema, value) {
  const body = JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'urn:scheme:'));
  assert(ajv.validate(body, value), ajv.errorsText());
}
async function withHttp(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn('http://127.0.0.1:' + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function testBriefs(pool) {
  const f = fixture();
  if (pool) { f.repository.pool = pool; await f.repository.init(); }
  let plan = 'free';
  const brief = new WorkBriefService(f.service, { state: async () => ({ plan }) });
  const app = express(); f.authService.verifyAccessToken = token => token === 'owner' ? f.user : f.other;
  app.use(express.json({ limit: '2mb' })); app.use('/api/work/briefs', bodyProblem, createWorkBriefRouter(f.authService, brief));
  const projectId = randomUUID();
  let p = (await f.service.save({ user: f.user, projectId, expectedVersion: 0, patch: { title: 'Film' }, operationId: randomUUID() })).project;
  try { await withHttp(app, async origin => {
    async function request(path, method, { input, token = 'owner', http = 200, body, contentType = 'application/json' } = {}) {
      const key = '/api/work/briefs/' + path;
      const res = await fetch(origin + key, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': contentType },
        ...(input ? { body: JSON.stringify(input) } : body ? { body } : {}) });
      const data = await res.json(); assert.equal(res.status, http, JSON.stringify(data)); assert.match(res.headers.get('cache-control'), /no-store/);
      const operation = spec.paths[key.replace(projectId, '{id}')][method.toLowerCase()];
      if (http === 200 && input) check(operation.requestBody.content['application/json'].schema, input);
      const type = http === 200 ? 'application/json' : 'application/problem+json';
      assert(res.headers.get('content-type').startsWith(type)); check((operation.responses[http] || operation.responses.default).content[type].schema, data);
      if (http !== 200) assert.equal(data.status, http);
      return data;
    }
    const change = (action, input, extra = {}) => request(projectId + '/' + action, 'POST', { input: { operationId: randomUUID(), expectedVersion: p.version, input }, ...extra });
    await request('access', 'GET', { token: '', http: 401 }); assert.equal((await request('access', 'GET')).plan, 'free');
    await request(projectId + '/baseline', 'POST', { body: 'bad JSON', http: 400 });
    await request(projectId + '/baseline', 'POST', { body: 'hello', contentType: 'text/plain', http: 415 });
    await change('baseline', { text: 'other' }, { token: 'other', http: 404 });
    const operation = { operationId: randomUUID(), expectedVersion: p.version, input: { text: rules.sample.baseline } };
    const pin = await request(projectId + '/baseline', 'POST', { input: operation }); p = pin.project;
    assert.equal((await request(projectId + '/baseline', 'POST', { input: operation })).replayed, true);
    await request(projectId + '/baseline', 'POST', { input: { ...operation, input: { text: 'different' } }, http: 409 });
    const b = p.briefBaselines[0];
    const rows = rules.suggest(b.text, rules.sample.request); assert.deepEqual(rows.map(r => r.category), ['clarify', 'extra', 'schedule', 'clarify']);
    assert.equal(rules.suggest(b.text, rules.lines(b.text)[0])[0].category, 'included');
    const decisions = rows.map(({ category, evidence }) => ({ category, evidence }));
    decisions[0] = { category: 'included', evidence: null };
    const input = { baselineId: b.id, request: rules.sample.request, decisions };
    await change('reviews', input, { http: 400 }); decisions[0].evidence = 90; await change('reviews', input, { http: 400 });
    decisions[0].evidence = 1;
    p = (await change('reviews', input)).project; const r = p.briefReviews[0]; assert.match(rules.replyText(r, b), /แก้โลโก้และข้อความได้ 2 รอบ/);
    await request(projectId + '/handover', 'GET', { http: 403 });
    plan = 'life'; assert.match((await request(projectId + '/handover', 'GET')).text, /รอคำตอบ · ขอไฟล์โปรเจกต์/);
    const price = { reviewId: r.id, delivery: '3 ธันวาคม', items: [{ label: 'เพิ่มคลิป', quantity: 3, unitPrice: '600.09' }] };
    await change('quotes', price, { http: 403 }); plan = 'work';
    for (const unitPrice of ['', '0.001', '-1', '1e3']) await change('quotes', { ...price, items: [{ ...price.items[0], unitPrice }] }, { http: 400 });
    await change('quotes', { ...price, plan: 'work-pro' }, { http: 400 });
    const quoteVersion = p.version;
    const race = await Promise.all([1, 2].map(() => brief.change({ user: f.user, projectId, action: 'quotes', body: { input: price, operationId: randomUUID(), expectedVersion: quoteVersion } }).then(result => result.project, e => e.code)));
    assert(race.includes('work_version_conflict')); p = race.find(item => typeof item === 'object');
    assert.equal(p.briefReviews[0].quote.totalSatang, 180027);
    p = (await change('quotes', price)).project;
    assert.match(rules.quoteText(p.briefReviews[0], b), /1,800.27/);
    await change('status', { reviewId: r.id, status: 'accepted' }, { http: 409 });
    p = (await change('status', { reviewId: r.id, status: 'pending' })).project;
    await change('quotes', price, { http: 409 }); await request('board', 'GET', { http: 403 });
    plan = 'work-pro'; assert.deepEqual((await request('board', 'GET')).totals, { pending: 180027, accepted: 0 });
    p = (await change('baseline', { text: 'ข้อตกลงฉบับถัดไป' })).project; assert.equal(p.briefBaselines[0].id, b.id);
    assert.equal(p.briefBaselines[0].text, rules.sample.baseline); await change('reviews', input, { http: 409 });
    p = (await change('status', { reviewId: r.id, status: 'accepted' })).project;
    let board = await request('board', 'GET'); assert.deepEqual(board.totals, { pending: 0, accepted: 180027 }); assert.equal(board.rows[0].reviewId, r.id);
    assert.deepEqual((await request('board', 'GET', { token: 'other' })).rows, []);
    plan = 'free'; assert.equal((await f.service.get({ user: f.user, projectId })).project.briefReviews[0].quote.totalSatang, 180027);
    // Snapshot an attached file and replay after its original is removed.
    const file = await f.files.upload(f.user.sub, 'agreement.txt', 'text/plain', Buffer.from('ส่งไฟล์ MP4\nแก้ไขหนึ่งรอบ'));
    await change('baseline', { fileId: file.id }, { http: 404 });
    p = (await f.service.save({ user: f.user, projectId, expectedVersion: p.version, operationId: randomUUID(), patch: { sourceFileIds: [file.id] } })).project;
    const fromFile = { expectedVersion: p.version, operationId: randomUUID(), input: { fileId: file.id } };
    p = (await request(projectId + '/baseline', 'POST', { input: fromFile })).project;
    assert.equal(p.briefBaselines.at(-1).source.name, 'agreement.txt');
    assert.match(p.briefBaselines.at(-1).text, /แก้ไขหนึ่งรอบ/);
    await f.files.remove(f.user.sub, file.id);
    assert((await request(projectId + '/baseline', 'POST', { input: fromFile })).replayed);
    if (pool) {
      const audit = require('node:fs').readFileSync(require.resolve('../ops/notebook/verify-work-briefs.sql'), 'utf8');
      const validate = async client => (await client.query(audit)).rows[0].json_build_object;
      const checked = await validate(pool); assert(checked.reviewCount >= 1); assert.equal(checked.invalidEvidence, 0);
      assert.equal(checked.missingBaselines, 0); assert.equal(checked.invalidQuoteTotals, 0);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE panthorium_work_projects
          SET data=jsonb_set(jsonb_set(data,'{briefBaselines}','[]'),'{briefReviews,0,quote,totalSatang}','0') WHERE id=$1`, [projectId]);
        const damaged = await validate(client);
        assert(damaged.missingBaselines > 0); assert(damaged.invalidQuoteTotals > 0);
      } finally { await client.query('ROLLBACK'); client.release(); }
      const { EntitlementService } = require('../services/entitlementService');
      const rights = new EntitlementService({ pool }); await rights.init();
      const linked = new WorkBriefService(f.service, rights), orderId = randomUUID();
      try {
        await pool.query(`INSERT INTO panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at,used)
          VALUES($1,$2,'work-pro',$3,NOW()-interval '2 days',NOW()+interval '1 day','{}')`, [orderId, f.user.sub,
          JSON.stringify({ category: 'membership', quotas: { aiCredits: 8000000 } })]);
        assert.equal((await linked.board(f.user)).totals.accepted, 180027);
        await pool.query("UPDATE panthorium_entitlement_grants SET ends_at=NOW()-interval '1 day' WHERE order_id=$1", [orderId]);
        await assert.rejects(() => linked.board(f.user), /brief_plan_required/);
      } finally { await pool.query('DELETE FROM panthorium_entitlement_grants WHERE order_id=$1', [orderId]); }
    }
    assert.equal(f.gateway.calls.length, 0);
  }); } finally { if (pool) await pool.query('DELETE FROM panthorium_work_projects WHERE owner_id=$1', [f.user.sub]); }
}
async function testProbes() {
  let finish, calls = 0;
  const probes = createHealthProbes(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, { timeoutMs: 50, ttlMs: 500 });
  const app = express(); app.use(probes.router);
  await withHttp(app, async origin => {
    async function probe(path, status, value) { const res = await fetch(origin + path); const got = await res.json(); assert.equal(res.status, status); assert.deepEqual(got, value); check(spec.paths[path].get.responses[status].content['application/json'].schema, got); }
    const up = { ok: true, status: 'alive' }, down = { ok: false, status: 'not_ready' };
    await probe('/health/live', 200, up); assert.equal(calls, 0);
    await Promise.all(['/health/ready','/health'].map(p => probe(p, 503, down))); assert.equal(calls, 1);
    await probe('/health/ready', 503, down); assert.equal(calls, 1); finish({ ok: true, private: 'never returned' });
    await probe('/health', 200, { ok: true, status: 'ready' }); probes.drain();
    await probe('/health/ready', 503, down); await probe('/health/live', 200, up);
  });
}
async function main() {
  let pool;
  if (process.argv.includes('--postgres')) {
    if (!process.env.TEST_DATABASE_URL) throw Error('TEST_DATABASE_URL is required');
    pool = new (require('pg').Pool)({ connectionString: process.env.TEST_DATABASE_URL });
  }
  try { await testBriefs(pool); await testProbes(); console.log('PASS brief HTTP contracts, tier boundaries, immutable evidence, quote transitions, account isolation, concurrency and health probes (' + (pool ? 'PostgreSQL' : 'memory') + ')'); }
  finally { if (pool) await pool.end(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
