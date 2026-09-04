const assert = require('assert');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');

(async () => {
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

  const found = await memory.search({ user, query: 'Thai' });
  assert.equal(found.ok, true);
  assert.equal(found.memories.length, 1);

  const context = await memory.context({ user, query: 'language' });
  assert.equal(context.ok, true);
  assert.equal(context.context[0].title, 'Language');

  const invalidTags = await memory.remember({ user, title: 'Bad', content: 'Bad', tags: new Array(21).fill('x') });
  assert.equal(invalidTags.error, 'invalid_memory_tags');

  const removed = await memory.remove({ user, memoryId: created.memory.memoryId });
  assert.equal(removed.ok, true);
  assert.equal((await memory.list({ user })).memories.length, 0);
  assert(events.some((e) => e.event === 'agent.memory_created'));
  assert(events.some((e) => e.event === 'agent.memory_searched'));
  assert(events.some((e) => e.event === 'agent.memory_deleted'));

  console.log('Phase 7 agent memory tests passed');
})().catch((error) => { console.error(error); process.exit(1); });