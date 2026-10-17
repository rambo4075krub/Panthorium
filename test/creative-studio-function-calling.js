'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { ActionLedgerRepository } = require('../services/actionLedgerRepository');
const { AgentFunctionCallingService } = require('../services/agentFunctionCallingService');
const { registerCreativeStudioTools, validateStudioArgs } = require('../services/creativeStudioTools');
const { Sentinel } = require('../services/sentinel');
const express = require('express');
const { createApiRouter } = require('../routes/api');
const { createActionsRouter } = require('../routes/actions');

async function main() {
  const user = { sub: randomUUID(), permissions: ['chat'], roles: ['user'] };
  const foreign = { ...user, sub: randomUUID() };
  const starts = [];
  const jobs = new Map();
  const studio = {
    async catalog({ user: actor }) { assert.equal(actor.sub, user.sub); return { plugins: [{ id: 'document', mode: 'auto' }] }; },
    async list({ user: actor }) { return { jobs: [...jobs.values()].filter(job => job.userId === actor.sub) }; },
    async get({ user: actor, jobId }) { const job = jobs.get(jobId); if (!job || job.userId !== actor.sub) throw new Error('studio_job_not_found'); return { job }; },
    async start(input) { starts.push(input); const job = { id: randomUUID(), status: 'queued', userId: input.user.sub, files: [] }; jobs.set(job.id, job); return { job }; }
  };
  const registry = new ToolRegistry();
  registerCreativeStudioTools(registry, { studio });
  const ledger = new ActionLedgerRepository({ allowMemory: true });
  await ledger.init();
  const agent = new AgentService({ tools: registry, ledger });
  const functions = new AgentFunctionCallingService({ agentService: agent });
  const args = { pluginId: 'document', input: { prompt: 'รายงานยอดขายภาษาไทย พร้อมสำหรับพิมพ์', name: 'sales-report' } };
  const call = { id: 'model-call-1', name: 'panthorium_studio_create', args };
  for (const surface of ['sentinel-chat', 'gemini-live']) assert(functions.declarationsFor(user, { surface }).some(tool => tool.name === call.name));
  for (const guest of [{ ...user, sub: 'guest:session' }, { ...user, roles: ['guest'] }]) {
    for (const surface of ['sentinel-chat', 'gemini-live']) assert(!functions.declarationsFor(guest, { surface }).some(tool => tool.name.startsWith('panthorium_studio')));
    assert.equal((await functions.execute({ user: guest, call, requestId: 'guest-request' })).error, 'function_not_available');
  }
  const noLedger = new AgentFunctionCallingService({ agentService: new AgentService({ tools: registry }) });
  assert(!noLedger.declarationsFor(user).some(tool => tool.name === call.name));
  const proposed = await functions.execute({ user, call, requestId: 'typed-request', confirmed: true });
  assert.equal(proposed.requiresConfirmation, true, 'transport/model confirmation flag cannot approve Studio');
  assert.equal(starts.length, 0);
  assert(!JSON.stringify(proposed.functionResponse).includes(proposed.confirmation.approvalHash), 'model receives no approval secret');
  assert.equal((await agent.confirmAction({ user: foreign, actionId: proposed.actionId, approvalHash: proposed.confirmation.approvalHash })).error, 'action_not_found');
  assert.equal((await agent.confirmAction({ user, actionId: proposed.actionId, approvalHash: 'bad-hash' })).error, 'action_approval_invalid');
  const outcome = await agent.confirmAction({ user, actionId: proposed.actionId, approvalHash: proposed.confirmation.approvalHash });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.output.job.status, 'queued');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].idempotencyKey, `action:${proposed.actionId}`);
  assert.equal(starts[0].confirmed, true);
  const replay = await functions.execute({ user, call: { ...call, id: 'another-model-id' }, requestId: 'typed-request' });
  assert.equal(replay.actionId, proposed.actionId, 'changing the model call ID cannot create a duplicate job');
  assert.equal(replay.output.job.id, outcome.output.job.id);
  await agent.confirmAction({ user, actionId: proposed.actionId, approvalHash: proposed.confirmation.approvalHash });
  assert.equal(starts.length, 1);
  const status = await functions.execute({ user, call: { name: 'panthorium_studio_status', args: { jobId: outcome.output.job.id } } });
  assert.equal(status.output.job.status, 'queued');
  assert.equal(starts.length, 1, 'reading status must not advance or generate');
  const voice = await functions.execute({ user, call, source: 'gemini-live', requestId: 'voice-request', requireCallId: true });
  assert.equal(voice.requiresConfirmation, true);
  const voiceResult = await functions.confirm({ user, call, actionId: voice.actionId, approvalHash: voice.confirmation.approvalHash });
  assert.equal(voiceResult.ok, true);
  assert.equal(starts.length, 2);

  assert.equal(validateStudioArgs({ steps: [{ pluginId: 'image', input: { prompt: 'product photo' } }, { pluginId: 'presentation', input: { prompt: 'sales deck' }, usePrevious: true }] }), null);
  for (const bad of [
    { ...args, confirmed: true }, { ...args, idempotencyKey: 'spoofed' }, { ...args, ownerId: foreign.sub },
    { ...args, input: { ...args.input, providerKey: 'secret' } },
    { steps: [] }, { steps: Array(6).fill(args) }, { ...args, steps: [args] },
    { steps: [{ ...args, usePrevious: true }] }, { steps: [{ ...args, usePrevious: 'true' }] },
    { ...args, pluginId: 'unregistered' }, { ...args, sourceFileIds: ['https://example.com/private'] }
  ]) {
    const rejected = await functions.execute({ user, call: { name: call.name, args: bad }, requestId: randomUUID() });
    assert.equal(rejected.ok, false); assert.equal(rejected.requiresConfirmation, undefined);
  }
  assert.equal(starts.length, 2);

  const gatewayCalls = [];
  const gateway = {
    orderedProviders: () => ['vertex'],
    async complete(input) {
      gatewayCalls.push(input);
      if (input.history.at(-1)?.content === 'สวัสดี') return { ok: true, text: 'สวัสดี', provider: 'vertex' };
      return { ok: true, text: '', provider: 'vertex', model: 'test', functionCalls: [call], modelParts: [{ functionCall: call }] };
    },
    async stream(input) { input.onDelta?.('สวัสดี'); return { ok: true, text: 'สวัสดี', provider: 'vertex' }; }
  };
  const sentinel = new Sentinel({ gateway, prompts: { build: () => 'Sentinel', productContext: () => '' } });
  const deltas = [];
  const response = await sentinel.streamChat({ sessionId: 'creative-stream', userId: user.sub, user, message: 'ทำใบเสนอราคา', functionCalling: functions, requestId: 'stream-request', onDelta: delta => deltas.push(delta) });
  assert.equal(response.ok, true);
  assert.equal(response.streaming, 'buffered-function-calling');
  assert.equal(response.toolResults[0].requiresConfirmation, true);
  assert.equal(response.toolResults[0].confirmation.args.input.prompt, args.input.prompt);
  assert.equal(deltas.join(''), response.text);
  assert.match(response.text, /กดยืนยัน/);
  assert.equal(gatewayCalls.length, 1, 'pending approval ends the model loop');
  assert.equal(starts.length, 2, 'the stream cannot start generation before approval');
  const regular = await sentinel.streamChat({ sessionId: 'ordinary-stream', userId: user.sub, user, message: 'สวัสดี', functionCalling: functions, requestId: 'ordinary-request' });
  assert.equal(regular.text, 'สวัสดี');
  assert.equal(gatewayCalls.length, 2, 'all authenticated requests can select a creative tool without a keyword gate');
  const guest = await sentinel.streamChat({ sessionId: 'guest-stream', userId: 'guest:session', user: { ...user, sub: 'guest:session' }, message: 'สวัสดี', functionCalling: functions, requestId: 'guest-stream-request' });
  assert.equal(guest.text, 'สวัสดี');
  assert.equal(gatewayCalls.length, 2, 'guest chat preserves native streaming without creative tools');

  // Exercise the real SSE and trusted HTTP confirmation boundary together.
  const app = express();
  app.use(express.json());
  const auth = { verifyAccessToken(token) { if (token !== 'test-account') throw new Error('bad-token'); return user; } };
  app.use('/api/actions', createActionsRouter(auth, agent));
  app.use('/api', createApiRouter(sentinel, auth, { record() {} }, {}, agent, {}, {}, {}, {}, {}, functions));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body, authenticated = true) => fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-account' } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post('/api/chat/stream', { message: 'make a poster' }, false)).status, 401);
    const response = await post('/api/chat/stream', { message: 'make a poster', requestId: 'sse-creative-command' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const body = await response.text();
    const doneFrame = body.split('\n\n').find(frame => frame.startsWith('event: done\n'));
    const done = JSON.parse(doneFrame.split('\ndata: ')[1]);
    assert.equal(done.toolResults[0].requiresConfirmation, true, 'SSE transports the exact approval receipt');
    const approval = done.toolResults[0].confirmation;
    assert.equal(starts.length, 2);
    const tampered = await post(`/api/actions/${approval.actionId}/confirm`, { approvalHash: approval.approvalHash, args: { pluginId: 'video' } });
    assert.equal(tampered.status, 400);
    assert.equal(starts.length, 2);
    const confirmed = await post(`/api/actions/${approval.actionId}/confirm`, { approvalHash: approval.approvalHash });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).output.job.status, 'queued');
    assert.equal(starts.length, 3);
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  console.log('Creative Studio function calling: ledger approval, ownership, replay, workflows, typed stream and live voice passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
