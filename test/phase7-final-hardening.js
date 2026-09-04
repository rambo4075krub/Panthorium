const assert = require('assert');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');
const { AgentKnowledgeRepository } = require('../services/agentKnowledgeRepository');
const { AgentKnowledgeService } = require('../services/agentKnowledgeService');

(async () => {
  const audit = { record() {} };
  const userA = { sub: 'user:a', permissions: ['chat'] };
  const userB = { sub: 'user:b', permissions: ['chat'] };
  const guest = { sub: 'guest:test', permissions: ['chat'] };
  const noChat = { sub: 'user:no-chat', permissions: ['system:read'] };
  const knowledge = new AgentKnowledgeService({ repository: new AgentKnowledgeRepository(), audit });
  await knowledge.init();
  const memory = new AgentMemoryService({ repository: new AgentMemoryRepository(), audit, knowledge });
  await memory.init();

  assert.equal((await memory.remember({ user: guest, title: 'x', content: 'y' })).error, 'memory_requires_account');
  assert.equal((await knowledge.ingest({ user: guest, title: 'x', content: 'y' })).error, 'knowledge_requires_account');
  assert.equal((await knowledge.ingest({ user: noChat, title: 'x', content: 'y' })).error, 'knowledge_requires_account');
  assert.equal((await knowledge.ingest({ user: userA, title: '', content: 'x' })).error, 'invalid_knowledge_title');
  assert.equal((await knowledge.ingest({ user: userA, title: 'x', content: '' })).error, 'invalid_knowledge_content');
  assert.equal((await knowledge.search({ user: userA, query: '' })).error, 'invalid_knowledge_query');
  assert.equal((await knowledge.get({ user: userA, documentId: '../bad' })).error, 'invalid_document_id');
  assert.equal((await memory.remove({ user: userA, memoryId: '../bad' })).error, 'invalid_memory_id');

  const doc = await knowledge.ingest({ user: userA, title: 'Private A', content: 'alpha confidential deployment notes' });
  assert.equal(doc.ok, true);
  assert.equal((await knowledge.get({ user: userB, documentId: doc.document.documentId })).error, 'knowledge_not_found');
  assert.equal((await knowledge.remove({ user: userB, documentId: doc.document.documentId })).error, 'knowledge_not_found');
  assert.equal((await knowledge.search({ user: userB, query: 'confidential' })).chunks.length, 0);

  const mem = await memory.remember({ user: userA, title: 'Private memory', content: 'alpha secret preference', importance: 90 });
  assert.equal(mem.ok, true);
  assert.equal((await memory.search({ user: userB, query: 'secret' })).memories.length, 0);

  const oversizedMetadata = { x: 'a'.repeat(9000) };
  assert.equal((await knowledge.ingest({ user: userA, title: 'meta', content: 'ok', metadata: oversizedMetadata })).error, 'invalid_knowledge_metadata');
  assert.equal((await knowledge.ingest({ user: userA, title: 'source', content: 'ok', source: 'a'.repeat(501) })).error, 'invalid_knowledge_source');
  assert.equal((await memory.context({ user: userA, query: 'alpha confidential', limit: 999 })).ok, true);

  console.log('Phase 7 final hardening tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
