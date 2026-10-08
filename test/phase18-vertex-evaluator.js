'use strict';

const assert = require('node:assert/strict');

const names = [
  'AI_PRIORITY', 'VERTEX_ACCESS_TOKEN', 'SENTINEL_VERTEX_PROJECT_ID',
  'SENTINEL_VERTEX_LOCATION', 'SENTINEL_VERTEX_ENDPOINT_ID',
  'SENTINEL_VERTEX_MODEL', 'SENTINEL_VERTEX_EVALUATOR_MODELS',
  'SENTINEL_VERTEX_EVALUATOR_LOCATION'
];
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
const originalFetch = global.fetch;

(async () => {
  process.env.AI_PRIORITY = 'vertex';
  process.env.VERTEX_ACCESS_TOKEN = 'test-vertex-token';
  process.env.SENTINEL_VERTEX_PROJECT_ID = 'test-project';
  process.env.SENTINEL_VERTEX_LOCATION = 'us-central1';
  process.env.SENTINEL_VERTEX_ENDPOINT_ID = '123456';
  process.env.SENTINEL_VERTEX_MODEL = 'sentinel-v4';
  process.env.SENTINEL_VERTEX_EVALUATOR_MODELS = 'judge-a,judge-b';
  process.env.SENTINEL_VERTEX_EVALUATOR_LOCATION = 'eu';
  const { ProviderManager } = require('../services/providerManager');
  const providers = new ProviderManager();
  assert.deepEqual(providers.available(), ['vertex'], 'evaluator aliases must not become chat fallback providers');
  assert.deepEqual(providers.evaluationAvailable(), ['vertex', 'vertex_eval_1', 'vertex_eval_2']);
  assert.equal(providers.resolveModel('vertex', 'judge-a'), null, 'chat cannot select an evaluator model');

  let requestedUrl = '';
  let requestBody;
  let authorization = '';
  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestBody = JSON.parse(options.body);
    authorization = options.headers.Authorization;
    return new Response(JSON.stringify({
      modelVersion: 'judge-a-v1',
      candidates: [{ content: { parts: [{ text: '{"score":96}' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await assert.rejects(providers.callDetailed('vertex_eval_1', 'Return JSON only', [{ role: 'user', content: 'Do regular chat' }]), /provider_not_available/);
  const judged = await providers.callDetailed('vertex_eval_1', 'Return JSON only', [{ role: 'user', content: 'Judge this answer' }], { purpose: 'evaluation' });
  assert.match(requestedUrl, /^https:\/\/aiplatform\.eu\.rep\.googleapis\.com\/v1\/projects\/test-project\/locations\/eu\/publishers\/google\/models\/judge-a:generateContent$/);
  assert.equal(authorization, 'Bearer test-vertex-token', 'ADC token must be awaited before constructing the request');
  assert.equal(requestBody.generationConfig.temperature, 0, 'judge inference should be deterministic');
  assert.equal(judged.text, '{"score":96}');
  assert.equal(judged.model, 'judge-a-v1');
  providers.vertexEvaluatorLocation = 'not/a/location';
  assert.deepEqual(providers.evaluationAvailable(), ['vertex'], 'invalid evaluator locations must fail the learning preflight');
  providers.vertexEvaluatorLocation = 'global';
  await providers.callDetailed('vertex_eval_1', 'Return JSON only', [{ role: 'user', content: 'Judge this answer' }], { purpose: 'evaluation' });
  assert.match(requestedUrl, /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/test-project\/locations\/global\/publishers\/google\/models\/judge-a:generateContent$/);
  console.log('Phase 18 Vertex evaluator tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  for (const name of names) {
    if (previous[name] == null) delete process.env[name];
    else process.env[name] = previous[name];
  }
});
