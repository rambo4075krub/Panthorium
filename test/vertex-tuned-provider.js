const assert = require('assert');

(async () => {
  const env = {
    SENTINEL_VERTEX_PROJECT_ID: process.env.SENTINEL_VERTEX_PROJECT_ID,
    SENTINEL_VERTEX_LOCATION: process.env.SENTINEL_VERTEX_LOCATION,
    SENTINEL_VERTEX_ENDPOINT_ID: process.env.SENTINEL_VERTEX_ENDPOINT_ID,
    SENTINEL_VERTEX_MODEL: process.env.SENTINEL_VERTEX_MODEL,
    AI_PRIORITY: process.env.AI_PRIORITY,
    VERTEX_PROJECT: process.env.VERTEX_PROJECT,
    VERTEX_LOCATION: process.env.VERTEX_LOCATION,
    VERTEX_ENDPOINT_ID: process.env.VERTEX_ENDPOINT_ID,
    VERTEX_MODEL: process.env.VERTEX_MODEL
  };
  Object.assign(process.env, {
    SENTINEL_VERTEX_PROJECT_ID: 'test-project',
    SENTINEL_VERTEX_LOCATION: 'europe-west4',
    SENTINEL_VERTEX_ENDPOINT_ID: 'endpoint-123',
    SENTINEL_VERTEX_MODEL: 'sentinel-v4',
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
    assert.equal(result.model, 'sentinel-v4');
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
    assert.equal(requests.length, 3);
    assert.equal(second.text, 'Sentinel direct response');
    assert.equal(requests.filter((request) => request.url.startsWith('http://metadata.google.internal/')).length, 1, 'short-lived ADC token must be reused until near expiry');
    assert(requests[1].url.includes('europe-west4-aiplatform.googleapis.com/v1/projects/test-project/locations/europe-west4/endpoints/endpoint-123:generateContent'));
    assert.equal(requests[1].options.headers.Authorization, 'Bearer short-lived-test-token');
    const payload = JSON.parse(requests[1].options.body);
    assert.equal(payload.systemInstruction.parts[0].text, 'System instruction');
    assert.equal(payload.contents[0].parts[0].text, 'Hello');
    // Test streamDetailed with Vertex
    let streamedText = '';
    const streamResult = await manager.streamDetailed('vertex', 'System instruction', [{ role: 'user', content: 'Stream test' }], {}, (delta) => {
      streamedText += delta;
    });
    assert.equal(streamResult.text, 'Sentinel direct response');
    assert.equal(streamResult.streaming, 'buffered');
    assert.equal(streamedText, 'Sentinel direct response');

    // Test direct VERTEX_ACCESS_TOKEN override
    process.env.VERTEX_ACCESS_TOKEN = 'manual-direct-token';
    const overrideManager = new ProviderManager();
    const token = await overrideManager.vertexAccessToken();
    assert.equal(token, 'manual-direct-token');
    delete process.env.VERTEX_ACCESS_TOKEN;

    // Production deployments can still have the original VERTEX_* settings.
    delete process.env.SENTINEL_VERTEX_PROJECT_ID;
    delete process.env.SENTINEL_VERTEX_LOCATION;
    delete process.env.SENTINEL_VERTEX_ENDPOINT_ID;
    delete process.env.SENTINEL_VERTEX_MODEL;
    process.env.VERTEX_PROJECT = 'legacy-project';
    process.env.VERTEX_LOCATION = 'eu';
    process.env.VERTEX_ENDPOINT_ID = 'legacy-endpoint';
    process.env.VERTEX_MODEL = 'legacy-model';
    const legacyManager = new ProviderManager();
    assert.equal(legacyManager.vertexConfigured(), true);
    assert.equal(legacyManager.vertex.project, 'legacy-project');
    assert.equal(legacyManager.vertex.location, 'eu');
    assert.equal(legacyManager.vertex.endpointId, 'legacy-endpoint');
    assert.equal(legacyManager.models.vertex, 'legacy-model');

    console.log('Vertex tuned endpoint direct API tests passed');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
})().catch((error) => { console.error(error); process.exit(1); });
