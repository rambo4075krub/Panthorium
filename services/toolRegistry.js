class ToolRegistry {
  constructor({ sentinelCore, conversations, securityResponse, aiOperations } = {}) {
    this.tools = new Map();
    this.register({ id: 'system.status', description: 'Read Sentinel Core runtime status', permission: 'system:read', risk: 'low', mutates: false, run: async () => sentinelCore.status() });
    this.register({ id: 'ai.providers', description: 'List configured AI providers and models', permission: 'chat', risk: 'low', mutates: false, run: async () => sentinelCore.providerCatalog() });
    this.register({ id: 'ai.operations', description: 'Read current-user AI usage and provider health metrics', permission: 'chat', risk: 'low', mutates: false, run: async ({ userId, args }) => aiOperations ? aiOperations.overview(userId, Math.min(Math.max(Number(args?.hours) || 24, 1), 168)) : null });
    this.register({ id: 'conversation.list', description: 'List the current user conversation sessions', permission: 'chat', risk: 'low', mutates: false, run: async ({ userId, args }) => conversations ? conversations.listSessions(userId, Math.min(Math.max(Number(args?.limit) || 20, 1), 100)) : [] });
    this.register({ id: 'conversation.history', description: 'Read one current-user conversation', permission: 'chat', risk: 'low', mutates: false, run: async ({ userId, args }) => conversations ? conversations.history(userId, String(args?.sessionId || ''), Math.min(Math.max(Number(args?.limit) || 40, 1), 100)) : [] });
    this.register({ id: 'conversation.clear', description: 'Delete one current-user conversation', permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true, run: async ({ userId, args }) => { const sessionId = String(args?.sessionId || ''); if (!sessionId) throw new Error('invalid_session_id'); await sentinelCore.clearConversation(userId, sessionId); return { cleared: true, sessionId }; } });

    if (securityResponse) {
      this.register({ id: 'security.blocks', description: 'List active temporary IP security blocks', permission: 'system:read', risk: 'medium', mutates: false, run: async () => securityResponse.listBlocks() });
      this.register({ id: 'security.block_ip', description: 'Temporarily block an IP address', permission: 'core:command', risk: 'critical', mutates: true, requiresConfirmation: true, run: async ({ userId, args }) => {
        const ip = String(args?.ip || '').trim();
        const durationMinutes = Math.min(Math.max(Number(args?.durationMinutes) || 30, 1), 1440);
        if (!ip) throw new Error('invalid_ip');
        return securityResponse.blockIp(ip, { durationMinutes, reason: String(args?.reason || 'Agent approved security action').slice(0, 240), source: 'agent', actorUserId: userId });
      } });
      this.register({ id: 'security.unblock_ip', description: 'Remove an active IP security block', permission: 'core:command', risk: 'critical', mutates: true, requiresConfirmation: true, run: async ({ userId, args }) => {
        const ip = String(args?.ip || '').trim();
        if (!ip) throw new Error('invalid_ip');
        const removed = await securityResponse.unblockIp(ip, userId);
        return { removed, ip };
      } });
    }
  }
  register(tool) {
    if (!tool?.id || typeof tool.run !== 'function') throw new Error('invalid_tool');
    const risk = ['low', 'medium', 'high', 'critical'].includes(tool.risk) ? tool.risk : 'low';
    this.tools.set(tool.id, { requiresConfirmation: false, mutates: false, risk, ...tool, risk });
  }
  catalog() { return [...this.tools.values()].map(({ run, ...tool }) => tool); }
  get(id) { return this.tools.get(String(id || '')) || null; }
}
module.exports = { ToolRegistry };
