'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { AuthService } = require('../services/authService');
const { SocialRepository } = require('../services/socialRepository');
const { SocialService } = require('../services/socialService');
const { createSocialRouter } = require('../routes/social');
async function suite(repository) {
  await repository.init();
  const member = { id: randomUUID(), username: 'ลูกค้า', roles: ['user'], permissions: ['chat'] };
  const admin = { ...member, id: randomUUID(), username: 'support-admin', roles: ['administrator'] };
  const stranger = { ...member, id: randomUUID(), username: 'อื่น' };
  const users = [member, admin, stranger];
  const service = new SocialService({ repository, supportAdminUsername: admin.username, accounts: {
    findUserByUsername: async name => users.find(u => u.username === name),
    findUserById: async id => users.find(u => u.id === id),
  }});
  const auth = new AuthService({ config: { jwtSecret: 'contact-test-only-secret', accessTokenTtl: '1h' }, audit: { record() {} } });
  const app = express(); app.use(express.json()); app.use('/api/social', createSocialRouter(auth, service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = (path, user = member, body) => fetch('http://127.0.0.1:' + server.address().port + '/api/social' + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + auth.signAccessToken(user) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    assert.equal((await request('/support', null, {})).status, 401);
    assert.equal((await request('/support', { ...member, roles: ['guest'] }, {})).status, 403);
    assert.equal((await request('/support', { ...member, permissions: [] }, {})).status, 403);
    const responses = await Promise.all(Array.from({ length: 3 }, () => request('/support', member, { userId: stranger.id })));
    const threads = await Promise.all(responses.map(r => r.json()));
    const thread = threads[0].record;
    assert(thread); assert(threads.every(t => t.record.id === thread.id), 'concurrent opens reuse one thread');
    assert.deepEqual(thread.members, [member.id, admin.id], 'client cannot choose a different support recipient');
    assert.equal(thread.status, 'accepted');
    assert.equal((await request('/support', admin, {})).status, 200);
    assert.equal((await (await request('/support', admin, {})).json()).inbox, true);
    const send = async (actor, text) => {
      const response = await request('/actions', actor, { action: 'message', input: { recordId: thread.id, text } });
      assert.equal(response.status, 200); return (await response.json()).record;
    };
    const incoming = await send(member, 'ขอสอบถามการใช้งาน');
    const notices = await (await request('/notifications', admin)).json();
    assert.equal(notices.unreadCount, 1); assert.equal(notices.items[0].name, 'ลูกค้า');
    assert.equal((await request('/records/' + thread.id, stranger)).status, 404);
    assert.equal((await request('/actions', stranger, { action: 'message', input: { recordId: thread.id, text: 'intrusion' } })).status, 404);
    const answer = await send(admin, 'ยินดีช่วยเหลือครับ');
    const history = await (await request('/records/' + thread.id)).json();
    assert.equal(history.items.find(m => m.id === answer.id).author.name, 'แอดมิน Panthorium');
    assert.equal(history.items.find(m => m.id === incoming.id).author.name, 'ลูกค้า');
    assert.equal((await request('/records/' + thread.id + '/read', admin, { messageIds: [incoming.id] })).status, 200);
    assert((await (await request('/records/' + thread.id)).json()).items.find(m => m.id === incoming.id).readAt);
    assert.equal((await (await request('/feed/talk', admin)).json()).items[0].title, 'ติดต่อสอบถาม · ลูกค้า');
    admin.roles = ['user'];
    // A stale token must not retain support access when the administrator was demoted.
    assert.equal((await request('/records/' + thread.id, { ...admin, roles: ['administrator'] })).status, 404);
    assert.equal((await request('/support', member, {})).status, 503);
    admin.roles = ['administrator'];
    assert.equal((await request('/actions', member, { action: 'block', input: { userId: admin.id } })).status, 200);
    assert.equal((await request('/support', member, {})).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
}
module.exports = { suite };
if (require.main === module) suite(new SocialRepository({ allowMemory: true })).then(() => console.log('Contact support: routing, private two-way messages, notifications, read receipts, retries and revoked access passed')).catch(e => { console.error(e); process.exitCode = 1; });
