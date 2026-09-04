const assert=require('assert');
const{MultiAgentRunRepository}=require('../services/multiAgentRunRepository');
const{MultiAgentOrchestrator}=require('../services/multiAgentOrchestrator');
(async()=>{
 const runs=new MultiAgentRunRepository();await runs.init();
 const audit={record(){}};let calls=0;
 const workflow={async run(){calls++;return{ok:true,status:'completed',workflowId:`wf-${calls}`,result:`result-${calls}`};},async confirm(){return{ok:true,completed:true};},async cancel(){return{ok:true,cancelled:true};}};
 const service=new MultiAgentOrchestrator({workflow,audit,runs});
 const guest={sub:'guest:abc',permissions:['chat']};assert.equal(service.listRoles(guest).error,'multi_agent_requires_account');
 const user={sub:'user-a',permissions:['chat']};const other={sub:'user-b',permissions:['chat']};
 assert.equal(service.listRoles(user).roles.length,5);
 assert.equal((await service.run({user,request:'',roles:['researcher']})).error,'invalid_multi_agent_request');
 assert.equal((await service.run({user,request:'task',roles:['unknown']})).error,'invalid_multi_agent_roles');
 const result=await service.run({user,request:'analyze this',roles:['researcher','reviewer'],provider:'groq'});assert.equal(result.ok,true);assert.equal(result.status,'completed');assert.equal(result.outputs.length,2);
 const saved=await service.get(user,result.orchestrationId);assert.equal(saved.ok,true);assert.equal(saved.run.status,'completed');assert.equal(saved.run.outputs.length,2);assert.equal(saved.run.provider,'groq');
 const isolated=await service.get(other,result.orchestrationId);assert.equal(isolated.error,'orchestration_not_found');
 const history=await service.history(user,10);assert.equal(history.runs.length,1);
 let runCalls=0;let confirmedWorkflowId=null;
 const waitingWorkflow={
  async run(){runCalls++;if(runCalls===1)return{ok:true,status:'waiting_confirmation',confirmationRequired:true,workflowId:'wf-confirm'};return{ok:true,status:'completed',workflowId:`wf-after-${runCalls}`,result:`after-${runCalls}`};},
  async confirm({workflowId}){confirmedWorkflowId=workflowId;return{ok:true,workflowId,executed:true,completed:true,results:[{ok:true}]};},
  async cancel(){return{ok:true,cancelled:true};}
 };
 const waitingService=new MultiAgentOrchestrator({workflow:waitingWorkflow,audit,runs});
 const waiting=await waitingService.run({user,request:'sensitive task',roles:['operator','reviewer'],provider:'openai'});assert.equal(waiting.status,'waiting_confirmation');assert.equal(waiting.workflowId,'wf-confirm');
 const waitingSaved=await waitingService.get(user,waiting.orchestrationId);assert.equal(waitingSaved.run.status,'waiting_confirmation');assert.equal(waitingSaved.run.currentRole,'operator');assert.equal(waitingSaved.run.provider,'openai');
 const resumed=await waitingService.confirm({user,orchestrationId:waiting.orchestrationId});assert.equal(confirmedWorkflowId,'wf-confirm');assert.equal(resumed.ok,true);assert.equal(resumed.status,'completed');assert.equal(resumed.outputs.length,2);assert.equal(runCalls,2);
 const resumedSaved=await waitingService.get(user,waiting.orchestrationId);assert.equal(resumedSaved.run.status,'completed');assert.equal(resumedSaved.run.currentRole,null);assert.equal(resumedSaved.run.workflowId,null);
 const confirmAgain=await waitingService.confirm({user,orchestrationId:waiting.orchestrationId});assert.equal(confirmAgain.error,'orchestration_not_waiting');
 let cancelCount=0;const cancelWorkflow={async run(){return{ok:true,confirmationRequired:true,workflowId:'wf-cancel'};},async confirm(){return{ok:true};},async cancel(){cancelCount++;return{ok:true,cancelled:true};}};
 const cancelService=new MultiAgentOrchestrator({workflow:cancelWorkflow,audit,runs});const pending=await cancelService.run({user,request:'cancel me',roles:['operator']});assert.equal(pending.status,'waiting_confirmation');const cancelled=await cancelService.cancel({user,orchestrationId:pending.orchestrationId});assert.equal(cancelled.status,'cancelled');assert.equal(cancelCount,1);const cancelAgain=await cancelService.cancel({user,orchestrationId:pending.orchestrationId});assert.equal(cancelAgain.error,'orchestration_not_active');
 const otherConfirm=await waitingService.confirm({user:other,orchestrationId:waiting.orchestrationId});assert.equal(otherConfirm.error,'orchestration_not_found');
 console.log('Phase 8 orchestration resume tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
