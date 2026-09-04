const { randomUUID } = require('crypto');

class AgentSchedulerService {
  constructor({ jobs, workflow, runs, audit, pollMs = 5000, workerId } = {}) {
    this.jobs = jobs; this.workflow = workflow; this.runs = runs; this.audit = audit;
    this.pollMs = Math.max(1000, Number(pollMs) || 5000); this.workerId = workerId || `scheduler:${randomUUID()}`;
    this.timer = null; this.running = false;
  }

  async init() { await this.jobs?.init?.(); await this.jobs?.recoverStale?.(); }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => console.error('[AGENT SCHEDULER]', error)), this.pollMs);
    this.timer.unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  validateRunAt(value) {
    const time = Date.parse(value); if (!Number.isFinite(time)) return { ok: false, error: 'invalid_run_at' };
    const now = Date.now(); if (time < now + 1000) return { ok: false, error: 'run_at_must_be_future' };
    if (time > now + 366 * 24 * 60 * 60 * 1000) return { ok: false, error: 'run_at_too_far' };
    return { ok: true, runAt: new Date(time).toISOString() };
  }

  async schedule({ user, request, provider, runAt, requestId } = {}) {
    const text = String(request || '').trim(); if (!text || text.length > 8000) return { ok: false, error: 'invalid_agent_request' };
    const timing = this.validateRunAt(runAt); if (!timing.ok) return timing;
    if (provider != null && (typeof provider !== 'string' || !provider.trim() || provider.length > 40)) return { ok: false, error: 'invalid_provider' };
    const userContext = { sub: user?.sub, role: user?.role || 'guest', permissions: Array.isArray(user?.permissions) ? [...user.permissions] : [] };
    if (!userContext.sub) return { ok: false, error: 'invalid_user' };
    const job = await this.jobs.create({ userId: userContext.sub, userContext, request: text, provider: provider?.toLowerCase() || null, runAt: timing.runAt, status: 'scheduled' });
    this.audit?.record('agent.job_scheduled', { userId: userContext.sub, requestId, jobId: job.jobId, runAt: job.runAt, provider: job.provider });
    return { ok: true, job };
  }

  async list(userId, limit) { return this.jobs.list(userId, limit); }
  async get(userId, jobId) { return this.jobs.get(userId, jobId); }

  async cancel({ user, jobId, requestId } = {}) {
    const current = await this.jobs.get(user?.sub, jobId); if (!current) return { ok: false, error: 'agent_job_not_found' };
    if (current.status === 'waiting_confirmation' && current.workflowId) await this.workflow.cancel({ user, workflowId: current.workflowId, requestId }).catch(() => null);
    const job = await this.jobs.cancel(user.sub, jobId); if (!job) return { ok: false, error: 'agent_job_not_cancellable' };
    this.audit?.record('agent.job_cancelled', { userId: user.sub, requestId, jobId, workflowId: job.workflowId || null });
    return { ok: true, job };
  }

  async syncWaiting() {
    if (!this.runs) return;
    const waiting = await this.jobs.listWaiting(50);
    for (const job of waiting) {
      const run = await this.runs.getAny(job.workflowId); if (!run || ['planned','running','waiting_confirmation'].includes(run.status)) continue;
      const terminal = ['completed','failed','cancelled','expired'].includes(run.status) ? run.status : 'failed';
      await this.jobs.finish(job.jobId, { status: terminal, error: run.error || null, result: { workflowId: job.workflowId, runStatus: run.status }, completedAt: new Date().toISOString() });
      this.audit?.record('agent.job_terminal', { userId: job.userId, jobId: job.jobId, workflowId: job.workflowId, status: terminal, error: run.error || null });
    }
  }

  async executeJob(job) {
    this.audit?.record('agent.job_started', { userId: job.userId, jobId: job.jobId, workerId: this.workerId, attempts: job.attempts });
    try {
      const result = await this.workflow.run({ user: job.userContext, request: job.request, preferredProvider: job.provider || undefined, requestId: `job:${job.jobId}` });
      if (result.confirmationRequired) {
        const next = await this.jobs.finish(job.jobId, { status: 'waiting_confirmation', workflowId: result.workflowId || null, result: { confirmationRequired: true, pendingStep: result.pendingStep || null }, error: null });
        this.audit?.record('agent.job_waiting_confirmation', { userId: job.userId, jobId: job.jobId, workflowId: result.workflowId || null }); return next;
      }
      if (!result.ok) {
        const next = await this.jobs.finish(job.jobId, { status: 'failed', workflowId: result.workflowId || null, result, error: result.error || 'workflow_failed', completedAt: new Date().toISOString() });
        this.audit?.record('agent.job_failed', { userId: job.userId, jobId: job.jobId, workflowId: result.workflowId || null, error: result.error || 'workflow_failed' }); return next;
      }
      const next = await this.jobs.finish(job.jobId, { status: 'completed', workflowId: result.workflowId || null, result, error: null, completedAt: new Date().toISOString() });
      this.audit?.record('agent.job_completed', { userId: job.userId, jobId: job.jobId, workflowId: result.workflowId || null }); return next;
    } catch (error) {
      const next = await this.jobs.finish(job.jobId, { status: 'failed', error: String(error?.message || 'scheduler_error').slice(0,500), completedAt: new Date().toISOString() });
      this.audit?.record('agent.job_failed', { userId: job.userId, jobId: job.jobId, error: String(error?.message || 'scheduler_error').slice(0,500) }); return next;
    }
  }

  async tick() {
    if (this.running) return { ok: true, skipped: true };
    this.running = true;
    try {
      await this.syncWaiting();
      const jobs = await this.jobs.claimDue(this.workerId, 5);
      for (const job of jobs) await this.executeJob(job);
      return { ok: true, claimed: jobs.length };
    } finally { this.running = false; }
  }
}

module.exports = { AgentSchedulerService };