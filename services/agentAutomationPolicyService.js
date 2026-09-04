class AgentAutomationPolicyService {
  profile(user) {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    const authenticated = !!user?.sub && !String(user.sub).startsWith('guest:');
    const administrator = roles.includes('administrator');
    const operator = roles.includes('operator');
    const chat = permissions.includes('chat');
    if (!authenticated || !chat) return { tier: 'guest', enabled: false, maxSchedules: 0, maxTriggers: 0, minEveryMinutes: 60, maxRuns: 0, canEmitEvents: false };
    if (administrator) return { tier: 'administrator', enabled: true, maxSchedules: 50, maxTriggers: 50, minEveryMinutes: 1, maxRuns: 1000, canEmitEvents: true };
    if (operator) return { tier: 'operator', enabled: true, maxSchedules: 20, maxTriggers: 20, minEveryMinutes: 5, maxRuns: 250, canEmitEvents: true };
    return { tier: 'account', enabled: true, maxSchedules: 10, maxTriggers: 10, minEveryMinutes: 15, maxRuns: 100, canEmitEvents: false };
  }

  async evaluateSchedule({ user, repository, everyMinutes, maxRuns }) {
    const limits = this.profile(user);
    if (!limits.enabled) return { ok: false, error: 'automation_policy_denied', limits };
    if (Number(everyMinutes) < limits.minEveryMinutes) return { ok: false, error: 'automation_interval_too_short', limits };
    if (maxRuns != null && Number(maxRuns) > limits.maxRuns) return { ok: false, error: 'automation_max_runs_exceeded', limits };
    const schedules = await repository.listSchedules(user.sub, limits.maxSchedules + 1);
    const active = schedules.filter((item) => item.enabled !== false).length;
    if (active >= limits.maxSchedules) return { ok: false, error: 'automation_schedule_limit_reached', limits };
    return { ok: true, limits };
  }

  async evaluateTrigger({ user, repository }) {
    const limits = this.profile(user);
    if (!limits.enabled) return { ok: false, error: 'automation_policy_denied', limits };
    const triggers = await repository.listTriggers(user.sub, limits.maxTriggers + 1);
    const active = triggers.filter((item) => item.enabled !== false).length;
    if (active >= limits.maxTriggers) return { ok: false, error: 'automation_trigger_limit_reached', limits };
    return { ok: true, limits };
  }

  evaluateEmit(user) {
    const limits = this.profile(user);
    return limits.canEmitEvents ? { ok: true, limits } : { ok: false, error: 'automation_event_emit_denied', limits };
  }
}
module.exports = { AgentAutomationPolicyService };