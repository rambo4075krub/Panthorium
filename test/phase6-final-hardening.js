const assert = require('assert');
const { AgentAutomationService } = require('../services/agentAutomationService');
const { AgentAutomationPolicyService } = require('../services/agentAutomationPolicyService');

(async () => {
  const schedules=[]; const triggers=[]; const jobs=[]; const events=[];
  const repository={
    async listSchedules(){return schedules;}, async listTriggers(){return triggers;},
    async createSchedule(input){const item={scheduleId:'11111111-1111-4111-8111-111111111111',enabled:true,...input};schedules.push(item);return item;},
    async createTrigger(input){const item={triggerId:'22222222-2222-4222-8222-222222222222',enabled:true,...input};triggers.push(item);return item;},
    async disableSchedule(){return null;}, async disableTrigger(){return null;},
    async matchingTriggers(){return triggers.filter(t=>t.enabled);}, async claimDueSchedules(){return[];}
  };
  const jobRepo={async create(input){const item={jobId:'33333333-3333-4333-8333-333333333333',...input};jobs.push(item);return item;}};
  const audit={record:(event,data)=>events.push({event,data})};
  const policy=new AgentAutomationPolicyService();
  const service=new AgentAutomationService({repository,jobs:jobRepo,audit,policy});

  const admin={sub:'u-admin',roles:['administrator'],permissions:['chat','core:command']};
  const account={sub:'u-account',roles:[],permissions:['chat']};
  const guest={sub:'guest:1',roles:['guest'],permissions:['chat']};

  const denied=await service.createSchedule({user:guest,request:'x',firstRunAt:new Date(Date.now()+60000).toISOString(),everyMinutes:15});
  assert.equal(denied.error,'automation_requires_account');

  const schedule=await service.createSchedule({user:admin,request:'check status',firstRunAt:new Date(Date.now()+60000).toISOString(),everyMinutes:1,maxRuns:2});
  assert.equal(schedule.ok,true);

  const trigger=await service.createTrigger({user:admin,eventKey:'security.alert',request:'inspect alert'});
  assert.equal(trigger.ok,true);

  const accountEmit=await service.emit({user:account,eventKey:'security.alert',payload:{severity:'high'}});
  assert.equal(accountEmit.error,'automation_event_emit_denied');

  const circular={}; circular.self=circular;
  const circularResult=await service.emit({user:admin,eventKey:'security.alert',payload:circular});
  assert.equal(circularResult.error,'invalid_event_payload');

  const tooLarge=await service.emit({user:admin,eventKey:'security.alert',payload:{text:'x'.repeat(5000)}});
  assert.equal(tooLarge.error,'event_payload_too_large');

  const emitted=await service.emit({user:admin,eventKey:'security.alert',payload:{severity:'critical'}});
  assert.equal(emitted.ok,true); assert.equal(emitted.scheduledJobs.length,1); assert.equal(jobs.length,1);
  assert(events.some(e=>e.event==='agent.automation_policy_denied'));
  console.log('Phase 6 final hardening tests passed');
})().catch((error)=>{console.error(error);process.exit(1);});