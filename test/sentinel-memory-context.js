const assert = require('assert');
const { Sentinel } = require('../services/sentinel');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');

(async () => {
  const repository = new AgentMemoryRepository();
  const memory = new AgentMemoryService({ repository });
  await memory.init();
  await memory.remember({
    user: { sub: 'account-a', permissions: ['chat'] },
    kind: 'preference', title: 'Preferred language', content: 'Use Thai in replies', tags: ['thai']
  });
  await memory.remember({
    user: { sub: 'account-a', permissions: ['chat'] },
    kind: 'assistant-preference', title: 'Sentinel response preferences',
    content: JSON.stringify({ version: 1, preferredName: 'คุณปานเทพ', style: 'concise', language: 'thai' }), tags: ['assistant-preference']
  });
  let prompt = '';
  const gateway = {
    catalog: () => [],
    async complete(input) { prompt = input.systemPrompt; return { ok: true, text: 'สวัสดี', provider: 'fake', model: 'fake' }; }
  };
  const sentinel = new Sentinel({ memory, gateway });
  await sentinel.chat({ userId: 'account-a', sessionId: 's1', message: 'What is my Thai preference?' });
  assert(prompt.includes('Use Thai in replies'), 'relevant account memory must reach the main Sentinel prompt');
  assert(prompt.includes('คุณปานเทพ') && prompt.includes('"style":"concise"') && prompt.includes('"language":"thai"'), 'the account profile preference must guide Sentinel replies');
  assert(prompt.includes('ตอบให้กระชับ') && prompt.includes('ใช้ภาษาไทย'), 'the saved style and language map to explicit response guidance');
  const degradedMemory = { context: async () => { throw new Error('context_store_unavailable'); }, list: input => memory.list(input) };
  const degradedSentinel = new Sentinel({ memory: degradedMemory, gateway });
  assert((await degradedSentinel.memoryContextFor('account-a', 'hello', 's1')).includes('คุณปานเทพ'), 'saved response preferences remain available when semantic memory lookup is unavailable');
  prompt = '';
  await sentinel.chat({ userId: 'guest:session', sessionId: 's2', message: 'What is my Thai preference?' });
  assert(!prompt.includes('Use Thai in replies'), 'guest sessions must not receive account memory');
  assert(!prompt.includes('คุณปานเทพ'), 'guest sessions must not receive another account profile preferences');
  prompt = '';
  await sentinel.chat({ userId: 'account-b', sessionId: 's3', message: 'What is my Thai preference?' });
  assert(!prompt.includes('คุณปานเทพ'), 'profile preferences must not cross account boundaries');
  console.log('Sentinel long-term memory context tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
