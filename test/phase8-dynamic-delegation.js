const assert=require('assert');
const{MultiAgentPlannerService}=require('../services/multiAgentPlannerService');
const{MultiAgentRunRepository}=require('../services/multiAgentRunRepository');
const{MultiAgentOrchestrator}=require('../services/multiAgentOrchestrator');
(async()=>{
 const audit={record(){}};const catalog=[{id:'researcher'},{id:'analyst'},{id:'operator'},{id:'reviewer'},{id:'synthesizer'}];
 const aiGateway={async complete(){return{ok:true,text:JSON.stringify({roles:['researcher','analyst','synthesizer'],reason:'research then synthesize'}),provider:'test',model:'planner'};}};
 const planner=new MultiAgentPlannerService({gateway:aiGateway,audit});const user={sub:'user-a',permissions:['chat']};
 const planned=await planner.plan({user,request:'research this topic',roleCatalog:catalog});assert.deepEqual(planned.roles,['researcher','analyst','synthesizer']);assert.equal(planned.source,'ai');
 const explicit=await planner.plan({user,request:'task',roles:['reviewer'],roleCatalog:catalog});assert.deepEqual(explicit.roles,['reviewer']);assert.equal(explicit.source,'explicit');
 const invalid=await planner.plan({user,request:'task',roles:['root'],roleCatalog:catalog});assert.equal(invalid.error,'invalid_multi_agent_roles');
 const broken=new MultiAgentPlannerService({gateway:{async complete(){return{ok:true,text:'not-json'};}},audit});const fallback=await broken.plan({user,request:'update and deploy the system',roleCatalog:catalog});assert(fallback.roles.includes('operator'));assert(fallback.roles.includes('reviewer'));assert.equal(fallback.source,'fallback');
 const runs=new MultiAgentRunRepository();await runs.init();let calls=0;const workflow={async run(){calls++;return{ok:true,status:'completed',workflowId:`wf-${calls}`};}};const service=new MultiAgentOrchestrator({workflow,audit,runs,planner});
 const result=await service.run({user,request:'research this topic'});assert.equal(result.ok,true);assert.deepEqual(result.roles,['researcher','analyst','synthesizer']);assert.equal(result.plan.source,'ai');assert.equal(result.outputs.length,3);
 const saved=await service.get(user,result.orchestrationId);assert.equal(saved.run.plan.source,'ai');assert.deepEqual(saved.run.roles,result.roles);
 console.log('Phase 8 dynamic delegation tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
