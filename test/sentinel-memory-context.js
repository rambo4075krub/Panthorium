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
  let prompt = '';
  const gateway = {
    catalog: () => [],
    async complete(input) { prompt = input.systemPrompt; return { ok: true, text: 'สวัสดี', provider: 'fake', model: 'fake' }; }
  };
  const sentinel = new Sentinel({ memory, gateway });
  await sentinel.chat({ userId: 'account-a', sessionId: 's1', message: 'What is my Thai preference?' });
  assert(prompt.includes('Use Thai in replies'), 'relevant account memory must reach the main Sentinel prompt');
  prompt = '';
  await sentinel.chat({ userId: 'guest:session', sessionId: 's2', message: 'What is my Thai preference?' });
  assert(!prompt.includes('Use Thai in replies'), 'guest sessions must not receive account memory');
  console.log('Sentinel long-term memory context tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
