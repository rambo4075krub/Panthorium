const assert = require('node:assert/strict');
const { ProviderManager } = require('../services/providerManager');
const { AiGateway } = require('../services/aiGateway');

module.exports = async function testGroqMigration() {
  const originalModel = process.env.GROQ_MODEL;
  const originalFetch = global.fetch;
  const current = 'openai/gpt-oss-20b';
  const retired = 'llama-3.1-8b-instant';
  const history = [{ role: 'user', content: 'ตอบว่า ทดสอบสำเร็จ' }];
  const tokenUsage = { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 };
  try {
    delete process.env.GROQ_MODEL;
    assert.equal(new ProviderManager().models.groq, current);
    process.env.GROQ_MODEL = 'custom-enterprise-model';
    const custom = new ProviderManager();
    assert.equal(custom.models.groq, 'custom-enterprise-model');
    assert.equal(custom.resolveModel('groq', retired), null);

    process.env.GROQ_MODEL = ` ${retired} `;
    const manager = new ProviderManager();
    manager.keys = { groq: 'test-groq-key', openai: 'test-openai-key' };
    manager.priority = ['groq', 'openai'];
    assert.equal(manager.catalog()[0].model, current);
    assert.equal(manager.resolveModel('groq', retired), current);
    assert.equal(manager.resolveModel('groq', current), current);
    assert.equal(manager.resolveModel('groq', 'unexpected-expensive-model'), null);
    const calls = [];
    let failGroq = false;
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      const groq = url === 'https://api.groq.com/openai/v1/chat/completions';
      if (groq) {
        assert.equal(body.model, current);
        assert.equal(body.max_completion_tokens, 2048);
        assert.equal(body.reasoning_effort, 'low');
        assert.equal(body.include_reasoning, false);
        assert.equal(body.max_tokens, undefined);
        if (failGroq) return new Response('{}', { status: 429 });
      } else {
        assert.equal(url, 'https://api.openai.com/v1/chat/completions');
        assert.equal(body.max_tokens, 320);
        assert.equal(body.reasoning_effort, undefined);
        assert.equal(body.include_reasoning, undefined);
      }
      assert.deepEqual(body.messages, [{ role: 'system', content: 'Sentinel' }, ...history]);
      if (!body.stream) {
        return Response.json({ model: body.model, choices: [{ message: { content: 'ทดสอบสำเร็จ', reasoning: 'internal' } }], usage: tokenUsage });
      }
      const events = [
        { model: body.model, choices: [{ delta: { reasoning: 'internal' } }] },
        { choices: [{ delta: { content: 'ทดสอบ' } }] },
        { choices: [{ delta: { content: 'สำเร็จ' } }] },
        groq ? { choices: [], x_groq: { usage: tokenUsage } } : { choices: [], usage: tokenUsage }
      ];
      const wire = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
      const bytes = new TextEncoder().encode(wire);
      // Chunk across SSE lines and UTF-8 characters as a real stream can do.
      return new Response(new ReadableStream({ start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 11) controller.enqueue(bytes.slice(offset, offset + 11));
        controller.close();
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };

    const events = [];
    const gateway = new AiGateway({ providers: manager, audit: { record: (event, data) => events.push({ event, ...data }) } });
    for (const stream of [false, true]) {
      const deltas = [];
      const input = { systemPrompt: 'Sentinel', history, preferredProvider: 'groq', preferredModel: retired, onDelta: delta => deltas.push(delta) };
      const result = stream ? await gateway.stream(input) : await gateway.complete(input);
      assert.equal(result.ok, true);
      assert.equal(result.provider, 'groq');
      assert.equal(result.model, current);
      assert.equal(result.fallbackCount, 0);
      assert.equal(result.text, 'ทดสอบสำเร็จ');
      assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 18, totalTokens: 30 });
      if (stream) assert.equal(deltas.join(''), result.text);
    }
    const count = calls.length;
    await assert.rejects(manager.callDetailed('groq', 'Sentinel', history, { model: 'unexpected-expensive-model' }), /model_not_allowed/);
    assert.equal(calls.length, count);

    failGroq = true;
    for (const stream of [false, true]) {
      const input = { systemPrompt: 'Sentinel', history, preferredProvider: 'groq' };
      const result = stream ? await gateway.stream(input) : await gateway.complete(input);
      assert.equal(result.ok, true);
      assert.equal(result.provider, 'openai');
      assert.equal(result.fallbackCount, 1);
      assert.equal(result.text, 'ทดสอบสำเร็จ');
    }
    assert(events.some(event => event.event === 'ai.gateway.provider_failed'));
    assert(events.some(event => event.event === 'ai.gateway.stream_provider_failed'));
    console.log('Groq migration passed: configured/default models, completion, Thai streaming, usage, allowlist and fallback');
  } finally {
    global.fetch = originalFetch;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  }
};
