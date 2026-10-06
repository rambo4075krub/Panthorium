const assert = require('node:assert/strict');
const { ReminderRepository } = require('../services/reminderRepository');
const { ReminderService } = require('../services/reminderService');

(async () => {
  const repository = new ReminderRepository();
  const accounts = new Map([
    ['alice', { email: 'alice@example.test', emailVerifiedAt: new Date().toISOString() }],
    ['bob', { email: 'bob@example.test', emailVerifiedAt: new Date().toISOString() }]
  ]);
  const sent = [];
  const service = new ReminderService({
    repository,
    authService: { repository: { findUserById: async id => accounts.get(id) || null } },
    sender: async message => { sent.push(message); },
    audit: { record() {} }
  });
  await service.init();
  const alice = { sub: 'alice', permissions: ['chat'], roles: [] };
  const bob = { sub: 'bob', permissions: ['chat'], roles: [] };
  const dueAt = new Date(Date.now() + 60000).toISOString();

  const noConsent = await service.create({ user: alice, kind: 'medication', title: 'ยาหลังอาหาร', dueAt, timeZone: 'Asia/Bangkok' });
  assert.equal(noConsent.error, 'reminder_email_consent_required');
  const guest = await service.create({ user: { ...alice, sub: 'guest:one', roles: ['guest'] }, kind: 'appointment', title: 'นัด', dueAt, timeZone: 'UTC', emailConsent: true });
  assert.equal(guest.error, 'reminder_requires_account');

  const first = await service.create({ user: alice, kind: 'medication', title: 'ยาหลังอาหาร', dueAt, timeZone: 'Asia/Bangkok', emailConsent: true });
  const second = await service.create({ user: bob, kind: 'appointment', title: 'นัดหมาย', dueAt, timeZone: 'UTC', emailConsent: true });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal((await service.list({ user: alice })).reminders.length, 1);
  assert.equal((await service.list({ user: bob })).reminders.length, 1);
  assert.equal((await service.cancel({ user: bob, reminderId: first.reminder.reminderId })).error, 'reminder_not_found_or_already_started');

  const due = await repository.create({ userId: 'alice', kind: 'appointment', title: 'ทดสอบส่ง', details: '', dueAt: new Date(Date.now() - 1000).toISOString(), timeZone: 'Asia/Bangkok', status: 'scheduled' });
  const delivery = await service.deliverDue();
  assert.equal(delivery.ok, true);
  assert.equal(delivery.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, 'alice@example.test');
  assert.match(sent[0].subject, /นัดหมาย/);
  assert.equal((await repository.list('alice')).find(row => row.reminderId === due.reminderId).status, 'sent');

  const failingRepository = new ReminderRepository();
  await failingRepository.create({ userId: 'alice', kind: 'appointment', title: 'ลองใหม่', dueAt: new Date(Date.now() - 1000).toISOString(), timeZone: 'UTC', status: 'scheduled' });
  const failing = new ReminderService({ repository: failingRepository, authService: { repository: { findUserById: async id => accounts.get(id) } }, sender: async () => { throw new Error('offline'); }, audit: { record() {} } });
  await failing.deliverDue();
  const retried = (await failingRepository.list('alice'))[0];
  assert.equal(retried.status, 'scheduled');
  assert.equal(retried.attempts, 1);

  const unavailable = new ReminderService({ repository: new ReminderRepository(), authService: { repository: { findUserById: async id => accounts.get(id) } }, config: {}, audit: { record() {} } });
  assert.equal((await unavailable.create({ user: alice, kind: 'appointment', title: 'นัด', dueAt, timeZone: 'UTC', emailConsent: true })).error, 'reminder_email_unavailable');
  console.log('Cloud reminders: account isolation, email consent, delivery and retry checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
