const { randomUUID } = require('crypto');

class AgentService {
  constructor({ tools, audit } = {}) { this.tools = tools; this.audit = audit; }
  catalogFor(user) {
    const permissions = new Set(user?.permissions || []);
    return this.tools.catalog().filter((tool) => !tool.permission || permissions.has(tool.permission));
  }
  async execute({ user, toolId, args = {}, confirmed = false, requestId }) {
    const tool = this.tools.get(toolId);
    if (!tool) return { ok: false, error: 'tool_not_found' };
    const permissions = new Set(user?.permissions || []);
    if (tool.permission && !permissions.has(tool.permission)) return { ok: false, error: 'tool_permission_denied' };
    if (tool.requiresConfirmation && !confirmed) return { ok: false, error: 'confirmation_required', tool: { id: tool.id, description: tool.description, mutates: !!tool.mutates } };
    const runId = randomUUID(); const started = Date.now();
    this.audit?.record('agent.tool_started', { userId: user?.sub, requestId, runId, toolId: tool.id, mutates: !!tool.mutates });
    try {
      const output = await tool.run({ userId: user?.sub, user, args });
      this.audit?.record('agent.tool_completed', { userId: user?.sub, requestId, runId, toolId: tool.id, durationMs: Date.now() - started, mutates: !!tool.mutates });
      return { ok: true, runId, toolId: tool.id, output, durationMs: Date.now() - started };
    } catch (error) {
      this.audit?.record('agent.tool_failed', { userId: user?.sub, requestId, runId, toolId: tool.id, durationMs: Date.now() - started, error: error.message });
      return { ok: false, runId, toolId: tool.id, error: error.message || 'tool_failed' };
    }
  }
}
module.exports = { AgentService };
