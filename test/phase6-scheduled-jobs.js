const assert = require('assert');
const { AgentJobRepository } = require('../services/agentJobRepository');
const { AgentSchedulerService } = require('../services/agentSchedulerService');

(async () => {
  const jobs = new AgentJobRepository();
  await jobs.init();
  const events = [];
  const users = new Map([
    ['u1', { id: 'u1', username: 'operator', roles: ['operator'], permissions: ['chat','system:read'] }],
    ['u2', { id: 'u2', username: 'disabled', roles: ['operator'], permissions: [] }]
  ]);
  let mode = 'complete';
  const workflow = {
    async run({ user }) {
      if (mode === 'confirm') return { ok: true, workflowId: 'wf-confirm', confirmationRequired: true, pendingStep: { toolId: 'conversation.clear' } };
      return { ok: true, workflowId: 'wf-done', completed: true, results: [{ ok: true, userId: user.sub }] };
    },
    async cancel() { return { ok: true, cancelled: true }; }
  };
  const runs = { async getAny(id) { return id === 'wf-confirm' ? { status: 'completed', error: null } : null; } };
  const authService = { repository: { async findUserById(id) { return users.get(id) || null; } } };
  const audit = { record(event, data) { events.push({ event, data }); } };
  const scheduler = new AgentSchedulerService({ jobs, workflow, runs, audit, authService, pollMs: 60000, workerId: 'test-worker' });
  await scheduler.init();

  const future = new Date(Date.now() + 60000).toISOString();
  const scheduled = await scheduler.schedule({ user: { sub: 'u1', roles: ['operator'], permissions: ['chat'] }, request: 'check status later', runAt: future, requestId: 'r1' });
  assert.equal(scheduled.ok, true);
  assert.equal(scheduled.job.status, 'scheduled');
  assert.equal((await scheduler.list('u1', 10)).length, 1);

  const guest = await scheduler.schedule({ user: { sub: 'guest:1', permissions: ['chat'] }, request: 'later', runAt: future });
  assert.equal(guest.error, 'scheduled_jobs_require_account');

  const cancelled = await scheduler.cancel({ user: { sub: 'u1' }, jobId: scheduled.job.jobId, requestId: 'r2' });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.job.status, 'cancelled');

  const due = await jobs.create({ userId: 'u1', userContext: { sub: 'u1', permissions: ['chat'] }, request: 'run now', runAt: new Date(Date.now() - 1000).toISOString() });
  const tick = await scheduler.tick();
  assert.equal(tick.claimed, 1);
  assert.equal((await jobs.get('u1', due.jobId)).status, 'completed');

  const revoked = await jobs.create({ userId: 'u2', userContext: { sub: 'u2', permissions: ['chat'] }, request: 'must not run', runAt: new Date(Date.now() - 1000).toISOString() });
  await scheduler.tick();
  const revokedResult = await jobs.get('u2', revoked.jobId);
  assert.equal(revokedResult.status, 'failed');
  assert.equal(revokedResult.error, 'scheduled_user_permission_denied');

  mode = 'confirm';
  const gated = await jobs.create({ userId: 'u1', userContext: { sub: 'u1', permissions: ['chat'] }, request: 'clear conversation', runAt: new Date(Date.now() - 1000).toISOString() });
  await scheduler.tick();
  const waiting = await jobs.get('u1', gated.jobId);
  assert.equal(waiting.status, 'waiting_confirmation');
  assert.equal(waiting.workflowId, 'wf-confirm');
  await scheduler.tick();
  assert.equal((await jobs.get('u1', gated.jobId)).status, 'completed');

  assert(events.some((e) => e.event === 'agent.job_scheduled'));
  assert(events.some((e) => e.event === 'agent.job_completed'));
  assert(events.some((e) => e.event === 'agent.job_waiting_confirmation'));
  console.log('Phase 6 scheduled Agent job tests passed');
})().catch((error) => { console.error(error); process.exit(1); });