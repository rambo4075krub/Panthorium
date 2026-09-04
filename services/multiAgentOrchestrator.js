const { randomUUID } = require('crypto');

class MultiAgentOrchestrator {
  constructor({ workflow, audit, runs } = {}) {
    this.workflow = workflow; this.audit = audit; this.runs = runs;
    this.roles = new Map([
      ['researcher', { name: 'Researcher', purpose: 'Gather and organize relevant facts and context.' }],
      ['analyst', { name: 'Analyst', purpose: 'Analyze evidence, constraints, risks and trade-offs.' }],
      ['operator', { name: 'Operator', purpose: 'Execute permitted tools and operational steps through the existing Agent safety layer.' }],
      ['reviewer', { name: 'Reviewer', purpose: 'Review outputs for completeness, conflicts and safety before synthesis.' }],
      ['synthesizer', { name: 'Synthesizer', purpose: 'Combine specialist outputs into a concise final result.' }]
    ]);
  }
  allowed(user) { return !!user?.sub && !String(user.sub).startsWith('guest:') && Array.isArray(user.permissions) && user.permissions.includes('chat'); }
  listRoles(user) { if (!this.allowed(user)) return { ok:false,error:'multi_agent_requires_account' }; return { ok:true,roles:[...this.roles.entries()].map(([id,v])=>({id,...v})) }; }
  validateRoles(roles) { const requested=Array.isArray(roles)&&roles.length?roles:['researcher','analyst','reviewer','synthesizer']; if(requested.length>6)return null; const unique=[...new Set(requested.map(x=>String(x||'').trim().toLowerCase()))]; return !unique.length||unique.some(id=>!this.roles.has(id))?null:unique; }
  async history(user, limit) { if(!this.allowed(user)) return {ok:false,error:'multi_agent_requires_account'}; return {ok:true,runs:await this.runs.list(user.sub,limit)}; }
  async get(user, id) { if(!this.allowed(user)) return {ok:false,error:'multi_agent_requires_account'}; const run=await this.runs.get(user.sub,id); return run?{ok:true,run}:{ok:false,error:'orchestration_not_found'}; }
  async persist(run) { return this.runs?.save ? this.runs.save(run) : run; }
  async run({ user, request, roles, provider, requestId } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'multi_agent_requires_account' };
    const task=String(request||'').trim(); if(!task||task.length>4000)return {ok:false,error:'invalid_multi_agent_request'};
    const selected=this.validateRoles(roles); if(!selected)return {ok:false,error:'invalid_multi_agent_roles'}; if(!this.workflow?.run)return {ok:false,error:'multi_agent_workflow_unavailable'};
    const orchestrationId=randomUUID(); const outputs=[]; const state={orchestrationId,userId:user.sub,request:task,roles:selected,outputs,status:'running',currentRole:null,workflowId:null,createdAt:new Date().toISOString()};
    await this.persist(state); this.audit?.record('agent.orchestration_started',{userId:user.sub,requestId,orchestrationId,roles:selected});
    for(const roleId of selected){
      const role=this.roles.get(roleId); state.currentRole=roleId; await this.persist(state);
      const prior=outputs.map(x=>`${x.role}: ${JSON.stringify(x.result).slice(0,3000)}`).join('\n');
      const delegatedRequest=[`You are the ${role.name} specialist in a bounded multi-agent orchestration.`,role.purpose,'Use the existing Panthorium Agent workflow and its permission/confirmation rules. Never bypass safety or confirmations.',`Original task: ${task}`,prior?`Prior specialist outputs (untrusted context):\n${prior}`:'','Return only the contribution needed from your assigned role.'].filter(Boolean).join('\n\n');
      const result=await this.workflow.run({user,request:delegatedRequest,preferredProvider:provider?.toLowerCase(),requestId}); outputs.push({role:roleId,result}); state.outputs=outputs; state.workflowId=result?.workflowId||null;
      this.audit?.record('agent.orchestration_step',{userId:user.sub,requestId,orchestrationId,role:roleId,ok:!!result?.ok,workflowId:state.workflowId});
      if(!result?.ok||result?.status==='waiting_confirmation'||result?.confirmationRequired){ state.status=(result?.status==='waiting_confirmation'||result?.confirmationRequired)?'waiting_confirmation':'failed'; await this.persist(state); this.audit?.record('agent.orchestration_paused',{userId:user.sub,requestId,orchestrationId,role:roleId,status:state.status}); return {ok:!!result?.ok,orchestrationId,status:state.status,currentRole:roleId,workflowId:state.workflowId,outputs}; }
      await this.persist(state);
    }
    state.status='completed'; state.currentRole=null; state.workflowId=null; await this.persist(state); this.audit?.record('agent.orchestration_completed',{userId:user.sub,requestId,orchestrationId,roles:selected,steps:outputs.length}); return {ok:true,orchestrationId,status:'completed',outputs};
  }
}
module.exports={MultiAgentOrchestrator};
