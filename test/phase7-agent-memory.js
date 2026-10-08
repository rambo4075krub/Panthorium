const assert = require('assert');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');

(async () => {
  assert.throws(() => new AgentMemoryRepository({ requireDatabase: true }), /DATABASE_URL is required/, "production must not silently fall back to process memory");
  const repository = new AgentMemoryRepository();
  const events = [];
  const memory = new AgentMemoryService({ repository, audit: { record: (event, data) => events.push({ event, data }) } });
  await memory.init();

  const user = { sub: 'u1', permissions: ['chat'], roles: [] };
  const guest = { sub: 'guest:1', permissions: ['chat'], roles: ['guest'] };

  const denied = await memory.remember({ user: guest, title: 'x', content: 'y' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'memory_requires_account');

  const created = await memory.remember({ user, kind: 'preference', title: 'Language', content: 'Respond in Thai', tags: ['language','thai'], importance: 90 });
  assert.equal(created.ok, true);
  assert.equal(created.memory.userId, 'u1');

  const listed = await memory.list({ user });
  assert.equal(listed.memories.length, 1);
  assert.equal((await memory.list({ user: { sub: 'u2', permissions: ['chat'] } })).memories.length, 0, 'another account cannot read this memory');

  const found = await memory.search({ user, query: 'Thai' });
  assert.equal(found.ok, true);
  assert.equal(found.memories.length, 1);

  const thai = await memory.remember({ user, kind: 'preference', title: 'ภาษาไทย', content: 'ผู้ใช้ชอบคำตอบภาษาไทยที่ชัดเจน', tags: ['ภาษาไทย'], importance: 70 });
  const thaiFound = await memory.search({ user, query: 'คำตอบภาษาไทย' });
  assert(thaiFound.memories.some(item => item.memoryId === thai.memory.memoryId), 'Thai word segmentation should retrieve Thai memories');
  const topical = await memory.remember({ user, kind: 'fact', title: 'Sentinel memory architecture', content: 'A note about long-term user context', importance: 50 });
  await memory.remember({ user, kind: 'fact', title: 'Other note', content: 'Sentinel appears only in the body', importance: 95 });
  const ranked = await memory.search({ user, query: 'Sentinel' });
  assert.equal(ranked.memories[0].memoryId, topical.memory.memoryId, 'title matches should rank above body-only matches');
  const expiring = await memory.remember({ user, kind: 'fact', title: 'Project deadline', content: 'The deadline is stored with a confidence score.', confidence: 0.95, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(expiring.memory.confidence, 0.95);
  assert(expiring.memory.expiresAt);
  await repository.create({ userId: 'u1', kind: 'fact', title: 'Expired unpublishedmarker fact', content: 'This expired fact must not be retrieved.', expiresAt: new Date(Date.now() - 1000).toISOString() });
  const expired = await memory.search({ user, query: 'unpublishedmarker' });
  assert.equal(expired.memories.length, 0, 'expired long-term memories must be excluded from retrieval');

  const updated = await memory.update({ user, memoryId: created.memory.memoryId, content: 'Respond in Thai and English', importance: 95 });
  assert.equal(updated.ok, true);
  assert.equal(updated.memory.content, 'Respond in Thai and English');
  assert.equal(updated.memory.importance, 95);

  const hiddenFromOtherUser = await memory.update({ user: { sub: 'u2', permissions: ['chat'] }, memoryId: created.memory.memoryId, content: 'Private data' });
  assert.equal(hiddenFromOtherUser.error, 'memory_not_found', 'an account cannot update another account memory');
  const deniedGuestUpdate = await memory.update({ user: guest, memoryId: created.memory.memoryId, content: 'Private data' });
  assert.equal(deniedGuestUpdate.error, 'memory_requires_account', 'guest memory updates are rejected');

  const context = await memory.context({ user, query: 'language' });
  assert.equal(context.ok, true);
  assert.equal(context.context[0].title, 'Language');

  const invalidTags = await memory.remember({ user, title: 'Bad', content: 'Bad', tags: new Array(21).fill('x') });
  assert.equal(invalidTags.error, 'invalid_memory_tags');

  const removed = await memory.remove({ user, memoryId: created.memory.memoryId });
  assert.equal(removed.ok, true);
  assert.equal((await memory.list({ user })).memories.some(item => item.memoryId === created.memory.memoryId), false);
  assert(events.some((e) => e.event === 'agent.memory_created'));
  assert(events.some((e) => e.event === 'agent.memory_searched'));
  assert(events.some((e) => e.event === 'agent.memory_deleted'));

  console.log('Phase 7 agent memory tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
