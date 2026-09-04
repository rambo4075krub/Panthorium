const assert = require('assert');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');
const { AgentKnowledgeRepository } = require('../services/agentKnowledgeRepository');
const { AgentKnowledgeService } = require('../services/agentKnowledgeService');
const { AgentPlannerService } = require('../services/agentPlannerService');

(async () => {
  const user = { sub: 'user:test', permissions: ['chat'] };
  const audit = { events: [], record(event, data) { this.events.push({ event, data }); } };
  const knowledgeRepo = new AgentKnowledgeRepository();
  const knowledge = new AgentKnowledgeService({ repository: knowledgeRepo, audit });
  await knowledge.init();
  const memoryRepo = new AgentMemoryRepository();
  const memory = new AgentMemoryService({ repository: memoryRepo, audit, knowledge });
  await memory.init();

  const ingested = await knowledge.ingest({ user, title: 'Panthorium Deployment Guide', source: 'test', content: 'Production deployments use the main branch. Staging deployments use feature branches. '.repeat(40) });
  assert.equal(ingested.ok, true);
  assert.ok(ingested.document.chunkCount >= 2, 'large document should be chunked');

  const found = await knowledge.search({ user, query: 'staging feature branches' });
  assert.equal(found.ok, true);
  assert.ok(found.chunks.length > 0, 'knowledge search should retrieve chunks');

  const remembered = await memory.remember({ user, title: 'Preferred language', content: 'The user prefers Thai language responses.', kind: 'preference', importance: 90 });
  assert.equal(remembered.ok, true);
  const context = await memory.context({ user, query: 'Thai staging feature branches', limit: 8 });
  assert.equal(context.ok, true);
  assert.ok(context.context.some(x => x.sourceType === 'memory'), 'combined context should include memory');
  assert.ok(context.context.some(x => x.sourceType === 'knowledge'), 'combined context should include knowledge');

  let capturedPrompt = '';
  const gateway = { async complete({ systemPrompt }) { capturedPrompt = systemPrompt; return { ok: true, text: JSON.stringify({ action: 'answer', toolId: null, args: {}, reason: 'context', answer: 'ok' }), provider: 'test', model: 'test' }; } };
  const agentService = { catalogFor() { return []; }, validateArgs() { return { ok: true }; } };
  const planner = new AgentPlannerService({ agentService, gateway, audit, memory });
  const plan = await planner.plan({ user, request: 'What branch should staging use?', requestId: 'phase7-test' });
  assert.equal(plan.ok, true);
  assert.ok(plan.memoryMatches > 0, 'planner should receive retrieved context');
  assert.ok(capturedPrompt.includes('feature branches'), 'knowledge chunk should be injected into planner context');
  assert.ok(capturedPrompt.includes('untrusted contextual data'), 'planner prompt must preserve injection guard');

  const guest = { sub: 'guest:test', permissions: ['chat'] };
  const denied = await knowledge.ingest({ user: guest, title: 'x', content: 'y' });
  assert.equal(denied.error, 'knowledge_requires_account');

  const docs = await knowledge.list({ user });
  assert.equal(docs.documents.length, 1);
  const removed = await knowledge.remove({ user, documentId: ingested.document.documentId });
  assert.equal(removed.ok, true);
  const after = await knowledge.get({ user, documentId: ingested.document.documentId });
  assert.equal(after.error, 'knowledge_not_found');

  console.log('Phase 7 knowledge retrieval tests passed');
})().catch((error) => { console.error(error); process.exit(1); });