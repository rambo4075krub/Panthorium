'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { registerPersonalFunctionTools } = require('../services/personalFunctionTools');
const { McpToolService, READ_SCOPE, MEDIA_SCOPE } = require('../services/mcpToolService');

async function main() {
  const owner = { sub: randomUUID(), username: 'owner', email: 'owner@example.test', roles: ['member'], permissions: ['chat'] };
  const other = { ...owner, sub: randomUUID(), username: 'other' };
  const context = { scopes: [READ_SCOPE, MEDIA_SCOPE] };
  const effects = [];
  const media = {
    capabilities: () => ({ videoGeneration: true, aiEditPlanning: true }),
    videoFiles: async user => ({ files: [{ id: randomUUID(), name: `${user.sub}.mp4` }] }),
    generationStatus: async ({ user, jobToken }) => {
      effects.push({ operation: 'status', owner: user.sub, jobToken });
      if (jobToken !== `job:${user.sub}`) throw new Error('invalid_generation_job');
      return { ok: true, status: 'running' };
    },
    startGeneration: async input => { effects.push({ operation: 'generate', ...input }); return { ok: true, status: 'running', jobToken: `job:${input.user.sub}` }; },
    planEdit: async input => { effects.push({ operation: 'planEdit', ...input }); return { ok: true, plan: 'trim' }; },
    aiEdit: async input => { effects.push({ operation: 'aiEdit', ...input }); return { ok: true, file: { name: 'edited.mp4' } }; },
    transcribe: async input => { effects.push({ operation: 'transcribe', ...input }); return { ok: true, transcript: 'hello' }; },
    render: async input => { effects.push({ operation: 'render', ...input }); return { ok: true, file: { name: 'rendered.mp4' } }; }
  };
  const files = {
    list: async userId => ({ files: [{ id: randomUUID(), name: `${userId}.txt` }], usedBytes: 1, maxBytes: 1000, maxFiles: 10 }),
    download: async (userId, fileId) => ({ id: fileId, name: 'notes.txt', contentType: 'text/plain', body: Buffer.from(`private data of ${userId}`) })
  };
  const registry = new ToolRegistry({ mediaStudio: media, conversations: { listSessions: async userId => [{ owner: userId }] } });
  registerPersonalFunctionTools(registry, { files });
  const ledger = new ActionLedgerRepository({ allowMemory: true });
  await ledger.init();
  const agent = new AgentService({ tools: registry, ledger });
  const adapter = new McpToolService({ agentService: agent, mediaStudio: media, baseUrl: 'https://panthorium.example' });
  const call = (name, args = {}, user = owner, opts = context) => adapter.callTool(user, name, args, randomUUID(), opts);
  const data = result => result.structuredContent;
  const code = async (name, args, expected, user, opts) => {
    const result = await call(name, args, user, opts);
    assert.equal(result.isError, true);
    assert.equal(data(result).error, expected);
  };

  assert.deepEqual(adapter.listTools(owner), [], 'OAuth scopes fail closed when omitted');
  assert.deepEqual(adapter.listTools({ ...owner, roles: ['guest'] }, context), []);
  assert.deepEqual(adapter.listTools({ ...owner, permissions: [] }, context), []);
  assert.deepEqual(adapter.listTools({ sub: 'guest:123', roles: [], permissions: ['chat'] }, context), []);
  assert.deepEqual(adapter.listTools({ ...owner, sub: undefined, id: owner.sub }, context), [], 'a canonical authenticated subject is required');
  const catalog = adapter.listTools(owner, context);
  assert(catalog.some(tool => tool.name === 'panthorium_profile' && tool._meta['openai/profile'] === true));
  assert(catalog.some(tool => tool.name === 'panthorium_files_read'));
  assert(catalog.some(tool => tool.name === 'panthorium_video_generate'));
  assert(catalog.every(tool => tool.inputSchema.type === 'object' && tool.inputSchema.additionalProperties === false));
  assert(catalog.every(tool => tool.securitySchemes[0].type === 'oauth2'));
  const admin = { ...owner, permissions: ['chat', 'system:read', 'settings', 'sentinel:command'] };
  assert(adapter.listTools(admin, context).every(tool => !/system_status|training|security|integration|window|write|conversation_clear/.test(tool.name)), 'admin tools and unrelated mutations are never exposed');
  const generationSchema = catalog.find(tool => tool.name === 'panthorium_video_generate');
  assert.deepEqual(generationSchema.inputSchema.properties.durationSeconds.enum, [4, 6, 8], 'MCP uses numeric duration enum');
  assert(generationSchema.inputSchema.required.includes('idempotencyKey'));
  assert.equal(generationSchema.annotations.readOnlyHint, false);
  assert.equal(generationSchema.annotations.idempotentHint, true);
  assert.equal(catalog.find(tool => tool.name === 'panthorium_video_status').annotations.readOnlyHint, false, 'generation polling may save the approved output');
  assert(!adapter.listTools(owner, { scopes: [READ_SCOPE] }).some(tool => tool.name === 'panthorium_video_generate'));
  await code('panthorium_video_generate', { prompt: 'x', idempotencyKey: randomUUID() }, 'tool_permission_denied', owner, { scopes: [READ_SCOPE] });
  await code('panthorium_system_status', {}, 'tool_permission_denied', admin);
  await code('panthorium_profile', {}, 'account_required', { ...owner, permissions: [] });
  await code('panthorium_profile', { userId: other.sub }, 'invalid_tool_args');
  await code('panthorium_profile', [], 'invalid_tool_args');
  await code('panthorium_profile', null, 'invalid_tool_args');
  assert.equal(data(await call('panthorium_profile')).userId, owner.sub);
  assert.equal(data(await call('panthorium_files_read', { action: 'list' }, other)).output.files[0].name, `${other.sub}.txt`);
  assert.equal(data(await call('panthorium_files_read', { action: 'read_text', fileId: randomUUID(), expectedName: 'notes.txt' })).output.text, `private data of ${owner.sub}`);
  await code('panthorium_files_read', { action: 'list', userId: other.sub }, 'invalid_tool_args');
  await code('panthorium_files_read', { action: 'list', limit: '10' }, 'invalid_tool_args');
  await code('panthorium_files_read', { action: 'list', limit: 51 }, 'invalid_tool_args');
  await code('panthorium_files_read', { action: 'read_text', fileId: randomUUID(), expectedName: 'someone-else.txt' }, 'file_not_found');
  await code('panthorium_files_read', { action: 'read_text', fileId: 'not-a-file', expectedName: 'notes.txt' }, 'invalid_tool_args');

  const request = { prompt: 'A heroic Thai sci-fi king', durationSeconds: 8, aspectRatio: '16:9', idempotencyKey: randomUUID() };
  await code('panthorium_video_generate', { ...request, confirmed: true }, 'invalid_tool_args');
  await code('panthorium_video_generate', { ...request, approvalHash: 'f'.repeat(64) }, 'invalid_tool_args');
  await code('panthorium_video_generate', { ...request, durationSeconds: '8' }, 'invalid_tool_args');
  await code('panthorium_video_generate', { prompt: request.prompt }, 'invalid_tool_args');
  const proposed = await call('panthorium_video_generate', request);
  assert.equal(proposed.isError, false);
  const receipt = data(proposed);
  assert.equal(receipt.status, 'awaiting_confirmation');
  assert.equal(effects.length, 0, 'MCP cannot execute a paid operation without browser confirmation');
  assert.equal(receipt.approvalUrl, `https://panthorium.example/mcp/approve?actionId=${receipt.actionId}`);
  assert(!JSON.stringify(proposed).includes('approvalHash'), 'approval capability never leaves the trusted browser boundary');
  assert.equal(data(await call('panthorium_video_generate', request)).actionId, receipt.actionId, 'HTTP retry with the same UUID reuses the proposal');
  assert.equal(data(await call('panthorium_video_generate', { ...request, idempotencyKey: request.idempotencyKey.toUpperCase() })).actionId, receipt.actionId, 'UUID case does not create a second proposal');
  await code('panthorium_video_generate', { ...request, prompt: 'Different request' }, 'action_request_conflict');
  await code('panthorium_action_status', { actionId: receipt.actionId }, 'action_not_found', other);
  await code('panthorium_action_status', { actionId: receipt.actionId }, 'tool_permission_denied', owner, { scopes: [READ_SCOPE] });
  const pending = await call('panthorium_action_status', { actionId: receipt.actionId });
  assert.equal(data(pending).actionState, 'awaiting_confirmation');
  assert(!JSON.stringify(pending).includes('approvalHash'));
  assert(!JSON.stringify(pending).includes('argsHash'));

  const stored = (await agent.getAction({ user: owner, actionId: receipt.actionId })).action;
  assert.equal(stored.requestId, `mcp:${request.idempotencyKey}`);
  assert.equal(stored.args.idempotencyKey, undefined, 'connector-only keys never reach the existing media implementation');
  const confirmed = await agent.confirmAction({ user: owner, actionId: stored.actionId, approvalHash: stored.approvalHash });
  assert.equal(confirmed.ok, true);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].confirmed, true, 'only the existing trusted ledger boundary can authorize the paid implementation');
  assert.equal(effects[0].user.sub, owner.sub);
  assert.equal(effects[0].prompt, request.prompt);
  assert.equal(data(await call('panthorium_video_generate', request)).replayed, true);
  assert.equal(effects.length, 1, 'retried approved action cannot spend twice');
  const completed = data(await call('panthorium_action_status', { actionId: receipt.actionId }));
  assert.equal(completed.actionState, 'succeeded');
  assert.equal(completed.result.output.jobToken, `job:${owner.sub}`);
  assert.equal(data(await call('panthorium_video_status', { jobToken: completed.result.output.jobToken })).status, 'running');
  await code('panthorium_video_status', { jobToken: completed.result.output.jobToken }, 'invalid_generation_job', other);
  assert.equal(effects.at(-1).owner, other.sub, 'status service receives current authenticated owner, not a tool argument');

  const browserAction = await agent.execute({ user: owner, toolId: 'media.video.generate', args: { prompt: 'Browser request' }, requestId: 'browser-123' });
  await code('panthorium_action_status', { actionId: browserAction.actionId }, 'action_not_found');
  const originalPermission = registry.get('media.video.generate').permission;
  registry.get('media.video.generate').permission = 'revoked:permission';
  await code('panthorium_action_status', { actionId: receipt.actionId }, 'action_not_found');
  registry.get('media.video.generate').permission = originalPermission;

  for (const [name, args] of [
    ['panthorium_video_plan_edit', { fileId: randomUUID(), instruction: 'Trim the opening' }],
    ['panthorium_video_ai_edit', { fileName: 'trailer.mp4', instruction: 'Add English captions' }],
    ['panthorium_video_transcribe', { fileId: randomUUID(), language: 'en' }],
    ['panthorium_video_render', { fileId: randomUUID(), startSeconds: 0, endSeconds: 29, captionsSrt: '1\n00:00:00,000 --> 00:00:01,000\nRise.\n' }]
  ]) {
    const before = effects.length;
    const result = data(await call(name, { ...args, idempotencyKey: randomUUID() }));
    assert.equal(result.status, 'awaiting_confirmation', name);
    assert.equal(effects.length, before, `${name} must not run before approval`);
  }
  await code('panthorium_video_render', { fileId: randomUUID(), startSeconds: 0, endSeconds: 121, idempotencyKey: randomUUID() }, 'invalid_clip_range');
  await code('panthorium_video_render', { fileId: randomUUID(), startSeconds: 0, endSeconds: 29, captionsSrt: 'ก'.repeat(40000), idempotencyKey: randomUUID() }, 'invalid_captions');
  const noLedger = new McpToolService({ agentService: new AgentService({ tools: registry }), mediaStudio: media, baseUrl: 'https://panthorium.example' });
  assert(!noLedger.listTools(owner, context).some(tool => /video_generate|video_render|video_transcribe|video_ai_edit|video_plan_edit|action_status/.test(tool.name)), 'approval tools are hidden without a durable ledger');
  const generateTool = registry.get('media.video.generate');
  const savedPolicy = { requiresConfirmation: generateTool.requiresConfirmation, mutates: generateTool.mutates, risk: generateTool.risk };
  Object.assign(generateTool, { requiresConfirmation: false, mutates: false, risk: 'low' });
  assert(!adapter.listTools(owner, context).some(tool => tool.name === 'panthorium_video_generate'), 'a weakened internal tool policy cannot bypass the external approval boundary');
  Object.assign(generateTool, savedPolicy);
  assert.throws(() => new McpToolService({ agentService: agent, baseUrl: 'javascript:alert(1)' }), /invalid_mcp_base_url/);
  assert.throws(() => new McpToolService({ agentService: agent, baseUrl: 'https://user:secret@panthorium.example' }), /invalid_mcp_base_url/);
  assert.throws(() => new McpToolService({ agentService: agent, baseUrl: 'http://panthorium.example' }), /invalid_mcp_base_url/);
  console.log('MCP tool scope, ownership, schema and approval tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
