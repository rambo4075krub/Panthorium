const assert = require('node:assert/strict');
const { ReminderRepository } = require('../services/reminderRepository');
const { ReminderService, localToUtc, nextOccurrence } = require('../services/reminderService');

(async () => {
  assert.equal(localToUtc({year:2026,month:3,day:8,hour:2,minute:30,second:0},'America/New_York'),null,'Nonexistent DST times are skipped');
  assert.equal(new Date(localToUtc({year:2026,month:11,day:1,hour:1,minute:30,second:0},'America/New_York')).toISOString(),'2026-11-01T05:30:00.000Z','Repeated DST time fires only on its first occurrence');
  const gap = {scheduledAt:'2026-03-07T07:30:00Z',dueAt:'2026-03-07T07:30:00Z',timeZone:'America/New_York',occurrence:1,recurrence:{frequency:'daily',interval:1,maxOccurrences:5,localTime:{hour:2,minute:30,second:0}}};
  assert.deepEqual(nextOccurrence(gap,Date.parse(gap.dueAt)),{dueAt:'2026-03-09T06:30:00.000Z',occurrence:3});
  const thai = {...gap,scheduledAt:'2026-10-15T02:00:00Z',dueAt:'2026-10-15T02:00:00Z',timeZone:'Asia/Bangkok',recurrence:{frequency:'daily',interval:1,maxOccurrences:5,localTime:{hour:9,minute:0,second:0}}};
  assert.deepEqual(nextOccurrence(thai,Date.parse('2026-10-17T05:00:00Z')),{dueAt:'2026-10-18T02:00:00.000Z',occurrence:4});
  assert.equal(nextOccurrence({...thai,recurrence:{...thai.recurrence,maxOccurrences:2}},Date.parse('2026-10-17T05:00:00Z')),null);

  const closed=new ReminderRepository({requireDatabase:true});
  await assert.rejects(()=>closed.init(),/scheduler_database_required/);
  await assert.rejects(()=>closed.create({}),/scheduler_database_required/);
  const repository=new ReminderRepository(), sent=[];
  const accounts=new Map([['alice',{email:'alice@example.test',emailVerifiedAt:'2026-01-01T00:00:00Z'}],['bob',{email:'bob@example.test',emailVerifiedAt:'2026-01-01T00:00:00Z'}]]);
  const authService={repository:{findUserById:async id=>accounts.get(id)}};
  const service=new ReminderService({repository,authService,sender:async m=>{sent.push(m);return {providerMessageId:'provider-id'};}});
  const alice={sub:'alice',permissions:['chat']},bob={sub:'bob',permissions:['chat']};
  const dueAt=new Date(Date.now()+60000).toISOString();
  for(const kind of ['task','deadline','study']) {
    const result=await service.create({user:alice,kind,title:kind,dueAt,timeZone:'Asia/Bangkok',emailConsent:true,recurrence:{frequency:'daily',maxOccurrences:5}});
    assert.equal(result.ok,true);
    const id=result.reminder.reminderId;
    assert.equal((await service.snooze({user:bob,reminderId:id,dueAt})).error,'reminder_not_found_or_already_started');
    const later=new Date(Date.now()+3600000).toISOString();
    const snoozed=await service.snooze({user:alice,reminderId:id,dueAt:later});
    assert.equal(snoozed.reminder.dueAt,later); assert.equal(snoozed.reminder.scheduledAt,dueAt);
  }
  assert.equal((await service.create({user:alice,kind:'task',title:'bad date',dueAt:'2027-01-01T09:00:00',timeZone:'Asia/Bangkok',emailConsent:true})).error,'invalid_reminder_time');
  assert.equal((await service.create({user:alice,kind:'study',title:'bad recurrence',dueAt,timeZone:'UTC',emailConsent:true,recurrence:{frequency:'daily',interval:0}})).error,'invalid_reminder_recurrence');
  assert.equal((await service.create({user:alice,kind:'study',title:'bad zone',dueAt,timeZone:'Moon/Office',emailConsent:true})).error,'invalid_time_zone');
  const past=new Date(Date.now()-1000).toISOString();
  const job=await repository.create({userId:'alice',kind:'task',title:'send once',dueAt:past,timeZone:'UTC'});
  const anotherService=new ReminderService({repository,authService,sender:service.sender});
  const result=await Promise.all([service.deliverDue(),anotherService.deliverDue()]);
  assert.equal(result.reduce((n,r)=>n+r.sent,0),1); assert.equal(sent.length,1);
  assert.equal(sent[0].idempotencyKey,`reminder/${job.reminderId}/1`);
  assert(sent[0].text.includes('\n')); assert(!sent[0].text.includes('\\n'));
  assert.equal((await repository.list('alice')).find(x=>x.reminderId===job.reminderId).providerMessageId,'provider-id');
  const interrupted=await repository.create({userId:'alice',kind:'task',title:'unknown',dueAt:past,timeZone:'UTC'});
  await repository.claimDue();
  repository.memory.set(interrupted.reminderId,{...repository.memory.get(interrupted.reminderId),updatedAt:new Date(Date.now()-3600000).toISOString()});
  assert.equal(await repository.recoverStale(),1); assert.equal((await service.deliverDue()).attempted,0);
  assert.equal((await service.snooze({user:alice,reminderId:interrupted.reminderId,dueAt})).error,'reminder_not_found_or_already_started');
  console.log('Reminder recurrence: generic kinds, timezone/DST, owner snooze, concurrent delivery and unknown outcomes passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
