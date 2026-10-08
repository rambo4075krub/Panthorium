'use strict';

const assert = require('node:assert/strict');
const { AgentPlannerService } = require('../services/agentPlannerService');

(async () => {
  let executions = 0;
  const agentService = {
    catalogFor() { return [{ id: 'knowledge.search', description: 'Search knowledge', argsSchema: {}, risk: 'low' }]; },
    validateArgs() { return { ok: true }; },
    async execute() { executions += 1; return { ok: true }; }
  };
  const gateway = {
    async complete({ history }) {
      const request = history[0].content;
      if (request.includes('find knowledge')) return { ok: true, provider: 'mock', model: 'planner', text: JSON.stringify({ action: 'tool', toolId: 'knowledge.search', args: { query: 'panthorium' }, reason: 'search', answer: null }) };
      if (request.includes('broken arguments')) return { ok: true, provider: 'mock', model: 'planner', text: JSON.stringify({ action: 'tool', toolId: 'knowledge.search', args: { query: 'wrong' }, reason: 'search', answer: null }) };
      return { ok: true, provider: 'mock', model: 'planner', text: JSON.stringify({ action: 'answer', toolId: null, args: {}, reason: 'no tool needed', answer: 'A direct answer.' }) };
    }
  };
  const planner = new AgentPlannerService({ agentService, gateway, audit: { record() {} } });
  const user = { sub: 'admin', permissions: ['chat', 'settings'] };
  const measured = await planner.evaluateCases({ user, cases: [
    { id: 'tool-case', request: 'find knowledge', expected: { action: 'tool', toolId: 'knowledge.search', args: { query: 'panthorium' } } },
    { id: 'answer-case', request: 'answer directly', expected: { action: 'answer' } }
  ] });
  assert.equal(measured.ok, true);
  assert.equal(measured.summary.actionAccuracy, 100);
  assert.equal(measured.summary.toolSelectionAccuracy, 100);
  assert.equal(measured.summary.argumentAccuracy, 100);
  const argumentFailure = await planner.evaluateCases({ user, cases: [{ id: 'bad-args', request: 'broken arguments', expected: { action: 'tool', toolId: 'knowledge.search', args: { query: 'panthorium' } } }] });
  assert.equal(argumentFailure.summary.argumentAccuracy, 0);
  assert.equal(executions, 0, 'planner benchmark must never execute a tool');
  console.log('Phase 18 tool planning evaluation tests passed');
})().catch(error => { console.error(error); process.exit(1); });
