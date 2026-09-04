const { randomUUID } = require('crypto');

class AgentPlannerService {
  constructor({ agentService, gateway, audit } = {}) { this.agentService = agentService; this.gateway = gateway; this.audit = audit; }
  toolCatalog(user) {
    return this.agentService.catalogFor(user).map((tool) => ({ id: tool.id, description: tool.description, argsSchema: tool.argsSchema || {}, permission: tool.permission || null, risk: tool.risk || 'low', mutates: !!tool.mutates, requiresConfirmation: !!tool.requiresConfirmation }));
  }
  plannerPrompt(tools) {
    return `You are the Panthorium Agent Planner. Choose whether a user request should use one registered tool.\nReturn ONLY valid JSON with this shape: {"action":"tool"|"answer","toolId":string|null,"args":object,"reason":string,"answer":string|null}.\nRules:\n- Use only a tool id from the catalog below.\n- Never invent tools or argument names.\n- Follow each tool argsSchema exactly.\n- Prefer action=answer when no tool is necessary.\n- Respect risk metadata. High/critical or mutating tools require explicit confirmation before execution.\n- Keep reason short.\nTool catalog:\n${JSON.stringify(tools)}`;
  }
  parsePlan(text, tools) {
    let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''); let plan;
    try { plan = JSON.parse(raw); } catch { return { ok: false, error: 'invalid_plan_json' }; }
    if (!plan || !['tool', 'answer'].includes(plan.action)) return { ok: false, error: 'invalid_plan_action' };
    if (plan.action === 'answer') return { ok: true, plan: { action: 'answer', toolId: null, args: {}, reason: String(plan.reason || '').slice(0, 500), answer: String(plan.answer || '').slice(0, 8000) } };
    const tool = tools.find((item) => item.id === plan.toolId); if (!tool) return { ok: false, error: 'invalid_plan_tool' };
    if (plan.args != null && (typeof plan.args !== 'object' || Array.isArray(plan.args))) return { ok: false, error: 'invalid_plan_args' };
    return { ok: true, plan: { action: 'tool', toolId: tool.id, args: plan.args || {}, reason: String(plan.reason || '').slice(0, 500), answer: null, risk: tool.risk || 'low', mutates: !!tool.mutates, requiresConfirmation: !!tool.requiresConfirmation } };
  }
  async plan({ user, request, preferredProvider, requestId }) {
    const tools = this.toolCatalog(user); const planId = randomUUID(); const started = Date.now(); this.audit?.record('agent.plan_started', { userId: user?.sub, requestId, planId, toolCount: tools.length });
    const result = await this.gateway.complete({ systemPrompt: this.plannerPrompt(tools), history: [{ role: 'user', content: String(request).trim() }], preferredProvider, userId: user?.sub, sessionId: `agent-plan:${planId}` });
    if (!result.ok) { this.audit?.record('agent.plan_failed', { userId: user?.sub, requestId, planId, error: result.error || 'planner_failed', durationMs: Date.now() - started }); return { ok: false, planId, error: result.error || 'planner_failed', text: result.text || '' }; }
    const parsed = this.parsePlan(result.text, tools); if (!parsed.ok) { this.audit?.record('agent.plan_failed', { userId: user?.sub, requestId, planId, error: parsed.error, provider: result.provider, durationMs: Date.now() - started }); return { ok: false, planId, error: parsed.error }; }
    if (parsed.plan.action === 'tool') { const validation = this.agentService.validateArgs(parsed.plan.toolId, parsed.plan.args); if (!validation.ok) { this.audit?.record('agent.plan_failed', { userId: user?.sub, requestId, planId, error: validation.error, toolId: parsed.plan.toolId, provider: result.provider, durationMs: Date.now() - started }); return { ok: false, planId, error: validation.error, toolId: parsed.plan.toolId }; } }
    const response = { ok: true, planId, plan: parsed.plan, provider: result.provider || null, model: result.model || null, latencyMs: Date.now() - started };
    this.audit?.record('agent.plan_completed', { userId: user?.sub, requestId, planId, action: parsed.plan.action, toolId: parsed.plan.toolId || null, risk: parsed.plan.risk || null, provider: response.provider, durationMs: response.latencyMs }); return response;
  }
  async run({ user, request, preferredProvider, confirmed = false, requestId }) {
    const planned = await this.plan({ user, request, preferredProvider, requestId }); if (!planned.ok) return planned;
    if (planned.plan.action === 'answer') return { ...planned, executed: false, answer: planned.plan.answer || '' };
    if (planned.plan.requiresConfirmation && !confirmed) return { ...planned, executed: false, confirmationRequired: true };
    const execution = await this.agentService.execute({ user, toolId: planned.plan.toolId, args: planned.plan.args, confirmed, requestId }); return { ...planned, executed: execution.ok, execution };
  }
}
module.exports = { AgentPlannerService };
