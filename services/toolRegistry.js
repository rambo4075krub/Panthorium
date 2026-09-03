class ToolRegistry {
  constructor({ sentinelCore, conversations } = {}) {
    this.tools = new Map();
    this.register({ id: 'system.status', description: 'Read Sentinel Core runtime status', permission: 'system:read', mutates: false, run: async () => sentinelCore.status() });
    this.register({ id: 'ai.providers', description: 'List configured AI providers and models', permission: 'chat', mutates: false, run: async () => sentinelCore.providerCatalog() });
    this.register({ id: 'conversation.list', description: 'List the current user conversation sessions', permission: 'chat', mutates: false, run: async ({ userId, args }) => conversations ? conversations.listSessions(userId, Math.min(Math.max(Number(args?.limit) || 20, 1), 100)) : [] });
    this.register({ id: 'conversation.history', description: 'Read one current-user conversation', permission: 'chat', mutates: false, run: async ({ userId, args }) => conversations ? conversations.history(userId, String(args?.sessionId || ''), Math.min(Math.max(Number(args?.limit) || 40, 1), 100)) : [] });
    this.register({ id: 'conversation.clear', description: 'Delete one current-user conversation', permission: 'chat', mutates: true, requiresConfirmation: true, run: async ({ userId, args }) => { const sessionId = String(args?.sessionId || ''); if (!sessionId) throw new Error('invalid_session_id'); await sentinelCore.clearConversation(userId, sessionId); return { cleared: true, sessionId }; } });
  }
  register(tool) { if (!tool?.id || typeof tool.run !== 'function') throw new Error('invalid_tool'); this.tools.set(tool.id, { requiresConfirmation: false, mutates: false, ...tool }); }
  catalog() { return [...this.tools.values()].map(({ run, ...tool }) => tool); }
  get(id) { return this.tools.get(String(id || '')) || null; }
}
module.exports = { ToolRegistry };
