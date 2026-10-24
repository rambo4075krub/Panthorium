'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { CloudFilesService } = require('../services/cloudFilesService');
const { OmiseBillingService } = require('../services/omiseBillingService');
const { SocialRepository } = require('../services/socialRepository');
const { SocialService } = require('../services/socialService');

async function filesSuite() {
  const owner = randomUUID(), other = randomUUID(), events = [], objects = new Map();
  let storageFails = false, deliveryFails = false;
  const files = new CloudFilesService({ bucket: 'notification-test-files', notifications: { publish: async event => {
    if (deliveryFails) throw Error('notification storage unavailable');
    assert(event.type === 'files.uploaded' ? objects.size > 0 : true, 'notification follows cloud success');
    events.push(event);
  } }, clientFactory: async () => ({ request: async options => {
    if (storageFails) throw Error('cloud unavailable');
    if (options.method === 'POST') {
      objects.set(options.params.name, { name: options.params.name, size: options.data.length, contentType: options.headers['Content-Type'] });
      return { data: {} };
    }
    if (options.method === 'DELETE') { objects.delete(decodeURIComponent(options.url.split('/o/')[1])); return { data: {} }; }
    return { data: { items: [...objects.values()].filter(file => file.name.startsWith(options.params.prefix)) } };
  } }) });
  const file = await files.upload(owner, 'PRIVATE-CONFIDENTIAL-FILENAME.txt', 'text/plain', Buffer.from('secret content'));
  assert.equal(events.length, 1); assert.equal(events[0].userId, owner); assert.equal(events[0].sourceId, file.id);
  assert(!JSON.stringify(events).includes('PRIVATE-CONFIDENTIAL')); assert(!JSON.stringify(events).includes('secret content'));
  await assert.rejects(files.remove(other, file.id), /file_not_found/); assert.equal(events.length, 1);
  storageFails = true; await assert.rejects(files.upload(owner, 'failure.txt', 'text/plain', Buffer.from('test')), /files_storage_unavailable/);
  assert.equal(events.length, 1, 'failed storage never announces completion'); storageFails = false;
  await files.remove(owner, file.id); assert.equal(events[1].type, 'files.deleted'); assert.equal(events[1].sourceId, file.id);
  assert.equal(objects.size, 0);
  deliveryFails = true;
  const saved = await files.upload(owner, 'outage.txt', 'text/plain', Buffer.from('test'));
  assert(saved.id); assert.equal((await files.remove(owner, saved.id)).ok, true, 'notification failure does not fail a successful file mutation');
}

async function billingSuite() {
  const id = randomUUID(), owner = randomUUID(), events = [];
  let committed = false, released = false, commitFails = false, deliveryFails = false;
  let row = { id, user_id: owner, product_id: 'life', amount: 18900, currency: 'THB', status: 'pending', charge_id: 'chrg_test_fixture' };
  let snapshot;
  const client = { release() { released = true; }, async query(sql, p = []) {
    if (sql === 'BEGIN') { committed = false; released = false; snapshot = structuredClone(row); return { rows: [] }; }
    if (sql === 'COMMIT') { if (commitFails) throw Error('commit failed'); committed = true; return { rows: [] }; }
    if (sql === 'ROLLBACK') { row = snapshot; return { rows: [] }; }
    if (sql.startsWith('SELECT')) return { rows: [{ ...row }] };
    if (sql.startsWith('UPDATE')) { Object.assign(row, { status: p[1], charge_id: p[2], qr_url: p[3], expires_at: p[4] }); return { rows: [{ ...row }] }; }
    if (sql.startsWith('INSERT') || sql.startsWith('DELETE')) return { rows: [] };
    throw Error('unexpected billing query');
  } };
  const billing = new OmiseBillingService({ pool: { connect: async () => client }, secret: 'skey_test_fixture', notifications: { publish: async event => {
    assert(committed && released, 'billing notification follows commit and client release');
    if (deliveryFails) throw Error('delivery failure');
    events.push(event);
  } } });
  const charge = { object: 'charge', id: row.charge_id, livemode: false, amount: 18900, currency: 'thb', paid: true, status: 'successful', metadata: { panthorium_order_id: id, user_id: 'FORGED-OWNER' }, secret: 'PROVIDER-SECRET' };
  assert.equal((await billing.reconcile(charge, id)).status, 'paid');
  assert.equal(events.length, 1); assert.equal(events[0].userId, owner); assert.equal(events[0].category, 'billing');
  assert.match(events[0].title, /^ทดสอบ:/); assert.match(events[0].body, /ไม่มอบสิทธิ์ใช้งานจริง/);
  assert(!JSON.stringify(events).includes('PROVIDER-SECRET')); assert(!JSON.stringify(events).includes('FORGED-OWNER'));
  await billing.reconcile(charge, id); assert.equal(events[1].sourceId, events[0].sourceId, 'verified retries use a stable deduplication key');
  await billing.reconcile({ ...charge, paid: false, status: 'pending' }, id);
  assert.equal(events.at(-1).type, 'billing.paid', 'stale provider callbacks never announce reversal of settled payment');
  const count = events.length;
  await assert.rejects(billing.reconcile({ ...charge, amount: 1 }, id), /charge_mismatch/);
  assert.equal(events.length, count, 'invalid provider data never emits');
  commitFails = true;
  await assert.rejects(billing.reconcile({ ...charge, refunded_amount: 18900 }, id), /commit failed/);
  assert.equal(events.length, count, 'rolled-back payment state never emits'); commitFails = false;
  deliveryFails = true;
  assert.equal((await billing.reconcile({ ...charge, refunded_amount: 18900 }, id)).status, 'refunded');
  assert.equal(row.status, 'refunded', 'notification outage does not invalidate committed payment result');
}

async function socialSuite() {
  const repo = new SocialRepository({ allowMemory: true }); await repo.init();
  const users = [0, 1, 2].map(() => ({ sub: randomUUID(), roles: ['user'], permissions: ['chat'] }));
  const [a, b, c] = users, events = [];
  let inTransaction = false, deliveryFails = false;
  const transaction = repo.transaction.bind(repo);
  repo.transaction = async work => {
    inTransaction = true;
    try { return await transaction(work); } finally { inTransaction = false; }
  };
  const social = new SocialService({ repository: repo, files: {}, systemNotifications: { publish: async event => {
    assert(!inTransaction, 'social notification follows transaction commit');
    if (deliveryFails) throw Error('notification unavailable'); events.push(event);
  } } });
  const write = (user, action, input, requestId = randomUUID()) => social.write({ user, action, input, requestId });
  for (const [index, user] of users.entries()) await write(user, 'profile', { name: 'PRIVATE-NAME-' + index, discoverable: true });
  const requestId = randomUUID();
  const thread = (await write(a, 'thread', { userId: b.sub }, requestId)).record;
  assert.equal(events.length, 1); assert.equal(events[0].userId, b.sub);
  assert.equal(events[0].type, 'social.activity.thread-request', 'request uses a switch distinct from incoming messages');
  assert.match(events[0].sourceId, /^notification:[a-f0-9]{64}$/);
  await write(a, 'thread', { userId: b.sub }, requestId); assert.equal(events.length, 1, 'idempotent replay does not emit again');
  assert(await social.notifications.systemNotificationVisible(b.sub, events[0].sourceId));
  assert.equal(await social.notifications.systemNotificationVisible(c.sub, events[0].sourceId), false, 'other accounts never see source');
  await write(b, 'accept-thread', { recordId: thread.id, accept: true });
  assert.equal(await social.notifications.systemNotificationVisible(b.sub, events[0].sourceId), false, 'superseded request is hidden');
  const message = (await write(a, 'message', { recordId: thread.id, text: 'PRIVATE-CONTENT' })).record;
  const notice = events.at(-1);
  assert.equal(notice.type, 'social.activity.message', 'new messages can be enabled independently of Social requests');
  const call=(await write(a,'call',{recordId:thread.id,video:false})).record;
  const callNotice=events.at(-1);assert.equal(callNotice.type,'social.activity.call','incoming calls have an independent switch');
  assert(await social.notifications.systemNotificationVisible(b.sub,callNotice.sourceId));
  await repo.put({...call,status:'accepted'});
  assert.equal(await social.notifications.systemNotificationVisible(b.sub,callNotice.sourceId),false,'resolved call no longer exposes stale activity');
  assert(!JSON.stringify(events).includes('PRIVATE-CONTENT')); assert(!JSON.stringify(events).includes('PRIVATE-NAME'));
  assert(await social.notifications.systemNotificationVisible(b.sub, notice.sourceId));
  await write(a, 'delete', { recordId: message.id });
  assert.equal(await social.notifications.systemNotificationVisible(b.sub, notice.sourceId), false, 'deleted source is hidden');
  await write(a, 'message', { recordId: thread.id, text: 'another private message' });
  const blockedNotice = events.at(-1);
  await write(b, 'block', { userId: a.sub });
  assert.equal(await social.notifications.systemNotificationVisible(b.sub, blockedNotice.sourceId), false, 'blocked source is hidden');
  await write(b, 'block', { userId: a.sub, enabled: false });
  const put = repo.put.bind(repo), count = events.length;
  repo.put = async item => { if (item.kind === 'receipt') throw Error('receipt failed'); return put(item); };
  await assert.rejects(write(a, 'message', { recordId: thread.id, text: 'ROLLED-BACK' }), /receipt failed/);
  assert.equal(events.length, count, 'rollback produces no central notification'); repo.put = put;
  deliveryFails = true;
  assert((await write(a, 'message', { recordId: thread.id, text: 'committed despite notification outage' })).record.id);
}

(async () => {
  await filesSuite(); await billingSuite(); await socialSuite();
  console.log('Notification producers: committed-only file, verified payment and social events; privacy, deduplication keys, revocation and failure isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
