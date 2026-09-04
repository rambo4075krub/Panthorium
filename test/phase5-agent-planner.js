const assert = require('assert');
const { AgentPlannerService } = require('../services/agentPlannerService');

(async () => {
  const events = [];
  const audit = { record: (event, data) => events.push({ event, data }) };
  const tools = [
    { id: 'system.status', description: 'status', permission: 'system:read', mutates: false, requiresConfirmation: false },
    { id: 'conversation.clear', description: 'clear', permission: 'chat', mutates: true, requiresConfirmation: true }
  ];
  const executions = [];
  const agentService = {
    catalogFor: () => tools,
    validateArgs: () => ({ ok: true }),
    async execute(input) { executions.push(input); return { ok: true, toolId: input.toolId, output: { done: true } }; }
  };
  let response = JSON.stringify({ action: 'tool', toolId: 'system.status', args: {}, reason: 'Need runtime status', answer: null });
  const gateway = { async complete() { return { ok: true, text: response, provider: 'mock', model: 'mock-model' }; } };
  const planner = new AgentPlannerService({ agentService, gateway, audit });
  const user = { sub: 'u1', permissions: ['chat', 'system:read'] };

  let planned = await planner.plan({ user, request: 'show status' });
  assert.equal(planned.ok, true); assert.equal(planned.plan.toolId, 'system.status');
  let run = await planner.run({ user, request: 'show status' });
  assert.equal(run.executed, true); assert.equal(executions.length, 1);

  response = JSON.stringify({ action: 'tool', toolId: 'conversation.clear', args: { sessionId: 's1' }, reason: 'User asked to clear it', answer: null });
  run = await planner.run({ user, request: 'clear s1' });
  assert.equal(run.confirmationRequired, true); assert.equal(executions.length, 1);
  run = await planner.run({ user, request: 'clear s1', confirmed: true });
  assert.equal(run.executed, true); assert.equal(executions.length, 2);

  response = JSON.stringify({ action: 'tool', toolId: 'invented.tool', args: {}, reason: 'bad', answer: null });
  planned = await planner.plan({ user, request: 'bad plan' });
  assert.equal(planned.ok, false); assert.equal(planned.error, 'invalid_plan_tool');

  response = JSON.stringify({ action: 'answer', toolId: null, args: {}, reason: 'No tool needed', answer: 'hello' });
  run = await planner.run({ user, request: 'say hello' });
  assert.equal(run.ok, true); assert.equal(run.executed, false); assert.equal(run.answer, 'hello');
  assert(events.some(e => e.event === 'agent.plan_completed'));
  assert(events.some(e => e.event === 'agent.plan_failed'));
  console.log('Phase 5 agent planner tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
