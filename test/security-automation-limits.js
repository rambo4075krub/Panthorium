'use strict';
const assert = require('node:assert/strict');
const { AgentAutomationRepository } = require('../services/agentAutomationRepository');
const { AgentAutomationService } = require('../services/agentAutomationService');
const { AgentJobRepository } = require('../services/agentJobRepository');

(async () => {
  const repository = new AgentAutomationRepository(), jobs = new AgentJobRepository();
  const services = [new AgentAutomationService({ repository, jobs }), new AgentAutomationService({ repository, jobs })];
  const user = { sub: 'ordinary-account', permissions: ['chat'], roles: [] };
  const input = { user, request: 'prepare a draft', firstRunAt: new Date(Date.now()+60000).toISOString(), everyMinutes: 15 };
  const schedules = await Promise.all(Array.from({ length: 30 }, (_, i) => services[i % 2].createSchedule(input)));
  assert.equal(schedules.filter(result => result.ok).length, 10, 'Concurrent creations reserve the per-account active limit');
  assert(schedules.filter(result => !result.ok).every(result => result.error === 'automation_schedule_limit_reached'));
  assert(schedules.filter(result => result.ok).every(result => result.schedule.maxRuns === 100), 'Omitted maxRuns is bounded');
  const service = services[0];
  assert.equal((await service.createSchedule({ ...input, maxRuns: 101 })).error, 'automation_max_runs_exceeded');
  await service.disableSchedule({ user, scheduleId: schedules.find(result => result.ok).schedule.scheduleId });
  // The most recent rows can be disabled without hiding older active rows.
  for (let i = 0; i < 15; i++) {
    const result = await service.createSchedule(input); assert(result.ok);
    await service.disableSchedule({ user, scheduleId: result.schedule.scheduleId });
  }
  assert((await service.createSchedule(input)).ok);
  assert.equal((await service.createSchedule(input)).error, 'automation_schedule_limit_reached');
  const triggers = await Promise.all(Array.from({ length: 30 }, (_, i) => services[i % 2].createTrigger({ user, eventKey: 'custom.event', request: 'prepare a draft' })));
  assert.equal(triggers.filter(result => result.ok).length, 10);
  assert(triggers.filter(result => !result.ok).every(result => result.error === 'automation_trigger_limit_reached'));
  const other = { ...user, sub: 'other-account' };
  assert((await service.createSchedule({ ...input, user: other })).ok, 'One user cannot consume another user quota');
  const final = [...repository.schedules.values()].find(item => item.userId === user.sub && item.enabled);
  repository.schedules.set(final.scheduleId, { ...final, runCount: 99, nextRunAt: new Date(Date.now()-1000).toISOString() });
  assert.equal((await service.materializeDue()).length, 1);
  assert.equal(repository.schedules.get(final.scheduleId).enabled, false, 'Bounded default stops the final occurrence');
  assert.equal((await service.materializeDue()).length, 0);
  // Simulate pre-upgrade records, bypassing creation's new finite default.
  for (const [id, runCount, roles, cap] of [
    ['legacy-last', 99, [], 100], ['legacy-exhausted', 100, [], 100],
    ['legacy-overrun', 400, [], 100], ['legacy-operator', 249, ['operator'], 250],
    ['legacy-administrator', 999, ['administrator'], 1000]
  ]) {
    repository.schedules.set(id, { ...final, scheduleId:id, maxRuns:null, runCount, enabled:true,
      userContext:{...user,roles},nextRunAt:new Date(Date.now()-1000).toISOString() });
    assert.equal((await service.materializeDue()).length, runCount < cap ? 1 : 0);
    const after = repository.schedules.get(id);
    assert.equal(after.maxRuns, cap); assert.equal(after.enabled, false);
    assert.equal(after.runCount, runCount < cap ? cap : runCount);
  }
  assert.equal((await service.materializeDue()).length, 0, 'Legacy unlimited rows cannot create further occurrences');
  console.log('Security automation limits: concurrent schedule/trigger caps, disabled history, owner separation and finite default runs passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
