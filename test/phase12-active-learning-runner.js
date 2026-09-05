'use strict';

const assert = require('assert');
const { SentinelActiveLearningService } = require('../services/sentinelActiveLearningService');

let draftCalls = 0;
let shadowCalls = 0;
let promoted = false;
const shadowVersion = {
  versionId: 'shadow-1',
  exampleId: 'example-1',
  state: 'shadow',
  score: 94,
  shadowSamples: 0,
  shadowScore: null,
  metadata: {}
};

const training = {
  async init() {},
  async draftWithTeachers(args) {
    draftCalls += 1;
    assert(args.prompt.includes('Active Learning'));
    assert.deepEqual(args.providerNames, ['groq', 'openai']);
    assert(args.tags.includes('active-learning'));
    return { ok: true, candidates: [{ provider: 'groq' }], failures: [] };
  }
};

const learning = {
  policy: { shadowMinSamples: 1 },
  async init() {},
  repository: {
    async list({ state } = {}) { return state === 'shadow' ? [shadowVersion] : [shadowVersion]; }
  },
  async exampleFor(exampleId) {
    assert.equal(exampleId, 'example-1');
    return { exampleId, prompt: 'ทดสอบ Active Learning', answer: 'คำตอบ', provider: 'groq' };
  },
  async recordShadow(versionId, sample) {
    assert.equal(versionId, 'shadow-1');
    shadowCalls += 1;
    shadowVersion.shadowSamples += 1;
    shadowVersion.shadowScore = sample.score;
    return { ok: true, version: shadowVersion };
  },
  async promoteIfReady(versionId) {
    assert.equal(versionId, 'shadow-1');
    promoted = shadowVersion.shadowSamples >= 1;
    return { ok: true, promoted, version: { ...shadowVersion, state: promoted ? 'active' : 'shadow' } };
  }
};

const providers = {
  available() { return ['groq', 'openai']; },
  catalog() { return [{ provider: 'groq' }, { provider: 'openai' }]; },
  async callDetailed(provider) {
    assert.equal(provider, 'openai');
    return { text: '{"score":94,"safe":true,"reason":"provider shadow evaluation passed"}', model: 'mock-model' };
  }
};

(async () => {
  const service = new SentinelActiveLearningService({ training, learning, providers, minIntervalMs: 5 });
  await service.init();
  const started = await service.start({ durationHours: 0.05, intervalMinutes: 0.001, batchSize: 1, providers: ['groq', 'openai'], userId: 'admin-test' });
  assert.equal(started.ok, true);
  assert.equal(started.running, true);
  assert.equal(started.run.options.durationHours, 0.05);
  assert.equal(started.run.options.manualActivationRequired, true);

  service.shutdown();
  await service.tick();
  assert.equal(draftCalls, 1);
  assert.equal(shadowCalls, 1);
  assert.equal(service.session.stats.cycles, 1);
  assert.equal(service.session.stats.candidates, 1);
  assert.equal(service.session.stats.shadowSamples, 1);

  const activated = await service.activate({ userId: 'admin-test', stop: true });
  assert.equal(activated.ok, true);
  assert.equal(activated.promoted, 1);
  assert.equal(activated.stopped, true);
  assert.equal(service.session.status, 'activated');
  assert.equal(promoted, true);

  const status = await service.status();
  assert.equal(status.running, false);
  assert.equal(status.run.status, 'activated');
  service.shutdown();
  console.log('Phase 12 Active Learning runner tests passed');
})().catch((error) => {
  service?.shutdown?.();
  console.error(error);
  process.exit(1);
});
