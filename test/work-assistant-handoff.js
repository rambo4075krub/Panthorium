'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { CloudAppRuntime } = require('../services/cloudAppRuntime');
const { WORKFLOW_GROUPS } = require('../services/workflowCatalog');
const { MODES, TEMPLATES } = require('../services/workAssistantService');
const { fixture } = require('./work-assistant');
(async () => {
  const f = fixture(), cloudApps = new CloudAppRuntime({ allowMemory: true, complete: async () => ({ text: JSON.stringify({ draft: 'รายงานจากข้อมูลจริง [S1]', sourceIds: ['S1'], unknowns: ['ต้องยืนยันวันส่ง'], nextActions: ['ตรวจเอกสาร'] }) }) });
  await cloudApps.init(); f.service.cloudApps = cloudApps;
  const session = await cloudApps.launch({ user: f.user, packId: 'profession_3' });
  const run = await cloudApps.execute({ user: f.user, sessionId: session.id, featureId: 'profession_3_f1', input: 'สรุปเอกสาร', sources: [{ title: 'ต้นฉบับ', content: 'ยอดรวม 1200 บาท' }], idempotencyKey: randomUUID() });
  assert.equal(run.status, 'draft_ready');
  const [first, duplicate] = await Promise.all([f.service.importRun({ user: f.user, runId: run.id }), f.service.importRun({ user: f.user, runId: run.id })]);
  assert.equal(first.project.id, duplicate.project.id); assert.equal((await f.service.list({ user: f.user })).projects.length, 1);
  assert.equal(first.project.draft, run.result.draft); assert.match(first.project.text, /ยอดรวม 1200 บาท/); assert.equal(first.project.origin.runId, run.id);
  await assert.rejects(() => f.service.importRun({ user: f.other, runId: run.id }), /cloud_apps_run_not_found/);
  await assert.rejects(() => f.service.importRun({ user: { ...f.user, isMinor: true }, runId: run.id }), /minor_provider_policy_not_verified/);
  await f.service.save({ user: f.user, projectId: first.project.id, expectedVersion: 1, operationId: randomUUID(), patch: { draft: 'ผู้ใช้แก้ไขแล้ว' } });
  const reopened = await f.service.importRun({ user: f.user, runId: run.id }); assert.equal(reopened.project.draft, 'ผู้ใช้แก้ไขแล้ว');
  assert.equal((await cloudApps.get({ user: f.user, runId: run.id })).result.draft, run.result.draft, 'Handoff must preserve the original run');
  const failed = { ...run, id: randomUUID(), status: 'failed', result: null }; cloudApps.repository.runs.set(failed.id, { ...failed, userId: f.user.sub });
  await assert.rejects(() => f.service.importRun({ user: f.user, runId: failed.id }), /work_import_not_ready/);
  assert.equal(WORKFLOW_GROUPS.length, 8);
  const ids = new Set();
  for (const group of WORKFLOW_GROUPS) {
    assert(group.needs); assert.equal(group.tasks.length, 2);
    for (const task of group.tasks) { assert(!ids.has(task.id)); ids.add(task.id); assert(MODES.includes(task.mode)); assert(TEMPLATES.some(t => t.id === task.template)); assert(task.instruction.length <= 4000); }
  }
  console.log('PASS eight-group workflow handoff: actual Cloud App run, preserved sources, concurrent idempotence, draft preservation, account/minor gates and task starter validation');
})().catch(failure => { console.error(failure); process.exitCode = 1; });
