'use strict';

const assert = require('node:assert/strict');
const { SentinelTrainingRepository } = require('../services/sentinelTrainingRepository');
const { SentinelTrainingService } = require('../services/sentinelTrainingService');
const { SentinelActiveLearningService } = require('../services/sentinelActiveLearningService');

const evaluatorProviders = ['vertex_eval_1', 'vertex_eval_2'];
const providerSet = {
  available() { return ['vertex']; },
  evaluationAvailable() { return ['vertex', ...evaluatorProviders]; },
  catalog() { return [{ provider: 'vertex' }]; },
  async callDetailed(provider) {
    if (provider === 'vertex') return { text: 'This teacher answer is sufficiently long, relevant, and ready for independent review.', model: 'sentinel-v4' };
    if (!evaluatorProviders.includes(provider)) throw new Error(`unexpected_provider:${provider}`);
    return { text: JSON.stringify({ score: 96, safe: true, correct: true, relevant: true, reason: 'passes' }), model: provider };
  }
};
const learningStub = {
  policy: { shadowMinSamples: 30 },
  async init() {},
  repository: { async list() { return []; } }
};

(async () => {
  const training = new SentinelTrainingService({
    repository: new SentinelTrainingRepository(), providers: providerSet, learning: null,
    autoEnabled: false, teacherProviders: ['vertex'], evaluatorProviders,
    minEvaluators: 2, audit: { record() {} }
  });
  const added = await training.addExample({
    prompt: 'ตรวจตัวอย่างที่สร้างจาก Vertex',
    answer: 'นี่คือตัวอย่างคำตอบที่ยาวพอสำหรับการตรวจคุณภาพแบบอิสระ',
    source: 'teacher:vertex', provider: 'vertex', user: { sub: 'admin-test' }, autoEvaluate: false
  });
  assert.equal(added.example.status, 'pending');
  assert.equal((await training.autoEvaluateExample(added.example)).error, 'auto_training_disabled');
  const judged = await training.autoEvaluateExample(added.example, { force: true, requestId: 'manual-run' });
  assert.equal(judged.status, 'approved', 'an explicitly started run can evaluate while startup automation remains disabled');
  assert.deepEqual(judged.judges.map(item => item.provider).sort(), evaluatorProviders);
  assert.equal(judged.example.status, 'approved');

  const noJudges = new SentinelTrainingService({
    repository: new SentinelTrainingRepository(), providers: {
      ...providerSet, evaluationAvailable() { return ['vertex']; }
    }, teacherProviders: ['vertex'], evaluatorProviders, minEvaluators: 2, autoEnabled: false
  });
  const runner = new SentinelActiveLearningService({ training: noJudges, learning: learningStub, providers: { ...providerSet, evaluationAvailable() { return ['vertex']; } }, minIntervalMs: 5 });
  const refused = await runner.start({ providers: ['vertex'], autoShadow: false, userId: 'admin-test' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'no_independent_evaluators');
  assert.equal(runner.timer, null, 'a run without evaluator quorum must not start');

  const active = new SentinelActiveLearningService({ training, learning: learningStub, providers: providerSet, minIntervalMs: 5 });
  await active.init();
  const started = await active.start({ providers: ['vertex'], autoShadow: false, durationHours: 0.05, intervalMinutes: 1, userId: 'admin-test' });
  assert.equal(started.ok, true);
  active.shutdown();
  await active.tick();
  active.shutdown();
  assert.equal(active.session.stats.evaluations, 1);
  assert.equal(active.session.stats.approved, 1);
  assert.equal(active.session.stats.candidates, 1);
  console.log('Phase 18 Vertex-only manual learning tests passed');
})().catch(error => { console.error(error); process.exit(1); });
