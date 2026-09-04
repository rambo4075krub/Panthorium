const assert = require('assert');
const { AgentAutomationPolicyService } = require('../services/agentAutomationPolicyService');
const { AgentAutomationService } = require('../services/agentAutomationService');

(async () => {
  const policy = new AgentAutomationPolicyService();
  const admin = { sub: 'a1', roles: ['administrator'], permissions: ['chat','system:read','settings','core:command'] };
  const operator = { sub: 'o1', roles: ['operator'], permissions: ['chat','system:read'] };
  const account = { sub: 'u1', roles: [], permissions: ['chat'] };
  const guest = { sub: 'guest:1', roles: ['guest'], permissions: ['chat'] };

  assert.equal(policy.profile(admin).minEveryMinutes, 1);
  assert.equal(policy.profile(operator).minEveryMinutes, 5);
  assert.equal(policy.profile(account).minEveryMinutes, 15);
  assert.equal(policy.profile(guest).enabled, false);
  assert.equal(policy.evaluateEmit(admin).ok, true);
  assert.equal(policy.evaluateEmit(account).error, 'automation_event_emit_denied');

  const schedules = [];
  const triggers = [];
  const repository = {
    async init(){},
    async listSchedules(){ return schedules; },
    async listTriggers(){ return triggers; },
    async createSchedule(input){ const item={ scheduleId:'s1', enabled:true, runCount:0, ...input }; schedules.push(item); return item; },
    async createTrigger(input){ const item={ triggerId:'t1', enabled:true, ...input }; triggers.push(item); return item; },
    async matchingTriggers(){ return []; }
  };
  const jobs = { async create(input){ return { jobId:'j1', ...input }; } };
  const events = [];
  const audit = { record:(event,data)=>events.push({event,data}) };
  const service = new AgentAutomationService({ repository, jobs, audit, policy });

  const tooFast = await service.createSchedule({ user: operator, request:'status', firstRunAt:new Date(Date.now()+60000).toISOString(), everyMinutes:1, maxRuns:5 });
  assert.equal(tooFast.ok, false);
  assert.equal(tooFast.error, 'automation_interval_too_short');

  const allowed = await service.createSchedule({ user: operator, request:'status', firstRunAt:new Date(Date.now()+60000).toISOString(), everyMinutes:5, maxRuns:5 });
  assert.equal(allowed.ok, true);

  // Final hardening adds a service-layer account guard before policy evaluation.
  // Guests must now fail closed even if this service is called outside the HTTP router.
  const deniedGuest = await service.createTrigger({ user: guest, eventKey:'security.alert', request:'inspect alert' });
  assert.equal(deniedGuest.ok, false);
  assert.equal(deniedGuest.error, 'automation_requires_account');

  const deniedEmit = await service.emit({ user: account, eventKey:'custom.event', payload:{x:1} });
  assert.equal(deniedEmit.ok, false);
  assert.equal(deniedEmit.error, 'automation_event_emit_denied');
  assert(events.some((e)=>e.event==='agent.automation_policy_denied'));
  console.log('Phase 6 automation policy tests passed');
})().catch((error)=>{ console.error(error); process.exit(1); });