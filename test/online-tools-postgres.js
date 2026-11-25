'use strict';
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {Pool} = require('pg');
const {OnlineToolsService} = require('../services/onlineToolsService');
const {normalize} = require('../services/onlineToolModel');

async function withToolAccounts(run) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw Error('An isolated TEST_DATABASE_URL is required');
  const schema = 'test_tools_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({connectionString});
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    const pool = new Pool({connectionString, options: '-c search_path=' + schema});
    try {
      await pool.query('CREATE TABLE panthorium_users(id uuid PRIMARY KEY, username text NOT NULL)');
      const accounts = [randomUUID(), randomUUID(), randomUUID()];
      for (const [i, id] of accounts.entries())
        await pool.query('INSERT INTO panthorium_users VALUES ($1,$2)', [id, 'user-' + i]);
      const notices = [];
      const service = new OnlineToolsService(pool, {publish: async (n) => notices.push(n)});
      await service.init();
      await run({accounts, service, pool, notices});
    } finally {
      await pool.end();
    }
  } finally {
    try {
      await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    } finally {
      await admin.end();
    }
  }
}
async function verify({accounts: [owner, member, stranger], service: svc, pool, notices}) {
  const key = randomUUID();
  const question = {id: randomUUID(), label: 'สินค้า', type: 'short', required: true};
  const optional = {id: randomUUID(), label: 'จำนวน', type: 'number'};
  const draft = {id: key, kind: 'form', title: 'จองสินค้า', body: {fields: [question, optional]}};
  let form = await svc.create(owner, draft);
  assert.equal((await svc.create(owner, draft)).id, key);
  assert.equal(form.share, null);
  const error = (code) => (err) => err.message === code;
  await assert.rejects(svc.get(member, key), error('project_not_found'));
  await assert.rejects(svc.create(member, draft), error('project_id_conflict'));
  form = await svc.share(owner, key, {mode: 'public', on: true, revision: form.revision});
  const publicForm = await svc.shared(form.share);
  assert.equal(publicForm.body.fields[0].label, 'สินค้า');
  assert.deepEqual(Object.keys(publicForm).sort(), ['body', 'kind', 'revision', 'title']);
  await assert.rejects(
    svc.share(owner, key, {mode: 'public', on: false, revision: form.revision - 1}),
    error('revision_conflict')
  );
  const flowBody = {source: key, actions: ['record', 'notify'], labelField: question.id, enabled: true};
  await assert.rejects(
    svc.create(member, {id: randomUUID(), kind: 'flow', title: 'flow', body: flowBody}),
    error('select_owned_form')
  );
  let flow = await svc.create(owner, {
    id: randomUUID(),
    kind: 'flow',
    title: 'ติดตามยอดจอง',
    body: flowBody
  });
  flow = await svc.share(owner, flow.id, {mode: 'team', on: true, revision: flow.revision});
  await svc.join(member, flow.invite);
  assert.equal((await svc.members(owner, flow.id)).length, 1);
  await assert.rejects(svc.update(member, flow.id, flow), error('owner_required'));
  await assert.rejects(
    svc.share(owner, flow.id, {mode: 'public', on: true, revision: flow.revision}),
    error('invalid_share')
  );
  const post = {revision: form.revision, requestId: randomUUID(), answers: {[question.id]: '=2+3'}};
  await assert.rejects(svc.submit(form.share, {...post, answers: {}}), error('required_field'));
  await Promise.all([svc.submit(form.share, post), svc.submit(form.share, post)]);
  await assert.rejects(
    svc.submit(form.share, {...post, answers: {[question.id]: 'other'}}),
    error('request_conflict')
  );
  const run = (await svc.runs(member, flow.id)).items[0];
  assert.equal(run.label, '=2+3');
  assert.equal((await svc.runs(owner, flow.id)).items.length, 1);
  await svc.mark(member, flow.id, run.id, true);
  assert.equal((await svc.runs(owner, flow.id)).items[0].done, true);
  await assert.rejects(svc.answers(member, key), error('project_not_found'));
  await assert.rejects(svc.runs(stranger, flow.id), error('project_not_found'));
  await Promise.all([svc.flush(), svc.flush()]);
  assert.deepEqual(notices.map((n) => n.userId).sort(), [owner, member].sort());
  assert(notices.every((n) => n.sourceId === run.id && !n.body.includes('=2+3')));
  const csv = await svc.answers(owner, key, 0, true);
  assert(csv.startsWith('\uFEFF'));
  assert(csv.includes(`"'=2+3"`));
  form = await svc.update(owner, key, {...form, body: {fields: [optional]}});
  await svc.submit(form.share, post);
  await assert.rejects(
    svc.submit(form.share, {...post, requestId: randomUUID()}),
    error('form_changed')
  );
  assert((await svc.answers(owner, key, 0, true)).includes('สินค้า'));
  await svc.revoke(owner, flow.id, member);
  await assert.rejects(svc.join(member, flow.invite), error('link_closed'));
  await svc.submit(form.share, {
    revision: form.revision,
    requestId: randomUUID(),
    answers: {[optional.id]: '0'}
  });
  await svc.flush();
  assert.equal(notices.filter((n) => n.userId === member).length, 1);
  const quiet = await svc.create(owner, {
    id: randomUUID(),
    kind: 'flow',
    title: 'แจ้งอย่างเดียว',
    body: {source: key, actions: ['notify'], enabled: true}
  });
  await svc.submit(form.share, {revision: form.revision, requestId: randomUUID(), answers: {}});
  assert.equal((await svc.runs(owner, quiet.id)).items.length, 0);
  await svc.flush();
  assert.equal(notices.filter((n) => n.userId === owner).length, 4);
  const token = form.share;
  form = await svc.share(owner, key, {mode: 'public', on: false, revision: form.revision});
  await assert.rejects(svc.shared(token), error('link_closed'));
  await svc.remove(owner, key, form.revision);
  assert.equal((await svc.get(owner, flow.id)).body.enabled, false);
  assert.equal((await svc.runs(owner, flow.id)).items.length, 0);
  const pageBody = {blocks: [{type: 'check', text: 'ตรวจรายการ', done: false}]};
  let page = await svc.create(owner, {id: randomUUID(), kind: 'page', title: 'งาน', body: pageBody});
  page = await svc.share(owner, page.id, {mode: 'public', on: true, revision: page.revision});
  const copy = await svc.copy(member, page.share, randomUUID());
  assert.notEqual(copy.id, page.id);
  assert.deepEqual(copy.body, page.body);
  assert.equal(copy.share, null);
  page = await svc.share(owner, page.id, {mode: 'team', on: true, revision: page.revision});
  await svc.join(member, page.invite);
  const original = await svc.get(member, page.id);
  assert.equal(original.share, null);
  assert.equal(original.invite, null);
  const results = await Promise.allSettled(
    [owner, member].map((uid) => svc.update(uid, page.id, {...original, title: 'แก้ไข'}))
  );
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'rejected').reason.message, 'revision_conflict');
  assert.equal((await svc.get(member, copy.id)).title, 'งาน');
  assert.throws(
    () => normalize('design', {image: 'data:image/jpeg;base64,YQ=='}),
    error('invalid_image')
  );
  await pool.query('DELETE FROM panthorium_users WHERE id=$1', [owner]);
  assert.deepEqual(
    (await svc.list(member)).map((p) => p.id),
    [copy.id]
  );
}
if (require.main === module && !process.env.TEST_DATABASE_URL && !process.env.CI)
  console.log('Set TEST_DATABASE_URL to run online tools PostgreSQL integration.');
else if (require.main === module)
  withToolAccounts(verify)
    .then(() =>
      console.log(
        'Online tools PostgreSQL ownership, sharing, submissions, CSV, workflow delivery and retries passed.'
      )
    )
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
module.exports = {withToolAccounts};
