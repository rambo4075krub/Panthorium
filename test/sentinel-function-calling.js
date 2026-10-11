const assert = require('node:assert/strict');
const { Sentinel } = require('../services/sentinel');

async function main() {
  const sessions = new Map();
  const gatewayCalls = [];
  const gateway = {
    orderedProviders: () => ['vertex'],
    async complete(input) {
      gatewayCalls.push(input);
      if (input.tools?.length && !input.history.some(entry => entry.parts?.some(part => part.functionResponse))) {
        return { ok: true, text: '', provider: 'vertex', model: 'sentinel-v4', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 }, functionCalls: [{ id: 'fc-1', name: 'panthorium_ai_providers', args: {} }], modelParts: [{ functionCall: { id: 'fc-1', name: 'panthorium_ai_providers', args: {} }, thoughtSignature: 'signature' }] };
      }
      return { ok: true, text: 'มี Vertex เป็นผู้ให้บริการ', provider: 'vertex', model: 'sentinel-v4', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
    }
  };
  const sentinel = new Sentinel({
    sessions: {
      append(id, message) { const history = sessions.get(id) || []; history.push(message); sessions.set(id, history); return history; },
      clear() {},
      size() { return sessions.size; }
    },
    prompts: { build: () => 'Sentinel', productContext: () => '' },
    gateway
  });
  const functionCalling = {
    declarationsFor: () => [{ name: 'panthorium_ai_providers', description: 'List providers', parameters: { type: 'OBJECT', properties: {} } }],
    async execute({ user, call, source }) {
      assert.equal(user.sub, 'user-1');
      assert.equal(call.id, 'fc-1');
      assert.equal(source, 'sentinel-chat');
      return { id: 'fc-1', name: call.name, toolId: 'ai.providers', ok: true, output: { providers: ['vertex'] }, functionResponse: { name: call.name, id: 'fc-1', response: { output: { providers: ['vertex'] } } } };
    }
  };
  const response = await sentinel.chat({
    sessionId: 'function-calling', userId: 'user-1', user: { sub: 'user-1', permissions: ['chat'] },
    message: 'แสดงผู้ให้บริการ AI', provider: undefined, functionCalling
  });
  assert.equal(response.text, 'มี Vertex เป็นผู้ให้บริการ');
  assert.equal(response.functionCallCount, 1);
  assert.deepEqual(response.toolResults, [{ toolId: 'ai.providers', ok: true }]);
  assert.deepEqual(response.usage, { inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  assert.equal(gatewayCalls.length, 2);
  assert.deepEqual(gatewayCalls[0].tools[0].name, 'panthorium_ai_providers');
  assert.equal(gatewayCalls[1].history.at(-2).parts[0].thoughtSignature, 'signature');
  assert.equal(gatewayCalls[1].history.at(-1).parts[0].functionResponse.response.output.providers[0], 'vertex');

  const externalProviderCalls = gatewayCalls.length;
  await sentinel.chat({ sessionId: 'function-calling', userId: 'user-1', user: { sub: 'user-1', permissions: ['chat'] }, message: 'ทักทาย', provider: 'groq', functionCalling });
  assert.equal(gatewayCalls.length, externalProviderCalls + 1);
  assert.equal(gatewayCalls.at(-1).tools, undefined, 'tool declarations are only sent to Sentinel V4 on Vertex');
  console.log('Sentinel function calling tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
