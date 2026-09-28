'use strict';

const assert = require('assert');
const { SentinelActiveLearningService, rateLimitDelayMs } = require('../services/sentinelActiveLearningService');

let draftCalls = 0;
const training = {
  async init() {},
  async draftWithTeachers(args) {
    draftCalls += 1;
    assert(args.tags.includes('active-learning'));
    return { ok: true, candidates: [{ provider: 'groq' }], failures: [] };
  }
};

const learning = {
  policy: { shadowMinSamples: 3 },
  async init() {},
  repository: {
    async list() { return []; }
  }
};

const providers = {
  available() { return ['groq']; },
  catalog() { return [{ provider: 'groq' }]; }
};

(async () => {
  assert.equal(rateLimitDelayMs(new Error('Provider HTTP 429: Please try again in 6m59.904s')), 419904);
  assert.equal(rateLimitDelayMs(new Error('ordinary provider failure')), 0);
  const service = new SentinelActiveLearningService({ training, learning, providers, minIntervalMs: 5 });
  await service.init();
  const started = await service.start({ durationHours: 0.05, intervalMinutes: 1, batchSize: 1, maxPrompts: 1, maxCandidates: 10, maxFailures: 5, maxConsecutiveFailures: 2, maxUnsafeShadow: 1, providers: ['groq'], userId: 'admin-test' });
  assert.equal(started.ok, true);
  assert.equal(started.running, true);

  service.shutdown();
  await service.tick();
  assert.equal(draftCalls, 1);
  assert.equal(service.session.status, 'guarded');
  assert.equal(service.session.stats.stopReason, 'max_prompts_reached');
  assert.equal(service.session.stats.prompts, 1);

  const status = await service.status();
  assert.equal(status.running, false);
  assert.equal(status.run.status, 'guarded');
  assert(status.history.length >= 1);
  service.shutdown();

  const pausedService = new SentinelActiveLearningService({
    training: {
      async init() {},
      async draftWithTeachers() { return { ok: false, candidates: [], failures: [{ provider: 'groq', error: 'Provider HTTP 429: Please try again in 2s' }] }; }
    },
    learning,
    providers,
    minIntervalMs: 5
  });
  await pausedService.init();
  await pausedService.start({ never: true, providers: ['groq'], userId: 'never-test' });
  pausedService.shutdown();
  await pausedService.tick();
  assert.equal(pausedService.session.status, 'paused');
  assert.equal(pausedService.session.stats.pauseReason, 'provider_rate_limit');
  assert.equal(pausedService.session.stats.failures, 0);
  assert(new Date(pausedService.session.stats.resumeAt).getTime() > Date.now());
  pausedService.shutdown();
  pausedService.session.stats.resumeAt = new Date(Date.now() - 1).toISOString();
  await pausedService.resumeFromPause();
  assert.equal(pausedService.session.status, 'running');
  pausedService.shutdown();
  console.log('Phase 12 Active Learning guardrail tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
