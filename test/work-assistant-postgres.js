'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { fixture } = require('./work-assistant');
(async () => {
  if (!process.env.TEST_DATABASE_URL) { console.log('SKIP work assistant PostgreSQL: TEST_DATABASE_URL is not set'); return; }
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }), f = fixture();
  f.repository.pool = pool; f.memory.repository.pool = pool; f.reminders.repository.pool = pool;
  const { user, service, memory, reminders, repository } = f, projectId = randomUUID(), taskId = randomUUID();
  try {
    await memory.init(); await reminders.init(); await repository.init();
    let p = (await service.save({ user, projectId, expectedVersion: 0, operationId: randomUUID(), patch: { title: 'Atomic integration fixture' } })).project;
    const task = { title: 'ส่งรายงาน', dueAt: new Date(Date.now() + 4 * 86400000).toISOString(), timeZone: 'Asia/Bangkok', assignee: '', details: 'fixture', remindBeforeMinutes: 60, emailConsent: true };
    p = (await service.changeTask({ user, projectId, expectedVersion: p.version, operationId: randomUUID(), taskId, action: 'create', task, confirmed: true })).project;
    const reminderId = p.tasks[0].reminderId, original = await reminders.repository.get(user.sub, reminderId);
    const update = memory.repository.update; memory.repository.update = async () => { throw Error('database_fixture_failure'); };
    await assert.rejects(() => service.changeTask({ user, projectId, expectedVersion: p.version, operationId: randomUUID(), taskId, action: 'update', task: { ...task, dueAt: new Date(Date.now() + 6 * 86400000).toISOString() }, confirmed: true }), /database_fixture_failure/);
    memory.repository.update = update;
    assert.equal((await reminders.repository.get(user.sub, reminderId)).dueAt, original.dueAt);
    assert.equal((await service.get({ user, projectId })).project.version, p.version);
    const mutations = await Promise.allSettled(['complete', 'cancel'].map(action => service.changeTask({ user, projectId, expectedVersion: p.version, operationId: randomUUID(), taskId, action, confirmed: true })));
    assert.equal(mutations.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(mutations.find(result => result.status === 'rejected').reason.code, 'work_version_conflict');
    assert.equal((await reminders.repository.get(user.sub, reminderId)).status, 'cancelled'); assert.equal(await memory.repository.get(user.sub, taskId), null);
    await assert.rejects(() => service.get({ user: f.other, projectId }), /work_project_not_found/);
    assert.equal((await service.list({ user: f.other })).projects.length, 0);
    console.log('PASS work assistant PostgreSQL: real multi-table rollback, concurrent version protection, cancellation and tenant isolation');
  } finally {
    for (const [table, key] of [['panthorium_work_projects', 'owner_id'], ['panthorium_agent_memories', 'user_id'], ['panthorium_reminders', 'user_id']]) await pool.query(`DELETE FROM ${table} WHERE ${key}=$1`, [user.sub]).catch(() => {});
    await pool.end();
  }
})().catch(failure => { console.error(failure); process.exitCode = 1; });
