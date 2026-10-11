const assert = require('node:assert/strict');
const { AgentFunctionCallingService } = require('../services/agentFunctionCallingService');

async function main() {
  const catalog = [
    { id: 'window.open', permission: 'chat', risk: 'low', mutates: false },
    { id: 'window.close', permission: 'chat', risk: 'low', mutates: false },
    { id: 'window.refresh', permission: 'chat', risk: 'low', mutates: false },
    { id: 'ai.providers', permission: 'chat', risk: 'low', mutates: false },
    { id: 'system.status', permission: 'system:read', risk: 'low', mutates: false },
    { id: 'training.status', permission: 'settings', risk: 'low', mutates: false },
    { id: 'conversation.clear', permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true },
    { id: 'calendar.read', permission: 'chat', risk: 'low', mutates: false },
    { id: 'calendar.write', permission: 'chat', risk: 'medium', mutates: true, requiresConfirmation: true },
    { id: 'notes.write', permission: 'chat', risk: 'medium', mutates: true, requiresConfirmation: true },
    { id: 'files.write', permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true },
    { id: 'media.video.generate', permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true }
  ];
  const calls = [];
  const agentService = {
    catalogFor(user) {
      const permissions = new Set(user.permissions);
      return catalog.filter(tool => permissions.has(tool.permission));
    },
    async execute(input) {
      calls.push(input);
      const tool = catalog.find(item => item.id === input.toolId);
      if (tool?.requiresConfirmation && input.confirmed !== true) return { ok: false, error: 'confirmation_required', tool, risk: tool.risk };
      return { ok: true, toolId: input.toolId, output: input.toolId === 'window.open' ? { ok: true, uiAction: 'open_calculator' } : { providers: ['vertex'] } };
    }
  };
  const service = new AgentFunctionCallingService({ agentService });
  const regularUser = { sub: 'user-1', id: 'user-1', roles: [], permissions: ['chat'] };
  const regularTools = service.declarationsFor(regularUser);
  assert(regularTools.some(tool => tool.name === 'panthorium_ai_providers'));
  assert(!regularTools.some(tool => tool.name === 'panthorium_system_status'));
  assert(!regularTools.some(tool => tool.name === 'panthorium_training_status'));
  assert(!regularTools.some(tool => tool.name === 'panthorium_conversation_clear'));
  assert(!regularTools.some(tool => tool.name === 'panthorium_window_open'), 'chat omits browser actions until the browser can acknowledge them');
  assert(regularTools.some(tool => tool.name === 'panthorium_calendar_read'), 'current-user calendar reads are available in chat');
  for (const name of ['panthorium_calendar_write', 'panthorium_notes_write', 'panthorium_files_write', 'panthorium_video_generate']) {
    assert(!regularTools.some(tool => tool.name === name), `${name} is not available to unconfirmed chat calls`);
  }
  const liveTools = service.declarationsFor(regularUser, { surface: 'gemini-live' });
  const windowOpen = liveTools.find(tool => tool.name === 'panthorium_window_open');
  assert(windowOpen.parameters.properties.appId.enum.includes('calculator'));
  assert(!windowOpen.parameters.properties.appId.enum.includes('security'));
  for (const name of ['panthorium_calendar_write', 'panthorium_notes_write', 'panthorium_files_write', 'panthorium_video_generate']) {
    assert(liveTools.some(tool => tool.name === name), `${name} is available through the approval-capable Live surface`);
  }

  const providerResult = await service.execute({ user: regularUser, call: { id: 'call-1', name: 'panthorium_ai_providers', args: {} }, source: 'test', requireCallId: true });
  assert.equal(providerResult.ok, true);
  assert.equal(providerResult.functionResponse.id, 'call-1');
  assert.deepEqual(providerResult.functionResponse.response.output, { providers: ['vertex'] });
  const actionResult = await service.execute({ user: regularUser, call: { id: 'call-2', name: 'panthorium_window_open', args: { appId: 'calculator' } }, source: 'gemini-live' });
  assert.equal(actionResult.output.uiAction, 'open_calculator');
  const denied = await service.execute({ user: regularUser, call: { id: 'call-3', name: 'panthorium_window_open', args: { appId: 'security' } }, source: 'gemini-live' });
  assert.equal(denied.error, 'tool_permission_denied');
  assert.equal(calls.length, 2, 'unavailable functions must never reach AgentService.execute');
  const pendingWrite = await service.execute({ user: regularUser, call: { id: 'call-4', name: 'panthorium_calendar_write', args: { action: 'create', title: 'Sprint' } }, source: 'gemini-live', requireCallId: true });
  assert.equal(pendingWrite.requiresConfirmation, true);
  assert.equal(pendingWrite.confirmation.mutates, true);
  assert.equal(calls.at(-1).confirmed, false);
  const approvedWrite = await service.execute({ user: regularUser, call: { id: 'call-4', name: 'panthorium_calendar_write', args: { action: 'create', title: 'Sprint' } }, source: 'gemini-live', requireCallId: true, confirmed: true });
  assert.equal(approvedWrite.ok, true);
  assert.equal(calls.at(-1).confirmed, true);

  const admin = { sub: 'admin-1', id: 'admin-1', roles: ['administrator'], permissions: ['chat', 'system:read', 'settings'] };
  const adminTools = service.declarationsFor(admin);
  assert(adminTools.some(tool => tool.name === 'panthorium_system_status'));
  assert(adminTools.some(tool => tool.name === 'panthorium_training_status'));
  console.log('Agent function calling service tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
