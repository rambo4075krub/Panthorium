'use strict';
const assert = require('node:assert/strict');
const { ProviderManager } = require('../services/providerManager');

(async () => {
  const names = ['SENTINEL_VERTEX_PROJECT_ID','SENTINEL_VERTEX_LOCATION','SENTINEL_VERTEX_ENDPOINT_ID','SENTINEL_VERTEX_AUDIO_MODEL','SENTINEL_VERTEX_AUDIO_HOST','SENTINEL_VERTEX_AUDIO_LOCATION','VERTEX_HOST','AI_PRIORITY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    SENTINEL_VERTEX_PROJECT_ID: 'fixture-project',
    SENTINEL_VERTEX_LOCATION: 'europe-west4',
    SENTINEL_VERTEX_ENDPOINT_ID: 'sentinel-endpoint',
    SENTINEL_VERTEX_AUDIO_MODEL: 'gemini-2.5-flash-lite',
    SENTINEL_VERTEX_AUDIO_HOST: '',
    SENTINEL_VERTEX_AUDIO_LOCATION: '',
    VERTEX_HOST: '',
    AI_PRIORITY: 'vertex'
  });
  const manager = new ProviderManager();
  const originalFetch = global.fetch;
  const calls = [];
  const outputs = ['เปิด Sentinel', 'TRANSCRIPTION_UNCERTAIN'];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('http://metadata.google.internal/')) {
      return Response.json({ access_token: 'fixture-vertex-token', expires_in: 3600 });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: outputs.shift() }] } }] });
  };
  try {
    const transcript = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm;codecs=opus', 'th-TH');
    assert.equal(transcript.text, 'เปิด Sentinel');
    assert.equal(transcript.provider, 'vertex');
    assert.equal(transcript.model, 'gemini-2.5-flash-lite');
    const request = calls.find(item => item.url.includes('/publishers/google/models/'));
    assert(request, 'speech recognition must call a Vertex publisher model');
    assert(request.url.includes('/locations/europe-west4/publishers/google/models/gemini-2.5-flash-lite:generateContent'));
    assert.equal(request.options.headers.Authorization, 'Bearer fixture-vertex-token');
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'audio/webm');
    assert.equal(payload.contents[0].parts[1].inlineData.data, Buffer.from('fixture audio').toString('base64'));
    assert.match(payload.contents[0].parts[0].text, /Transcribe the attached audio exactly in Thai/);
    assert.match(payload.contents[0].parts[0].text, /TRANSCRIPTION_UNCERTAIN/);
    assert.match(payload.contents[0].parts[0].text, /Do not infer missing words/);
    assert.doesNotMatch(payload.contents[0].parts[0].text, /including names Panthorium, Sentinel, Niwat, AI, API, and ProviderManager/);
    assert(!calls.some(item => /api\.(groq|openai)\.com/.test(item.url)), 'transcription must not call revoked provider APIs');
    await assert.rejects(
      manager.transcribeAudio(Buffer.from('silence'), 'audio/webm', 'th'),
      error => error.code === 'transcription_uncertain'
    );
    assert.equal(calls.filter(item => item.url.includes('/publishers/google/models/')).length, 2);

    process.env.SENTINEL_VERTEX_LOCATION = 'eu';
    outputs.push('ทดสอบ EU');
    const euManager = new ProviderManager();
    const euTranscript = await euManager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(euTranscript.text, 'ทดสอบ EU');
    const euRequest = calls.filter(item => item.url.includes('/publishers/google/models/')).at(-1);
    assert(euRequest.url.startsWith('https://europe-west4-aiplatform.googleapis.com/'), 'Gemini 2.5 Flash-Lite must use a supported EU region');
    assert(euRequest.url.includes('/locations/europe-west4/'), 'audio request should use the supported europe-west4 model location');

    console.log('Vertex-only audio transcription tests passed');
  } finally {
    global.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
