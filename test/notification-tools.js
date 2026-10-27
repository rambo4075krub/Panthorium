'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { AgentFunctionCallingService } = require('../services/agentFunctionCallingService');
const { NotificationRepository } = require('../services/notificationRepository');
const { NotificationService } = require('../services/notificationService');
const { registerNotificationTools, validateNotificationArgs, NOTIFICATION_GUIDANCE } = require('../services/notificationTools');
const { registerPersonalFunctionTools } = require('../services/personalFunctionTools');
const { Sentinel } = require('../services/sentinel');
const { createGeminiLiveWebSocketGateway } = require('../services/geminiLiveWebSocket');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter { constructor() { super(); this.readyState = 1; this.sent = []; } send(frame) { this.sent.push(JSON.parse(frame)); } close() { this.readyState = 3; this.emit('close'); } }
class WSS extends EventEmitter { constructor() { super(); WSS.instance = this; } handleUpgrade(_req, _socket, _head, fn) { fn(this.client); } close() {} }

async function main() {
  const owner = { sub: randomUUID(), permissions: ['chat'], roles: ['user'] }, other = { ...owner, sub: randomUUID() };
  const repository = new NotificationRepository({ allowMemory: true }), notifications = new NotificationService({ repository });
  await notifications.init();
  const registry = new ToolRegistry(); registerNotificationTools(registry, { notifications });
  const ledger = new ActionLedgerRepository({ allowMemory: true }); await ledger.init();
  const agent = new AgentService({ tools: registry, ledger }), functions = new AgentFunctionCallingService({ agentService: agent });
  const send = { name: 'panthorium_notifications_write', id: 'self-notice', args: { action: 'send', title: 'งานที่ร้องขอ', body: 'รายละเอียดที่ยืนยันแล้ว', category: 'operations' } };
  for (const surface of ['sentinel-chat', 'gemini-live']) {
    assert(functions.declarationsFor(owner, { surface }).some(tool => tool.name === send.name));
    assert(functions.declarationsFor(owner, { surface }).some(tool => tool.name === 'panthorium_notifications_read'));
    for (const guest of [{ ...owner, sub: 'guest:session' }, { ...owner, roles: ['guest'] }]) assert(!functions.declarationsFor(guest, { surface }).some(tool => tool.name.startsWith('panthorium_notifications_')));
  }
  const noLedger = new AgentFunctionCallingService({ agentService: new AgentService({ tools: registry }) });
  assert(!noLedger.declarationsFor(owner).some(tool => tool.name === send.name));
  assert(noLedger.declarationsFor(owner).some(tool => tool.name === 'panthorium_notifications_read'));
  const proposal = await functions.execute({ user: owner, call: send, requestId: 'typed-send', confirmed: true });
  assert.equal(proposal.requiresConfirmation, true, 'model/transport flags cannot approve');
  assert.equal((await notifications.list({ user: owner })).items.length, 0);
  assert(!JSON.stringify(proposal.functionResponse).includes(proposal.confirmation.approvalHash));
  assert.equal((await functions.confirm({ user: other, call: send, actionId: proposal.actionId, approvalHash: proposal.confirmation.approvalHash })).error, 'action_not_found');
  assert.equal((await functions.confirm({ user: owner, call: { ...send, args: { ...send.args, body: 'changed' } }, actionId: proposal.actionId, approvalHash: proposal.confirmation.approvalHash })).error, 'action_request_conflict');
  const sent = await functions.confirm({ user: owner, call: send, actionId: proposal.actionId, approvalHash: proposal.confirmation.approvalHash });
  assert.equal(sent.ok, true); assert.equal(sent.output.deliveryState, 'saved'); assert.equal(sent.output.backgroundPush, false);
  assert.equal(sent.output.notification.sourceId, 'request:action:' + proposal.actionId);
  const replay = await functions.execute({ user: owner, call: { ...send, id: 'changed-model-id' }, requestId: 'typed-send' });
  assert.equal(replay.actionId, proposal.actionId); assert.equal((await notifications.list({ user: owner })).items.length, 1);
  assert.equal((await notifications.list({ user: other })).items.length, 0);
  const noticeId = sent.output.notification.id;

  const settingsCall = { name: send.name, id: 'voice-settings', args: { action: 'settings', patch: { channels: { voice: true }, quietHours: { enabled: true, start: '22:00', end: '07:00', timeZone: 'Asia/Bangkok' }, askBeforeNotify: false } } };
  const settingsProposal = await functions.execute({ user: owner, call: settingsCall, source: 'gemini-live', requestId: 'voice-settings', requireCallId: true });
  assert.equal(settingsProposal.requiresConfirmation, true);
  assert.equal((await notifications.settings({ user: owner })).settings.channels.voice, false);
  const saved = await functions.confirm({ user: owner, call: settingsCall, actionId: settingsProposal.actionId, approvalHash: settingsProposal.confirmation.approvalHash });
  assert.equal(saved.output.settings.channels.voice, true); assert.equal(saved.output.settings.askBeforeNotify, false);
  assert.equal(saved.output.settings.channels.inApp, false); assert.equal((await notifications.settings({ user: other })).settings.channels.voice, false);
  const eventCall = { name: send.name, id: 'event-settings', args: { action: 'settings', patch: { events: { operation_succeeded: false } } } };
  const eventProposal = await functions.execute({ user: owner, call: eventCall, source: 'gemini-live', requestId: 'event-settings', requireCallId: true });
  assert.equal(eventProposal.requiresConfirmation, true);
  assert.equal((await notifications.settings({ user: owner })).settings.events.operation_succeeded, true, 'event switches wait for exact approval');
  const eventResult = await functions.confirm({ user: owner, call: eventCall, actionId: eventProposal.actionId, approvalHash: eventProposal.confirmation.approvalHash });
  assert.equal(eventResult.output.settings.events.operation_succeeded, false);
  assert.equal(eventResult.output.settings.events.operation_failed, true, 'turning success off leaves failures enabled');
  assert.equal((await notifications.settings({ user: other })).settings.events.operation_succeeded, true);
  const eventSettings = await functions.execute({ user: owner, call: { name: 'panthorium_notifications_read', args: { action: 'settings' } } });
  assert(eventSettings.output.eventCatalog.some(entry => entry.id === 'operation_succeeded'));
  const declaration = functions.declarationsFor(owner, { surface: 'gemini-live' }).find(tool => tool.name === send.name);
  assert.equal(declaration.parameters.properties.patch.properties.events.properties.operation_succeeded.type, 'BOOLEAN');
  const read = await functions.execute({ user: owner, call: { name: 'panthorium_notifications_read', args: { action: 'list', unreadOnly: true } } });
  assert.equal(read.output.untrusted, true); assert.equal(read.output.items[0].id, noticeId); assert.equal(read.output.items[0].readAt, null);
  assert.equal((await notifications.list({ user: owner })).unreadCount, 1, 'read-aloud/read does not silently mark read');

  for (const bad of [
    { ...send.args, userId: other.sub }, { ...send.args, confirmed: true }, { ...send.args, requestId: 'spoofed' },
    { ...send.args, dueAt: new Date().toISOString() }, { ...send.args, category: 'unknown' }, { ...send.args, body: 'x'.repeat(2001) },
    { action: 'settings', patch: { channels: { voice: 'true' } } }, { action: 'settings', patch: { channels: { sms: true } } },
    { action: 'settings', patch: { quietHours: { start: '25:00' } } }, { action: 'settings', patch: { quietHours: { timeZone: 'bad/timezone' } } },
    { action: 'settings', patch: JSON.parse('{"__proto__":{"polluted":true}}') },
    { action: 'settings', patch: { categories: { constructor: true } } }, { action: 'settings', patch: {} },
    { action: 'settings', patch: { events: { operation_succeeded: 'false' } } },
    { action: 'settings', patch: { events: { invented_event: true } } },
    { action: 'settings', patch: { events: JSON.parse('{"__proto__":true}') } },
    { action: 'mark_read', ids: [noticeId], all: true }, { action: 'delete', all: true }, { action: 'delete', ids: ['not-real'] }
  ]) {
    const result = await functions.execute({ user: owner, call: { name: send.name, args: bad }, requestId: randomUUID() });
    assert.equal(result.ok, false); assert.equal(result.error, 'invalid_notification_args'); assert.equal(result.requiresConfirmation, undefined);
  }
  assert.equal(validateNotificationArgs('notifications.read', { action: 'settings', unreadOnly: true }), 'invalid_notification_args');
  assert.equal(validateNotificationArgs('notifications.read', { action: 'list', before: 'other-cursor' }), 'invalid_notification_args');
  assert.equal(validateNotificationArgs('notifications.read', { action: 'list', limit: '20' }), 'invalid_notification_args');
  assert.equal({}.polluted, undefined);

  const deleteForeign = { name: send.name, id: 'foreign-delete', args: { action: 'delete', ids: [noticeId] } };
  const foreignProposal = await functions.execute({ user: other, call: deleteForeign, requestId: 'foreign-delete' });
  const foreignResult = await functions.confirm({ user: other, call: deleteForeign, actionId: foreignProposal.actionId, approvalHash: foreignProposal.confirmation.approvalHash });
  assert.equal(foreignResult.output.changed, 0); assert.equal((await notifications.list({ user: owner })).items.length, 1);

  const history = [], gatewayCalls = [];
  const sentinel = new Sentinel({ sessions: { append(_id, message) { history.push(message); return [...history]; }, clear() {}, size() { return 1; } }, prompts: { build: () => '', productContext: () => '' }, gateway: {
    orderedProviders: () => ['vertex'], async stream() { throw new Error('notification-only tools must use function loop'); },
    async complete(input) { gatewayCalls.push(input); assert(input.systemPrompt.includes(NOTIFICATION_GUIDANCE)); return { ok: true, text: '', provider: 'vertex', functionCalls: [send], modelParts: [{ functionCall: send }] }; }
  } });
  const streamed = await sentinel.streamChat({ user: owner, userId: owner.sub, sessionId: 'notify-chat', message: 'ส่งแจ้งเตือนถึงฉันด้วย', requestId: 'chat-notification', functionCalling: functions });
  assert.equal(streamed.toolResults[0].requiresConfirmation, true); assert.match(streamed.text, /รายละเอียดการแจ้งเตือน/); assert.equal(gatewayCalls.length, 1);
  assert.equal((await notifications.list({ user: owner })).items.length, 1, 'typed proposal cannot send before exact approval');

  let upstream, options;
  const live = createGeminiLiveWebSocketGateway({ authService: { verifyAccessToken: () => owner }, WebSocketServerImpl: WSS, functionCalling: functions,
    connectLive: async input => { options = input; upstream = new Socket(); return upstream; }, projectId: 'notification-test' });
  const server = new EventEmitter(), client = new Socket(); WSS.instance.client = client; live.attach(server);
  server.emit('upgrade', { url: '/api/live', headers: { origin: 'https://panthorium.test', host: 'panthorium.test' } }, {}, Buffer.alloc(0));
  client.emit('message', JSON.stringify({ type: 'auth', token: 'test' }), false); await tick();
  assert(options.systemInstruction.includes(NOTIFICATION_GUIDANCE));
  assert(options.tools.some(tool => tool.name === send.name));
  upstream.emit('message', JSON.stringify({ setupComplete: {} }), false); await tick();
  upstream.emit('message', JSON.stringify({ toolCall: { functionCalls: [{ name: 'panthorium_notifications_read', id: 'spoken-read', args: { action: 'list', unreadOnly: true } }] } }), false);
  await tick(); await tick();
  const voiceRead = upstream.sent.find(frame => frame.tool_response);
  assert.equal(voiceRead.tool_response.function_responses[0].response.output.unreadCount, 1);
  assert.equal(voiceRead.tool_response.function_responses[0].response.output.items[0].title, send.args.title);
  assert(!client.sent.some(frame => frame.type === 'toolApprovalRequired'));
  client.close(); live.close?.();

  // Existing scheduled reminders retain email consent and exact-match identity,
  // with all existing backend kinds and postpone now reachable by voice.
  const reminderId = randomUUID(), reminderCalls = [];
  registerPersonalFunctionTools(registry, { reminders: { async list() { return { ok: true, reminders: [{ reminderId, title: 'ทบทวนบทเรียน', kind: 'study', recurrence: { frequency: 'daily' } }], deliveryAvailable: true }; }, async snooze(input) { reminderCalls.push(input); return { ok: true }; } } });
  const reminderTool = registry.get('reminders.write'), dueAt = new Date(Date.now() + 86400000).toISOString();
  for (const kind of ['task', 'deadline', 'study']) assert.equal(reminderTool.validateArgs({ action: 'create', kind, title: 'งาน', dueAt, timeZone: 'Asia/Bangkok', emailConsent: true }), null);
  assert.equal(reminderTool.validateArgs({ action: 'create', kind: 'task', title: 'งาน', dueAt, timeZone: 'Asia/Bangkok' }), 'invalid_reminder');
  assert.equal(reminderTool.validateArgs({ action: 'snooze', reminderId, expectedTitle: 'ทบทวนบทเรียน', dueAt }), null);
  assert.equal(reminderTool.validateArgs({ action: 'snooze', reminderId, expectedTitle: 'ทบทวนบทเรียน', dueAt: '2027-01-01T10:00:00' }), 'invalid_reminder');
  await assert.rejects(() => reminderTool.run({ user: owner, args: { action: 'snooze', reminderId, expectedTitle: 'wrong', dueAt } }), /reminder_not_found/);
  await reminderTool.run({ user: owner, args: { action: 'snooze', reminderId, expectedTitle: 'ทบทวนบทเรียน', dueAt } });
  assert.equal(reminderCalls[0].user.sub, owner.sub); assert.equal(reminderCalls[0].dueAt, dueAt);
  await notifications.close();
  console.log('Notification tools: typed/live reads, exact approval, owner isolation, replay, strict settings, safe guidance and reminder snooze passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
