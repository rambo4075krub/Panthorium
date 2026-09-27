const assert = require('assert');

(async () => {
  const env = {
    SENTINEL_VERTEX_PROJECT_ID: process.env.SENTINEL_VERTEX_PROJECT_ID,
    SENTINEL_VERTEX_LOCATION: process.env.SENTINEL_VERTEX_LOCATION,
    SENTINEL_VERTEX_ENDPOINT_ID: process.env.SENTINEL_VERTEX_ENDPOINT_ID,
    AI_PRIORITY: process.env.AI_PRIORITY
  };
  Object.assign(process.env, {
    SENTINEL_VERTEX_PROJECT_ID: 'test-project',
    SENTINEL_VERTEX_LOCATION: 'europe-west4',
    SENTINEL_VERTEX_ENDPOINT_ID: 'endpoint-123',
    AI_PRIORITY: 'vertex'
  });
  const { ProviderManager } = require('../services/providerManager');
  const manager = new ProviderManager();
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith('http://metadata.google.internal/')) {
      return new Response(JSON.stringify({ access_token: 'short-lived-test-token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Sentinel direct response' }] } }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(manager.available(), ['vertex']);
    const result = await manager.callDetailed('vertex', 'System instruction', [{ role: 'user', content: 'Hello' }]);
    const second = await manager.callDetailed('vertex', 'System instruction', [{ role: 'user', content: 'Again' }]);
    assert.equal(result.text, 'Sentinel direct response');
    assert.equal(result.model, 'sentinel-v3');
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
    assert.equal(requests.length, 3);
    assert.equal(second.text, 'Sentinel direct response');
    assert.equal(requests.filter((request) => request.url.startsWith('http://metadata.google.internal/')).length, 1, 'short-lived ADC token must be reused until near expiry');
    assert(requests[1].url.includes('europe-west4-aiplatform.googleapis.com/v1/projects/test-project/locations/europe-west4/endpoints/endpoint-123:generateContent'));
    assert.equal(requests[1].options.headers.Authorization, 'Bearer short-lived-test-token');
    const payload = JSON.parse(requests[1].options.body);
    assert.equal(payload.systemInstruction.parts[0].text, 'System instruction');
    assert.equal(payload.contents[0].parts[0].text, 'Hello');
    console.log('Vertex tuned endpoint direct API tests passed');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
})().catch((error) => { console.error(error); process.exit(1); });
