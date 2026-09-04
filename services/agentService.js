const { randomUUID } = require('crypto');
const { AgentPolicyService } = require('./agentPolicyService');

class AgentService {
  constructor({ tools, audit, policy } = {}) { this.tools = tools; this.audit = audit; this.policy = policy || new AgentPolicyService(); }
  catalogFor(user) {
    const permissions = new Set(user?.permissions || []);
    return this.tools.catalog().filter((tool) => {
      if (tool.permission && !permissions.has(tool.permission)) return false;
      if ((tool.risk || 'low') === 'critical' && !permissions.has('core:command')) return false;
      return true;
    });
  }
  async execute({ user, toolId, args = {}, confirmed = false, requestId }) {
    const tool = this.tools.get(toolId);
    const policy = this.policy.evaluate({ user, tool, confirmed });
    if (!policy.ok) return { ...policy, toolId: tool?.id || String(toolId || '') };
    const runId = randomUUID(); const started = Date.now();
    this.audit?.record('agent.tool_started', { userId: user?.sub, requestId, runId, toolId: tool.id, mutates: !!tool.mutates, risk: policy.risk });
    try {
      const output = await tool.run({ userId: user?.sub, user, args });
      this.audit?.record('agent.tool_completed', { userId: user?.sub, requestId, runId, toolId: tool.id, durationMs: Date.now() - started, mutates: !!tool.mutates, risk: policy.risk });
      return { ok: true, runId, toolId: tool.id, output, durationMs: Date.now() - started, risk: policy.risk };
    } catch (error) {
      this.audit?.record('agent.tool_failed', { userId: user?.sub, requestId, runId, toolId: tool.id, durationMs: Date.now() - started, error: error.message, risk: policy.risk });
      return { ok: false, runId, toolId: tool.id, error: error.message || 'tool_failed', risk: policy.risk };
    }
  }
}
module.exports = { AgentService };
