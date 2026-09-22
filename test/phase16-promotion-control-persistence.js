const assert = require('node:assert/strict');
const { SentinelLearningRepository } = require('../services/sentinelLearningRepository');
const { SentinelLearningOrchestrator } = require('../services/sentinelLearningOrchestrator');
const { AutonomousLearningPolicy } = require('../services/autonomousLearningPolicy');

// The promotion emergency stop is an operator decision. It must survive a
// process restart and be visible to every instance, and it must fail closed
// when the durable store is unreachable.
const audit = { events: [], record(event, payload) { this.events.push({ event, payload }); } };

function orchestrator(repository, { promotionEnabled = true } = {}) {
  return new SentinelLearningOrchestrator({
    repository,
    trainingRepository: { list: async () => [] },
    audit,
    policy: new AutonomousLearningPolicy({ promotionEnabled })
  });
}

(async () => {
  // A shared repository stands in for the shared database across restarts.
  const repository = new SentinelLearningRepository({});
  await repository.init();

  const first = orchestrator(repository);
  await first.init();
  assert.equal(first.policy.promotionControl().enabled, true, 'default start must follow the environment');

  const paused = await first.setPromotionEnabled(false, { actor: 'admin-1', reason: 'incident-42' });
  assert.equal(paused.ok, true);
  assert.equal(paused.promotionControl.enabled, false);

  const stored = await repository.getControl('autonomous_promotion');
  assert.equal(stored.value.enabled, false, 'pause must be written to the durable store');
  assert.equal(stored.value.reason, 'incident-42');
  assert.equal(stored.updatedBy, 'admin-1');

  // Simulated restart with the environment default still "enabled".
  const restarted = orchestrator(repository, { promotionEnabled: true });
  await restarted.init();
  const restoredControl = restarted.policy.promotionControl();
  assert.equal(restoredControl.enabled, false, 'a restart must not silently resume promotion');
  assert.equal(restoredControl.reason, 'incident-42');

  // A second concurrent instance must also see the stop.
  const sibling = orchestrator(repository, { promotionEnabled: true });
  await sibling.init();
  assert.equal(sibling.policy.promotionControl().enabled, false, 'every instance must observe the stop');

  // Resume persists too, so the next restart stays resumed.
  const resumed = await restarted.setPromotionEnabled(true, { actor: 'admin-1' });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.promotionControl.enabled, true);
  const afterResume = orchestrator(repository, { promotionEnabled: false });
  await afterResume.init();
  assert.equal(afterResume.policy.promotionControl().enabled, true, 'persisted resume must win over the environment');

  // Fail closed when the durable store rejects a write.
  const brokenWrites = orchestrator({
    init: async () => {},
    event: async () => {},
    getControl: async () => null,
    setControl: async () => { throw new Error('store offline'); }
  });
  await brokenWrites.init();
  const failedResume = await brokenWrites.setPromotionEnabled(true, { actor: 'admin-2' });
  assert.equal(failedResume.ok, false);
  assert.equal(failedResume.error, 'promotion_control_persist_failed');
  assert.equal(failedResume.promotionControl.enabled, false, 'an unpersisted resume must fall back to paused');

  // Fail closed when the durable store cannot be read at boot.
  const brokenReads = orchestrator({
    init: async () => {},
    event: async () => {},
    getControl: async () => { throw new Error('store offline'); },
    setControl: async () => ({})
  });
  await brokenReads.init();
  assert.equal(brokenReads.policy.promotionControl().enabled, false, 'unreadable control state must pause promotion');

  assert(audit.events.some(e => e.event === 'sentinel.learning_promotion_paused'));
  assert(audit.events.some(e => e.event === 'sentinel.learning_promotion_control_persist_failed'));
  assert(audit.events.some(e => e.event === 'sentinel.learning_promotion_control_load_failed'));
  console.log('Phase 16 promotion control persistence tests passed');
})().catch(e => { console.error(e); process.exit(1); });
