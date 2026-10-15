const { randomUUID } = require('crypto');
const { AgentPolicyService } = require('./agentPolicyService');

class AgentService {
  constructor({ tools, audit, policy, ledger } = {}) { this.tools = tools; this.audit = audit; this.policy = policy || new AgentPolicyService(); this.ledger = ledger || null; this.inFlight = new Map(); }
  catalogFor(user) {
    const permissions = new Set(user?.permissions || []);
    return this.tools.catalog().filter((tool) => {
      if (tool.permission && !permissions.has(tool.permission)) return false;
      if ((tool.risk || 'low') === 'critical' && !permissions.has('sentinel:command')) return false;
      return true;
    });
  }
  validateArgs(toolId, args = {}) {
    const tool = this.tools.get(toolId);
    if (!tool) return { ok: false, error: 'tool_not_found' };
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'invalid_tool_args', tool };
    const error = typeof tool.validateArgs === 'function' ? tool.validateArgs(args) : null;
    return error ? { ok: false, error, tool } : { ok: true, tool };
  }
  receipt(action, replayed = false) {
    if (!action) return { ok: false, error: 'action_not_found' };
    const base = { actionId: action.actionId, requestId: action.requestId, actionState: action.state, toolId: action.toolId, risk: action.risk, replayed };
    if (action.result) return { ...action.result, ...base };
    if (action.state === 'awaiting_confirmation') return {
      ...base, ok: false, error: 'confirmation_required', requiresConfirmation: true,
      approvalHash: action.approvalHash, approvalExpiresAt: action.approvalExpiresAt,
      tool: { id: action.toolId, description: action.description, mutates: !!this.tools.get(action.toolId)?.mutates, risk: action.risk },
      confirmation: { actionId: action.actionId, approvalHash: action.approvalHash, approvalExpiresAt: action.approvalExpiresAt, toolId: action.toolId, args: action.args }
    };
    if (action.state === 'cancel_requested') return { ...base, ok: false, error: action.startedAt ? 'action_cancel_requested' : 'action_cancelled', cancellationEffective: !action.startedAt };
    return { ...base, ok: false, error: action.state === 'unknown' ? 'action_outcome_unknown' : 'action_in_progress', reconciliationRequired: action.state === 'unknown' };
  }
  actionError(error) {
    const allowed = new Set(['invalid_action_owner','invalid_action_id','invalid_request_id','invalid_tool_id','invalid_tool_args','tool_args_too_large','action_request_conflict','action_not_found','action_approval_invalid','action_confirmation_expired','action_ledger_unavailable']);
    return { ok: false, error: allowed.has(error.message) ? error.message : 'action_ledger_unavailable' };
  }
  async execute({ user, toolId, args = {}, confirmed = false, requestId } = {}) {
    if (requestId != null && (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256 || /[\x00-\x1f\x7f]/.test(requestId))) return { ok: false, error: 'invalid_request_id' };
    const validation = this.validateArgs(toolId, args);
    if (!validation.ok) {
      const tool = validation.tool;
      if (tool) this.audit?.record('agent.tool_rejected', { userId: user?.sub, requestId, toolId: tool.id, error: validation.error, risk: tool.risk || 'low' });
      return { ok: false, error: validation.error, toolId: tool?.id || String(toolId || ''), risk: tool?.risk || undefined };
    }
    const tool = validation.tool;
    const policy = this.policy.evaluate({ user, tool, confirmed: this.ledger ? false : confirmed });
    if (!policy.ok && policy.error !== 'confirmation_required') return { ...policy, toolId: tool.id };
    const tracksAction = !!this.ledger && (!!tool.mutates || policy.requiresConfirmation);
    if (tracksAction) {
      if (requestId == null) return { ok: false, error: 'action_request_id_required', toolId: tool.id };
      try {
        const action = await this.ledger.propose({ userId: user?.sub, requestId, toolId: tool.id, args, risk: policy.risk, requiresConfirmation: policy.requiresConfirmation, description: tool.description });
        // Model-supplied flags and arguments never approve a durable action.
        if (action.state === 'proposed') return this.runAction(user, action);
        if (this.inFlight.has(action.actionId)) return this.inFlight.get(action.actionId);
        return this.receipt(action, action.state !== 'awaiting_confirmation');
      } catch (error) { return { ...this.actionError(error), toolId: tool.id }; }
    }
    if (!policy.ok) return { ...policy, toolId: tool.id };
    return this.runTool({ user, tool, args, requestId, risk: policy.risk });
  }
  // Call only at a trusted authenticated server confirmation boundary. This is not an AI tool.
  async confirmAction({ user, actionId, approvalHash } = {}) {
    if (!this.ledger) return { ok: false, error: 'action_ledger_unavailable' };
    try {
      const action = await this.ledger.get(user?.sub, actionId);
      if (!action) return { ok: false, error: 'action_not_found' };
      const validation = this.validateArgs(action.toolId, action.args);
      if (!validation.ok) return { ok: false, error: validation.error, actionId };
      const policy = this.policy.evaluate({ user, tool: validation.tool, confirmed: true });
      if (!policy.ok) return { ...policy, actionId };
      // Check even an in-process duplicate against the frozen payload before sharing its result.
      if (typeof approvalHash !== 'string' || approvalHash !== action.approvalHash) return { ok: false, error: 'action_approval_invalid', actionId };
      if (this.inFlight.has(actionId)) return this.inFlight.get(actionId);
      return this.runAction(user, action, approvalHash);
    } catch (error) { return { ...this.actionError(error), actionId }; }
  }
  runAction(user, action, approvalHash) {
    if (this.inFlight.has(action.actionId)) return this.inFlight.get(action.actionId);
    const running = (async () => {
      let claimed;
      try { claimed = await this.ledger.claim(user?.sub, action.actionId, approvalHash); }
      catch (error) { return { ...this.actionError(error), actionId: action.actionId }; }
      if (!claimed.claimed) return this.receipt(claimed.action, true);
      const result = await this.runTool({ user, tool: this.tools.get(action.toolId), args: claimed.action.args, requestId: action.requestId, actionId: action.actionId, risk: action.risk });
      try {
        if (result.reconciliationRequired) {
          const uncertain = await this.ledger.markUnknown(user.sub, action.actionId);
          return this.receipt(uncertain);
        }
        const saved = await this.ledger.finish(user.sub, action.actionId, result.ok ? 'succeeded' : 'failed', result);
        if (!saved?.result) throw new Error('action_receipt_not_saved');
        return this.receipt(saved);
      } catch {
        // The external effect may have committed even if its receipt did not. Never retry it automatically.
        try {
          const observed = await this.ledger.markUnknown(user.sub, action.actionId);
          if (observed?.result) return this.receipt(observed, true);
        } catch { /* leave durable running receipt for reconciliation */ }
        return { ok: false, error: 'action_outcome_unknown', actionId: action.actionId, requestId: action.requestId, toolId: action.toolId, actionState: 'unknown', reconciliationRequired: true };
      }
    })();
    this.inFlight.set(action.actionId, running);
    running.finally(() => { if (this.inFlight.get(action.actionId) === running) this.inFlight.delete(action.actionId); }).catch(() => {});
    return running;
  }
  async getAction({ user, actionId } = {}) {
    if (!this.ledger) return { ok: false, error: 'action_ledger_unavailable' };
    try { const action = await this.ledger.get(user?.sub, actionId); return action ? { ok: true, action } : { ok: false, error: 'action_not_found' }; }
    catch (error) { return this.actionError(error); }
  }
  async listActions({ user, limit } = {}) {
    if (!this.ledger) return { ok: false, error: 'action_ledger_unavailable' };
    try { return { ok: true, actions: await this.ledger.list(user?.sub, limit) }; }
    catch (error) { return this.actionError(error); }
  }
  async cancelAction({ user, actionId } = {}) {
    if (!this.ledger) return { ok: false, error: 'action_ledger_unavailable' };
    try {
      const action = await this.ledger.cancel(user?.sub, actionId);
      return { ok: true, actionId, actionState: action.state, cancellationEffective: action.state === 'cancel_requested' && !action.startedAt, result: action.result || null, reconciliationRequired: action.state === 'unknown' };
    } catch (error) { return this.actionError(error); }
  }
  async runTool({ user, tool, args, requestId, actionId, risk }) {
    const runId = actionId || randomUUID(); const started = Date.now();
    this.audit?.record('agent.tool_started', { userId: user?.sub, requestId, actionId, runId, toolId: tool.id, mutates: !!tool.mutates, risk });
    try {
      const output = await tool.run({ userId: user?.sub, user, args, requestId, actionId });
      if (actionId && output?.ok === false) {
        const uncertain = !!tool.mutates && output.sideEffectNotApplied !== true;
        this.audit?.record('agent.tool_failed', { userId: user?.sub, requestId, actionId, runId, toolId: tool.id, error: String(output.error || 'tool_failed').slice(0, 160), risk });
        return { ok: false, runId, toolId: tool.id, output, error: uncertain ? 'action_outcome_unknown' : output.error || 'tool_failed', risk, ...(uncertain ? { reconciliationRequired: true } : {}) };
      }
      this.audit?.record('agent.tool_completed', { userId: user?.sub, requestId, actionId, runId, toolId: tool.id, durationMs: Date.now() - started, mutates: !!tool.mutates, risk });
      return { ok: true, runId, toolId: tool.id, output, durationMs: Date.now() - started, risk };
    } catch (error) {
      this.audit?.record('agent.tool_failed', { userId: user?.sub, requestId, actionId, runId, toolId: tool.id, durationMs: Date.now() - started, error: error.message, risk });
      const uncertain = !!actionId && !!tool.mutates && error.sideEffectNotApplied !== true;
      return { ok: false, runId, toolId: tool.id, error: uncertain ? 'action_outcome_unknown' : error.message || 'tool_failed', risk, ...(uncertain ? { reconciliationRequired: true } : {}) };
    }
  }
}
module.exports = { AgentService };
