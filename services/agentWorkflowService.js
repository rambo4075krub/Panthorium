const { randomUUID } = require('crypto');

class AgentWorkflowService {
  constructor({ agentService, gateway, audit, runs, ttlMs = 10 * 60 * 1000 } = {}) {
    this.agentService = agentService;
    this.gateway = gateway;
    this.audit = audit;
    this.runs = runs || null;
    this.ttlMs = ttlMs;
    this.pending = new Map();
  }

  catalog(user) {
    return this.agentService.catalogFor(user).map((tool) => ({ id: tool.id, description: tool.description, mutates: !!tool.mutates, requiresConfirmation: !!tool.requiresConfirmation }));
  }

  prompt(tools) {
    return `You are the Panthorium Agent Workflow Planner. Build a short, safe workflow using only registered tools.\nReturn ONLY valid JSON with shape {"steps":[{"toolId":string,"args":object,"reason":string}],"answer":string|null}.\nRules:\n- Maximum 5 steps.\n- Use only tool ids from the catalog.\n- Never invent tools.\n- Keep each reason short.\n- Do not repeat the same mutating action.\n- If no tool is necessary, return an empty steps array and put the response in answer.\n- Mutating tools may appear, but execution will pause for explicit user confirmation.\nTool catalog:\n${JSON.stringify(tools)}`;
  }

  parse(text, tools) {
    let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let data; try { data = JSON.parse(raw); } catch { return { ok: false, error: 'invalid_workflow_json' }; }
    if (!data || !Array.isArray(data.steps) || data.steps.length > 5) return { ok: false, error: 'invalid_workflow_steps' };
    const catalog = new Map(tools.map((t) => [t.id, t])); const steps = [];
    for (const input of data.steps) {
      const tool = catalog.get(input?.toolId); if (!tool) return { ok: false, error: 'invalid_workflow_tool' };
      if (input.args != null && (typeof input.args !== 'object' || Array.isArray(input.args))) return { ok: false, error: 'invalid_workflow_args' };
      steps.push({ toolId: tool.id, args: input.args || {}, reason: String(input.reason || '').slice(0, 500), mutates: !!tool.mutates, requiresConfirmation: !!tool.requiresConfirmation });
    }
    return { ok: true, workflow: { steps, answer: data.answer == null ? null : String(data.answer).slice(0, 8000) } };
  }

  cleanup() { const now = Date.now(); for (const [id, wf] of this.pending.entries()) if (wf.expiresAt <= now) this.pending.delete(id); }
  async updateRun(state, patch = {}) { if (!this.runs) return; await this.runs.update(state.workflowId, { currentStep: state.index, stepCount: state.steps.length, workflow: { steps: state.steps, answer: state.answer || null }, results: state.results || [], ...patch }); }

  async plan({ user, request, preferredProvider, requestId }) {
    const workflowId = randomUUID(); const tools = this.catalog(user); const started = Date.now();
    this.audit?.record('agent.workflow_plan_started', { userId: user?.sub, requestId, workflowId, toolCount: tools.length });
    const result = await this.gateway.complete({ systemPrompt: this.prompt(tools), history: [{ role: 'user', content: String(request || '').trim() }], preferredProvider, userId: user?.sub, sessionId: `agent-workflow:${workflowId}` });
    if (!result.ok) { this.audit?.record('agent.workflow_plan_failed', { userId: user?.sub, requestId, workflowId, error: result.error || 'planner_failed' }); return { ok: false, workflowId, error: result.error || 'planner_failed' }; }
    const parsed = this.parse(result.text, tools);
    if (!parsed.ok) { this.audit?.record('agent.workflow_plan_failed', { userId: user?.sub, requestId, workflowId, error: parsed.error }); return { ok: false, workflowId, error: parsed.error }; }
    const response = { ok: true, workflowId, workflow: parsed.workflow, provider: result.provider || null, model: result.model || null };
    if (this.runs) await this.runs.create({ workflowId, userId: user?.sub, request: String(request || '').trim(), provider: response.provider, model: response.model, status: parsed.workflow.steps.length ? 'planned' : 'completed', currentStep: 0, stepCount: parsed.workflow.steps.length, workflow: parsed.workflow, results: [], completedAt: parsed.workflow.steps.length ? null : new Date().toISOString() });
    this.audit?.record('agent.workflow_plan_completed', { userId: user?.sub, requestId, workflowId, steps: parsed.workflow.steps.length, provider: result.provider, durationMs: Date.now() - started });
    return response;
  }

  async continueExecution(state, { confirmed = false, requestId } = {}) {
    const results = state.results || [];
    while (state.index < state.steps.length) {
      const step = state.steps[state.index];
      if (step.requiresConfirmation && !confirmed) {
        state.results = results; state.expiresAt = Date.now() + this.ttlMs; this.pending.set(state.workflowId, state);
        await this.updateRun(state, { status: 'waiting_confirmation' });
        return { ok: true, workflowId: state.workflowId, executed: false, confirmationRequired: true, pendingStep: { index: state.index, ...step }, results };
      }
      await this.updateRun(state, { status: 'running' });
      const execution = await this.agentService.execute({ user: state.user, toolId: step.toolId, args: step.args, confirmed: step.requiresConfirmation ? true : false, requestId });
      results.push({ index: state.index, toolId: step.toolId, ok: execution.ok, output: execution.output, error: execution.error || null, durationMs: execution.durationMs || 0 });
      state.index += 1; state.results = results; confirmed = false;
      if (!execution.ok) {
        this.pending.delete(state.workflowId);
        await this.updateRun(state, { status: 'failed', error: execution.error || 'tool_failed', completedAt: new Date().toISOString() });
        this.audit?.record('agent.workflow_failed', { userId: state.user?.sub, requestId, workflowId: state.workflowId, toolId: step.toolId, stepIndex: state.index - 1, error: execution.error || 'tool_failed' });
        return { ok: false, workflowId: state.workflowId, executed: false, error: execution.error || 'tool_failed', results };
      }
      await this.updateRun(state, { status: state.index < state.steps.length ? 'running' : 'completed', completedAt: state.index < state.steps.length ? null : new Date().toISOString() });
    }
    this.pending.delete(state.workflowId);
    this.audit?.record('agent.workflow_completed', { userId: state.user?.sub, requestId, workflowId: state.workflowId, steps: state.steps.length });
    return { ok: true, workflowId: state.workflowId, executed: true, completed: true, results, answer: state.answer || null };
  }

  async run({ user, request, preferredProvider, requestId }) {
    this.cleanup(); const planned = await this.plan({ user, request, preferredProvider, requestId }); if (!planned.ok) return planned;
    const state = { workflowId: planned.workflowId, user, steps: planned.workflow.steps, answer: planned.workflow.answer, index: 0, results: [], expiresAt: Date.now() + this.ttlMs };
    if (!state.steps.length) return { ...planned, executed: false, completed: true, answer: state.answer || '' };
    const execution = await this.continueExecution(state, { requestId }); return { ...planned, ...execution, workflow: planned.workflow };
  }

  async confirm({ user, workflowId, requestId }) {
    this.cleanup(); const state = this.pending.get(String(workflowId || ''));
    if (!state) return { ok: false, error: 'workflow_not_found' };
    if (state.user?.sub !== user?.sub) return { ok: false, error: 'workflow_permission_denied' };
    return this.continueExecution(state, { confirmed: true, requestId });
  }

  async cancel({ user, workflowId, requestId }) {
    this.cleanup(); const state = this.pending.get(String(workflowId || ''));
    if (!state) return { ok: false, error: 'workflow_not_found' };
    if (state.user?.sub !== user?.sub) return { ok: false, error: 'workflow_permission_denied' };
    this.pending.delete(state.workflowId);
    await this.updateRun(state, { status: 'cancelled', completedAt: new Date().toISOString() });
    this.audit?.record('agent.workflow_cancelled', { userId: user?.sub, requestId, workflowId: state.workflowId, stepIndex: state.index });
    return { ok: true, workflowId: state.workflowId, cancelled: true };
  }
}

module.exports = { AgentWorkflowService };
