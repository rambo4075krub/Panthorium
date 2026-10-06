const assert = require('node:assert/strict');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');
const { CloudNotesError } = require('../services/cloudNotesRepository');

const aliceId = '11111111-1111-4111-8111-111111111111';
const bobId = '22222222-2222-4222-8222-222222222222';
const alice = { id: aliceId, sub: aliceId, permissions: ['chat'], roles: ['user'] };
const bob = { id: bobId, sub: bobId, permissions: ['chat'], roles: ['user'] };
const note = (userId, memoryId, title, content) => ({
  userId, memoryId, kind: 'note', title, content, tags: ['personal'], source: 'notes-app',
  importance: 70, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z'
});

class FakeCloudNotesRepository {
  constructor() { this.items = new Map(); this.reads = 0; this.creates = 0; this.failCreate = false; }
  key(userId, memoryId) { return userId + ':' + memoryId; }
  async get(userId, memoryId) {
    this.reads += 1;
    const item = this.items.get(this.key(userId, memoryId));
    return item ? structuredClone(item) : null;
  }
  async create(input) {
    this.creates += 1;
    if (this.failCreate) throw new Error('bucket write failed');
    this.items.set(this.key(input.userId, input.memoryId), { ...input });
    return structuredClone(input);
  }
  async list(userId, limit = 100) {
    return [...this.items.values()].filter(item => item.userId === userId)
      .sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit).map(item => structuredClone(item));
  }
  async search(userId, query, limit = 10) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    return (await this.list(userId, 10000))
      .filter(item => terms.some(term => (item.title + ' ' + item.content + ' ' + item.tags.join(' ')).toLowerCase().includes(term)))
      .slice(0, limit);
  }
  async update(userId, memoryId, patch) {
    const key = this.key(userId, memoryId);
    const item = this.items.get(key);
    if (!item) return null;
    const updated = { ...item, ...patch, updatedAt: new Date().toISOString() };
    this.items.set(key, updated);
    return structuredClone(updated);
  }
  async delete(userId, memoryId) { return this.items.delete(this.key(userId, memoryId)); }
}

async function main() {
  const cloud = new FakeCloudNotesRepository();
  const repository = new AgentMemoryRepository({ notesRepository: cloud });
  const service = new AgentMemoryService({ repository });
  const oldNote = note(aliceId, '33333333-3333-4333-8333-333333333333', 'Trip', 'Bangkok and family');
  const oldFact = { ...note(aliceId, '44444444-4444-4444-8444-444444444444', 'Preference', 'Tea'), kind: 'fact' };
  repository.memory.set(oldNote.memoryId, oldNote);
  repository.memory.set(oldFact.memoryId, oldFact);

  const listed = await service.list({ user: alice, kind: 'note', limit: 100 });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.memories, [oldNote]);
  assert.equal(repository.memory.has(oldNote.memoryId), false, 'legacy note is removed only after bucket copy verification');
  assert.equal(repository.memory.has(oldFact.memoryId), true, 'other memory kinds stay in SQL');
  assert.equal(cloud.creates, 1);
  assert.equal((await cloud.get(aliceId, oldNote.memoryId)).content, oldNote.content);
  assert.deepEqual(await cloud.list(bobId), [], 'bucket objects are scoped to their account');

  const beforeReads = cloud.reads;
  assert.equal((await repository.get(aliceId, oldFact.memoryId)).kind, 'fact');
  assert.equal(cloud.reads, beforeReads, 'non-note memory reads do not contact the Notes bucket');

  const newNote = await service.remember({ user: alice, title: 'Weekend', content: 'Visit Chiang Mai' });
  assert.equal(newNote.ok, true);
  assert.equal(repository.memory.has(newNote.memory.memoryId), false, 'new Notes are written to the bucket');
  const results = await service.search({ user: alice, query: 'Chiang Mai', limit: 10 });
  assert.equal(results.ok, true);
  assert.equal(results.memories[0].memoryId, newNote.memory.memoryId, 'search includes bucket notes');

  const updated = await service.update({ user: alice, memoryId: newNote.memory.memoryId, content: 'Visit Phuket' });
  assert.equal(updated.ok, true);
  assert.equal(updated.memory.content, 'Visit Phuket');
  assert.equal((await service.remove({ user: alice, memoryId: newNote.memory.memoryId })).ok, true);
  assert.equal(await cloud.get(aliceId, newNote.memory.memoryId), null);
  assert.deepEqual((await service.list({ user: bob, kind: 'note' })).memories, [], 'accounts cannot list each others notes');

  const failedCloud = new FakeCloudNotesRepository();
  failedCloud.failCreate = true;
  const failedRepository = new AgentMemoryRepository({ notesRepository: failedCloud });
  const protectedNote = note(aliceId, '55555555-5555-4555-8555-555555555555', 'Keep', 'Do not lose me');
  failedRepository.memory.set(protectedNote.memoryId, protectedNote);
  await assert.rejects(() => failedRepository.list(aliceId, 100, 'note'), /bucket write failed/);
  assert.equal(failedRepository.memory.get(protectedNote.memoryId).content, protectedNote.content, 'legacy SQL data is preserved when copy fails');

  const conflictCloud = new FakeCloudNotesRepository();
  const conflictRepository = new AgentMemoryRepository({ notesRepository: conflictCloud });
  const conflictNote = note(aliceId, '66666666-6666-4666-8666-666666666666', 'Legacy', 'original');
  conflictCloud.items.set(conflictCloud.key(aliceId, conflictNote.memoryId), { ...conflictNote, content: 'different' });
  conflictRepository.memory.set(conflictNote.memoryId, conflictNote);
  await assert.rejects(() => conflictRepository.list(aliceId, 100, 'note'), error => error instanceof CloudNotesError && error.code === 'notes_migration_conflict');
  assert.equal(conflictRepository.memory.has(conflictNote.memoryId), true, 'mismatched copies do not remove legacy data');

  console.log('PASS: bucket Notes migration, account isolation, CRUD, retrieval, and preservation checks');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
