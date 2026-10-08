const windowCatalog = require('../voice-window-catalog');

const TOOL_DEFINITIONS = [
  { name: 'panthorium_window_open', toolId: 'window.open', description: 'Open one Panthorium window for the current user.', properties: { appId: { type: 'STRING', description: 'Panthorium app id.' } }, required: ['appId'], windowOperation: 'open' },
  { name: 'panthorium_window_close', toolId: 'window.close', description: 'Close one Panthorium window for the current user.', properties: { appId: { type: 'STRING', description: 'Panthorium app id.' } }, required: ['appId'], windowOperation: 'close' },
  { name: 'panthorium_window_refresh', toolId: 'window.refresh', description: 'Refresh one Panthorium window for the current user.', properties: { appId: { type: 'STRING', description: 'Panthorium app id.' } }, required: ['appId'], windowOperation: 'refresh' },
  { name: 'panthorium_system_status', toolId: 'system.status', description: 'Read Sentinel runtime status.', properties: {}, required: [] },
  { name: 'panthorium_ai_providers', toolId: 'ai.providers', description: 'List configured AI providers and models.', properties: {}, required: [] },
  { name: 'panthorium_ai_operations', toolId: 'ai.operations', description: 'Read AI usage and provider health for the current user.', properties: { hours: { type: 'INTEGER', description: 'Hours of usage to summarize, from 1 to 168.' } }, required: [] },
  { name: 'panthorium_conversation_list', toolId: 'conversation.list', description: 'List conversation sessions owned by the current user.', properties: { limit: { type: 'INTEGER', description: 'Maximum number of sessions, from 1 to 100.' } }, required: [] },
  { name: 'panthorium_conversation_history', toolId: 'conversation.history', description: 'Read a conversation owned by the current user.', properties: { sessionId: { type: 'STRING', description: 'Conversation session id.' }, limit: { type: 'INTEGER', description: 'Maximum number of messages, from 1 to 100.' } }, required: ['sessionId'] },
  { name: 'panthorium_knowledge_search', toolId: 'knowledge.search', description: 'Search the current user knowledge base.', properties: { query: { type: 'STRING', description: 'Search terms, up to 500 characters.' }, limit: { type: 'INTEGER', description: 'Maximum number of results, from 1 to 20.' } }, required: ['query'] },
  { name: 'panthorium_training_status', toolId: 'training.status', description: 'Read Sentinel Learning Lab status.', properties: {}, required: [] }
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeOutput(value, maxChars = 12000) {
  let serialized;
  try { serialized = JSON.stringify(value == null ? null : value); }
  catch { return { truncated: true, preview: '[unserializable tool output]' }; }
  if (serialized.length <= maxChars) return value == null ? null : value;
  return { truncated: true, preview: serialized.slice(0, maxChars) };
}

class AgentFunctionCallingService {
  constructor({ agentService, audit } = {}) {
    if (!agentService || typeof agentService.catalogFor !== 'function' || typeof agentService.execute !== 'function') throw new Error('agent_function_calling_service_required');
    this.agentService = agentService;
    this.audit = audit || null;
  }

  declarationsFor(user, { surface = 'sentinel-chat' } = {}) {
    const catalog = new Map(this.agentService.catalogFor(user).map(tool => [tool.id, tool]));
    const allowedWindows = windowCatalog.apps.filter(app => windowCatalog.allowed(app, user)).map(app => app.id);
    return TOOL_DEFINITIONS.flatMap(definition => {
      const tool = catalog.get(definition.toolId);
      if (!tool || (tool.risk || 'low') !== 'low' || tool.mutates || tool.requiresConfirmation) return [];
      if (definition.windowOperation && surface !== 'gemini-live') return [];
      const properties = clone(definition.properties);
      if (definition.windowOperation) {
        if (!allowedWindows.length) return [];
        properties.appId.enum = allowedWindows;
      }
      return [{
        name: definition.name,
        description: definition.description,
        parameters: { type: 'OBJECT', properties, ...(definition.required.length ? { required: [...definition.required] } : {}) }
      }];
    });
  }

  async execute({ user, call, requestId, source = 'sentinel-chat', requireCallId = false } = {}) {
    const name = String(call?.name || '');
    const definition = TOOL_DEFINITIONS.find(item => item.name === name);
    const callId = String(call?.id || '').slice(0, 128);
    if (requireCallId && !callId) return this.rejected({ user, requestId, name, error: 'missing_function_call_id', source });
    const declaration = definition && this.declarationsFor(user, { surface: source }).find(item => item.name === name);
    if (!definition || !declaration) {
      return this.rejected({ user, requestId, name, error: 'function_not_available', source, callId });
    }
    let args = call?.args;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = null; }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return this.rejected({ user, requestId, name, error: 'invalid_tool_args', source, callId, toolId: definition.toolId });
    }
    if (definition.windowOperation && !declaration.parameters.properties.appId.enum.includes(args.appId)) {
      return this.rejected({ user, requestId, name, error: 'tool_permission_denied', source, callId, toolId: definition.toolId });
    }
    const result = await this.agentService.execute({ user, toolId: definition.toolId, args, requestId });
    const response = result.ok
      ? { output: safeOutput(result.output) }
      : { error: String(result.error || 'tool_failed').slice(0, 160) };
    return {
      id: callId || null,
      name,
      toolId: definition.toolId,
      ok: result.ok === true,
      output: result.ok ? result.output : undefined,
      error: result.ok ? undefined : response.error,
      functionResponse: { name, ...(callId ? { id: callId } : {}), response }
    };
  }

  rejected({ user, requestId, name, error, source, callId, toolId } = {}) {
    this.audit?.record('agent.function_call_rejected', { userId: user?.sub, requestId, source, functionName: name, toolId: toolId || null, error });
    return {
      id: callId || null,
      name: name || 'unknown_function',
      toolId: toolId || null,
      ok: false,
      error,
      functionResponse: { name: name || 'unknown_function', ...(callId ? { id: callId } : {}), response: { error } }
    };
  }
}

module.exports = { TOOL_DEFINITIONS, safeOutput, AgentFunctionCallingService };
