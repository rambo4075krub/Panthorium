const { isIP } = require('node:net');

const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys(args, allowed) { return plainObject(args) && Object.keys(args).every((key) => allowed.includes(key)); }
function boundedInteger(value, min, max) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max; }
function validateNoArgs(args) { return plainObject(args) && Object.keys(args).length === 0 ? null : 'invalid_tool_args'; }

class ToolRegistry {
  constructor({ sentinelCore, conversations, securityResponse, aiOperations } = {}) {
    this.tools = new Map();
    this.register({ id: 'system.status', description: 'Read Sentinel Core runtime status', permission: 'system:read', risk: 'low', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => sentinelCore.status() });
    this.register({ id: 'ai.providers', description: 'List configured AI providers and models', permission: 'chat', risk: 'low', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => sentinelCore.providerCatalog() });
    this.register({
      id: 'ai.operations', description: 'Read current-user AI usage and provider health metrics', permission: 'chat', risk: 'low', mutates: false,
      argsSchema: { hours: 'integer 1..168 (optional)' },
      validateArgs: (args) => onlyKeys(args, ['hours']) && (args.hours == null || boundedInteger(args.hours, 1, 168)) ? null : 'invalid_tool_args',
      run: async ({ userId, args }) => aiOperations ? aiOperations.overview(userId, args.hours == null ? 24 : Number(args.hours)) : null
    });
    this.register({
      id: 'conversation.list', description: 'List the current user conversation sessions', permission: 'chat', risk: 'low', mutates: false,
      argsSchema: { limit: 'integer 1..100 (optional)' },
      validateArgs: (args) => onlyKeys(args, ['limit']) && (args.limit == null || boundedInteger(args.limit, 1, 100)) ? null : 'invalid_tool_args',
      run: async ({ userId, args }) => conversations ? conversations.listSessions(userId, args.limit == null ? 20 : Number(args.limit)) : []
    });
    this.register({
      id: 'conversation.history', description: 'Read one current-user conversation', permission: 'chat', risk: 'low', mutates: false,
      argsSchema: { sessionId: 'required safe session id', limit: 'integer 1..100 (optional)' },
      validateArgs: (args) => onlyKeys(args, ['sessionId', 'limit']) && SESSION_ID_RE.test(String(args.sessionId || '')) && (args.limit == null || boundedInteger(args.limit, 1, 100)) ? null : 'invalid_tool_args',
      run: async ({ userId, args }) => conversations ? conversations.history(userId, String(args.sessionId), args.limit == null ? 40 : Number(args.limit)) : []
    });
    this.register({
      id: 'conversation.clear', description: 'Delete one current-user conversation', permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true,
      argsSchema: { sessionId: 'required safe session id' },
      validateArgs: (args) => onlyKeys(args, ['sessionId']) && SESSION_ID_RE.test(String(args.sessionId || '')) ? null : 'invalid_tool_args',
      run: async ({ userId, args }) => { const sessionId = String(args.sessionId); await sentinelCore.clearConversation(userId, sessionId); return { cleared: true, sessionId }; }
    });

    if (securityResponse) {
      this.register({ id: 'security.blocks', description: 'List active temporary IP security blocks', permission: 'system:read', risk: 'medium', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => securityResponse.listBlocks() });
      this.register({
        id: 'security.block_ip', description: 'Temporarily block an IP address', permission: 'core:command', risk: 'critical', mutates: true, requiresConfirmation: true,
        argsSchema: { ip: 'required IPv4/IPv6', durationMinutes: 'integer 1..1440 (optional)', reason: 'string max 240 (optional)' },
        validateArgs: (args) => {
          if (!onlyKeys(args, ['ip', 'durationMinutes', 'reason'])) return 'invalid_tool_args';
          const ip = String(args.ip || '').trim().replace(/^::ffff:/, '');
          if (!isIP(ip)) return 'invalid_ip';
          if (args.durationMinutes != null && !boundedInteger(args.durationMinutes, 1, 1440)) return 'invalid_duration';
          if (args.reason != null && (typeof args.reason !== 'string' || args.reason.length > 240)) return 'invalid_reason';
          return null;
        },
        run: async ({ userId, args }) => securityResponse.blockIp(String(args.ip).trim(), { durationMinutes: args.durationMinutes == null ? 30 : Number(args.durationMinutes), reason: String(args.reason || 'Agent approved security action'), source: 'agent', actorUserId: userId })
      });
      this.register({
        id: 'security.unblock_ip', description: 'Remove an active IP security block', permission: 'core:command', risk: 'critical', mutates: true, requiresConfirmation: true,
        argsSchema: { ip: 'required IPv4/IPv6' },
        validateArgs: (args) => {
          if (!onlyKeys(args, ['ip'])) return 'invalid_tool_args';
          const ip = String(args.ip || '').trim().replace(/^::ffff:/, '');
          return isIP(ip) ? null : 'invalid_ip';
        },
        run: async ({ userId, args }) => { const ip = String(args.ip).trim(); const removed = await securityResponse.unblockIp(ip, userId); return { removed, ip }; }
      });
    }
  }
  register(tool) {
    if (!tool?.id || typeof tool.run !== 'function') throw new Error('invalid_tool');
    const risk = ['low', 'medium', 'high', 'critical'].includes(tool.risk) ? tool.risk : 'low';
    this.tools.set(tool.id, { requiresConfirmation: false, mutates: false, argsSchema: {}, validateArgs: validateNoArgs, risk, ...tool, risk });
  }
  catalog() { return [...this.tools.values()].map(({ run, validateArgs, ...tool }) => tool); }
  get(id) { return this.tools.get(String(id || '')) || null; }
}
module.exports = { ToolRegistry, SESSION_ID_RE };
