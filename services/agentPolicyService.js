class AgentPolicyService {
  constructor() {
    this.levels = { low: 0, medium: 1, high: 2, critical: 3 };
  }

  normalizeRisk(value) {
    return Object.prototype.hasOwnProperty.call(this.levels, value) ? value : 'low';
  }

  evaluate({ user, tool, confirmed = false }) {
    if (!tool) return { ok: false, error: 'tool_not_found' };
    const permissions = new Set(user?.permissions || []);
    if (tool.permission && !permissions.has(tool.permission)) return { ok: false, error: 'tool_permission_denied' };

    const risk = this.normalizeRisk(tool.risk);
    const mutates = !!tool.mutates;
    const requiresConfirmation = !!tool.requiresConfirmation || mutates || risk === 'high' || risk === 'critical';

    if (risk === 'critical' && !permissions.has('core:command')) {
      return { ok: false, error: 'tool_privileged_permission_required', risk };
    }
    if (requiresConfirmation && !confirmed) {
      return {
        ok: false,
        error: 'confirmation_required',
        risk,
        requiresConfirmation: true,
        tool: { id: tool.id, description: tool.description, mutates, risk }
      };
    }
    return { ok: true, risk, requiresConfirmation };
  }
}

module.exports = { AgentPolicyService };
