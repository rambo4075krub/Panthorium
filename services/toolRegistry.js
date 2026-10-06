const { isIP } = require('node:net');
const windowCatalog = require('../voice-window-catalog');

const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys(args, allowed) { return plainObject(args) && Object.keys(args).every((key) => allowed.includes(key)); }
function boundedInteger(value, min, max) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max; }
function validateNoArgs(args) { return plainObject(args) && Object.keys(args).length === 0 ? null : 'invalid_tool_args'; }

class ToolRegistry {
  constructor({ sentinel, conversations, securityResponse, aiOperations, integrations, knowledge, training, mediaStudio } = {}) {
    this.tools = new Map();
    for (const operation of ['open', 'close', 'refresh']) {
      this.register({
        id: `window.${operation}`, description: `${operation} one Panthorium function window in the user's browser`,
        permission: 'chat', risk: 'low', mutates: false,
        argsSchema: { appId: `required: ${windowCatalog.apps.map(app => app.id).join(', ')}` },
        validateArgs: args => onlyKeys(args, ['appId']) && windowCatalog.apps.some(app => app.id === args.appId) ? null : 'invalid_window_id',
        run: async ({ user, args }) => {
          const app = windowCatalog.apps.find(item => item.id === args.appId);
          if (!windowCatalog.allowed(app, user)) throw new Error('tool_permission_denied');
          return { ok: true, uiAction: `${operation}_${app.key}` };
        }
      });
    }
    this.register({ id: 'system.status', description: 'Read Sentinel runtime status', permission: 'system:read', risk: 'low', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => sentinel.status() });
    this.register({ id: 'ai.providers', description: 'List configured AI providers and models', permission: 'chat', risk: 'low', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => sentinel.providerCatalog() });
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
    if (knowledge) this.register({
      id: 'knowledge.search', description: 'Search the current user knowledge base', permission: 'chat', risk: 'low', mutates: false,
      argsSchema: { query: 'required string max 500', limit: 'integer 1..20 (optional)' },
      validateArgs: (args) => onlyKeys(args, ['query', 'limit']) && typeof args.query === 'string' && args.query.trim().length > 0 && args.query.length <= 500 && (args.limit == null || boundedInteger(args.limit, 1, 20)) ? null : 'invalid_tool_args',
      run: async ({ user, args, userId }) => knowledge.search({ user: { ...user, sub: userId }, query: args.query, limit: args.limit == null ? 8 : Number(args.limit) })
    });
    if (mediaStudio) {
      this.register({
        id: 'media.video.plan_edit', description: 'Ask Sentinel to prepare a reviewable edit plan for a video owned by the current user account; this uses paid AI capacity and requires confirmation',
        permission: 'chat', risk: 'medium', mutates: false, requiresConfirmation: true,
        argsSchema: { fileId: 'required video file UUID from the current account Cloud Files', instruction: 'required edit instruction max 2400 characters', transcript: 'optional transcript text max 12000 characters' },
        validateArgs: args => onlyKeys(args, ['fileId', 'instruction', 'transcript'])
          && UUID_RE.test(String(args.fileId || ''))
          && typeof args.instruction === 'string' && args.instruction.trim().length > 0 && args.instruction.length <= 2400
          && (args.transcript == null || typeof args.transcript === 'string' && args.transcript.length <= 12000) ? null : 'invalid_media_args',
        run: async ({ user, args }) => mediaStudio.planEdit({ user, ...args })
      });
      this.register({
        id: 'media.video.ai_edit', description: 'Use Sentinel to plan and render a requested edit from an exact current-account Cloud Files video name; saves the MP4 back to that account and requires confirmation',
        permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true,
        argsSchema: { fileName: 'required exact current-account video filename', instruction: 'required edit instruction max 2400 characters', transcript: 'optional transcript text max 12000 characters', name: 'optional output filename max 150 characters' },
        validateArgs: args => onlyKeys(args, ['fileName', 'instruction', 'transcript', 'name'])
          && typeof args.fileName === 'string' && args.fileName.trim().length > 0 && args.fileName.length <= 180
          && typeof args.instruction === 'string' && args.instruction.trim().length > 0 && args.instruction.length <= 2400
          && (args.transcript == null || typeof args.transcript === 'string' && args.transcript.length <= 12000)
          && (args.name == null || typeof args.name === 'string' && args.name.length <= 150) ? null : 'invalid_media_args',
        run: async ({ user, args }) => mediaStudio.aiEdit({ user, ...args })
      });
      this.register({
        id: 'media.video.generate', description: 'Use Sentinel to prepare a video prompt and generate a short Veo video into the current user Cloud Files; paid generation and Cloud Files creation require confirmation',
        permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true,
        argsSchema: { prompt: 'required video concept max 1600 characters', durationSeconds: '4, 6, or 8 (optional)', aspectRatio: '16:9 or 9:16 (optional)', name: 'optional output filename max 150 characters' },
        validateArgs: args => onlyKeys(args, ['prompt', 'durationSeconds', 'aspectRatio', 'name'])
          && typeof args.prompt === 'string' && args.prompt.trim().length > 0 && args.prompt.length <= 1600
          && (args.durationSeconds == null || [4, 6, 8].includes(Number(args.durationSeconds)))
          && (args.aspectRatio == null || ['16:9', '9:16'].includes(args.aspectRatio))
          && (args.name == null || typeof args.name === 'string' && args.name.length <= 150) ? null : 'invalid_media_args',
        run: async ({ user, args }) => mediaStudio.startGeneration({ user, ...args, confirmed: true })
      });
      this.register({
        id: 'media.video.transcribe', description: 'Transcribe speech from a video owned by the current user account; transcription uses paid AI capacity and requires confirmation',
        permission: 'chat', risk: 'medium', mutates: false, requiresConfirmation: true,
        argsSchema: { fileId: 'required video file UUID owned by the current account', language: 'th or en (optional)' },
        validateArgs: args => onlyKeys(args, ['fileId', 'language'])
          && UUID_RE.test(String(args.fileId || ''))
          && (args.language == null || ['th', 'en'].includes(args.language)) ? null : 'invalid_media_args',
        run: async ({ user, args }) => mediaStudio.transcribe({ user, fileId: args.fileId, language: args.language || 'th' })
      });
      this.register({
        id: 'media.video.render', description: 'Trim a current-account video, optionally burn sanitized SRT captions, and save the MP4 to the same account; requires confirmation',
        permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true,
        argsSchema: { fileId: 'required video file UUID owned by the current account', startSeconds: 'number', endSeconds: 'number up to 120 seconds after start', captionsSrt: 'SRT text up to 100KB (optional)', aspect: 'original, vertical, square, or widescreen (optional)', name: 'output filename (optional)' },
        validateArgs: args => {
          if (!onlyKeys(args, ['fileId', 'startSeconds', 'endSeconds', 'captionsSrt', 'aspect', 'name'])) return 'invalid_media_args';
          if (!UUID_RE.test(String(args.fileId || ''))) return 'invalid_file_id';
          const start = Number(args.startSeconds), end = Number(args.endSeconds);
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 120) return 'invalid_clip_range';
          if (args.captionsSrt != null && (typeof args.captionsSrt !== 'string' || Buffer.byteLength(args.captionsSrt, 'utf8') > 100 * 1024)) return 'invalid_captions';
          if (args.aspect != null && !['original', 'vertical', 'square', 'widescreen'].includes(args.aspect)) return 'invalid_aspect';
          if (args.name != null && (typeof args.name !== 'string' || args.name.length > 180)) return 'invalid_output_name';
          return null;
        },
        run: async ({ user, args }) => mediaStudio.render({ user, ...args })
      });
    }
    if (training) {
      this.register({ id: 'training.status', description: 'Read Sentinel Learning Lab status', permission: 'settings', risk: 'low', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => training.list({ limit: 1 }) });
      this.register({ id: 'learning_lab.open', description: 'Open the Learning Lab in the admin interface', permission: 'settings', risk: 'low', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => ({ ok: true, uiAction: 'open_learning_lab' }) });
    }
    this.register({
      id: 'conversation.clear', description: 'Delete one current-user conversation', permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true,
      argsSchema: { sessionId: 'required safe session id' },
      validateArgs: (args) => onlyKeys(args, ['sessionId']) && SESSION_ID_RE.test(String(args.sessionId || '')) ? null : 'invalid_tool_args',
      run: async ({ userId, args }) => { const sessionId = String(args.sessionId); await sentinel.clearConversation(userId, sessionId); return { cleared: true, sessionId }; }
    });

    if (integrations) {
      this.register({
        id: 'integration.invoke', description: 'Invoke a configured external HTTPS integration for the current user', permission: 'sentinel:command', risk: 'critical', mutates: true, requiresConfirmation: true,
        argsSchema: { integrationId: 'required integration UUID', payload: 'JSON object up to 32KB (optional)' },
        validateArgs: (args) => {
          if (!onlyKeys(args, ['integrationId', 'payload'])) return 'invalid_tool_args';
          if (!UUID_RE.test(String(args.integrationId || ''))) return 'invalid_integration_id';
          if (args.payload != null && !plainObject(args.payload)) return 'invalid_integration_payload';
          try { if (Buffer.byteLength(JSON.stringify(args.payload || {}), 'utf8') > 32768) return 'integration_payload_too_large'; }
          catch { return 'invalid_integration_payload'; }
          return null;
        },
        run: async ({ user, args }) => {
          const result = await integrations.invoke({ user, integrationId: String(args.integrationId), payload: args.payload || {} });
          if (!result.ok) { const error = new Error(result.error || 'integration_invoke_failed'); error.integrationResult = result; throw error; }
          return result.output;
        }
      });
    }

    if (securityResponse) {
      this.register({ id: 'security.blocks', description: 'List active temporary IP security blocks', permission: 'system:read', risk: 'medium', mutates: false, argsSchema: {}, validateArgs: validateNoArgs, run: async () => securityResponse.listBlocks() });
      this.register({
        id: 'security.block_ip', description: 'Temporarily block an IP address', permission: 'sentinel:command', risk: 'critical', mutates: true, requiresConfirmation: true,
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
        id: 'security.unblock_ip', description: 'Remove an active IP security block', permission: 'sentinel:command', risk: 'critical', mutates: true, requiresConfirmation: true,
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
