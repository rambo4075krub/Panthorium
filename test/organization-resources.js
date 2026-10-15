'use strict';
const assert=require('node:assert/strict');
const {OrganizationRepository}=require('../services/organizationRepository');
const {OrganizationService}=require('../services/organizationService');
const {OrganizationResourceService,LIMITS}=require('../services/organizationResourceService');
const user=id=>({sub:id,permissions:['chat']});
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);
async function fixture({complete,policy={},profile='small'}={}){
  const repository=new OrganizationRepository({allowMemory:true,required:false});await repository.init();
  const createOrg=(id,owner)=>repository.createOrganization({id,name:id,profile,status:'active',policy:{aiEnabled:false,exportEnabled:false,maxAiClassification:'internal',allowExternalGuests:false,...policy},compartmentCatalog:['finance']},{id:owner,userId:owner,role:'owner',status:'active',clearance:'confidential',compartments:['finance'],expiresAt:null});
  await createOrg('org-a','alice');await createOrg('org-b','foreign');
  await repository.transact('org-a',async tx=>{
    for(const [id,role,clearance,compartments]of[['bob','member','internal',[]],['carol','admin','confidential',['finance']],['viewer','viewer','internal',[]]])await tx.put('membership',id,{userId:id,role,status:'active',clearance,compartments,expiresAt:null});
    await tx.put('team','team-a',{name:'A',parentId:null,memberIds:['bob'],managerIds:[]});
  });
  await repository.transact('org-b',tx=>tx.put('team','team-b',{name:'B',parentId:null,memberIds:['foreign'],managerIds:[]}));
  const organizations=new OrganizationService({repository});const resources=new OrganizationResourceService({organizations,complete});
  const create=(input={},who='alice')=>resources.create({user:user(who),orgId:'org-a',input:{kind:'document',title:'Resource',body:'Document body',...input}});
  const args=(resource,who='alice')=>({user:user(who),orgId:'org-a',resourceId:resource.id});
  const edit=(resource,patch={},who='alice')=>resources.update({...args(resource,who),patch:{expectedVersion:resource.version,...patch}});
  const mutate=(kind,id,patch)=>repository.transact('org-a',async tx=>{const current=await tx.get(kind,id);return tx.put(kind,id,{...current,...patch},current.version);});
  return {repository,organizations,resources,create,args,edit,mutate};
}
async function main(){
  {
    const f=await fixture();const secret=await f.create({title:'Private marker',body:'body-only-marker'});
    assert.equal(secret.ownerId,'alice');assert.equal(secret.version,1);assert.equal(secret.capabilities.share,true);
    for(const who of ['bob','carol']){
      await rejects(f.resources.get(f.args(secret,who)),'org_resource_not_found');
      for(const method of ['revisions','comments','export'])await rejects(f.resources[method](f.args(secret,who)),'org_resource_not_found');
      assert.deepEqual(await f.resources.list({user:user(who),orgId:'org-a',q:'Private'}),[]);
    }
    await rejects(f.resources.get({...f.args(secret,'foreign'),orgId:'org-b'}),'org_resource_not_found');
    await rejects(f.resources.get(f.args(secret,'foreign')),'org_access_denied');
    const visible=await f.create({title:'Team briefing',body:'body-only-marker',visibility:'organization'});
    const listed=await f.resources.list({user:user('bob'),orgId:'org-a',q:'briefing'});
    assert.equal(listed.length,1);assert.equal(listed[0].id,visible.id);assert.equal('body'in listed[0],false);assert.equal('readerIds'in listed[0],false);
    assert.equal((await f.resources.list({user:user('bob'),orgId:'org-a',q:'body-only-marker'})).length,0);
    assert.equal((await f.resources.get(f.args(visible,'bob'))).capabilities.write,false);
    await rejects(f.resources.update({...f.args(visible,'bob'),patch:{expectedVersion:1,title:'Steal'}}),'org_access_denied');
    const payload={kind:'document',title:'Unsafe',ownerId:'bob'};await rejects(f.resources.create({user:user('alice'),orgId:'org-a',input:payload}),'org_unrecognized_field');
    await rejects(f.edit(secret,{ownerId:'bob'}),'org_unrecognized_field');
    await rejects(f.edit(secret,{classification:'restricted'}),'org_restricted_assurance_required');
    await rejects(f.create({readerIds:['foreign']}),'org_recipient_not_active_member');
    await rejects(f.create({visibility:'team',teamIds:['team-b']}),'org_team_not_available');
    await rejects(f.create({visibility:'team',teamIds:[]}),'org_team_visibility_requires_team');
    await rejects(f.create({classification:'confidential'},'bob'),'org_access_denied');
    await f.mutate('membership','bob',{status:'suspended'});await rejects(f.create({readerIds:['bob']}),'org_recipient_not_active_member');
  }
  {
    const f=await fixture();let doc=await f.create({editorIds:['bob']});
    const viewed=await f.resources.get(f.args(doc,'bob'));assert.equal(viewed.capabilities.write,true);assert.equal(viewed.capabilities.share,false);assert.equal('editorIds'in viewed,false);
    await rejects(f.edit(doc,{readerIds:['carol']},'bob'),'org_access_denied');
    const changes=await Promise.allSettled([f.edit(doc,{body:'One'},'bob'),f.edit(doc,{body:'Two'},'bob')]);
    assert.equal(changes.filter(x=>x.status==='fulfilled').length,1);assert.equal(changes.find(x=>x.status==='rejected').reason.code,'org_resource_version_conflict');
    doc=changes.find(x=>x.status==='fulfilled').value;
    await rejects(f.edit(doc,{expectedVersion:1,title:'Old'}),'org_resource_version_conflict');
    await rejects(f.resources.update({...f.args(doc),patch:{title:'Missing version'}}),'org_expected_version_required');
    await rejects(f.resources.remove({...f.args(doc,'bob'),expectedVersion:doc.version}),'org_access_denied');
    await f.resources.remove({...f.args(doc),expectedVersion:doc.version});await rejects(f.resources.get(f.args(doc)),'org_resource_not_found');
  }
  {
    const f=await fixture();let doc=await f.create({title:'Old confidential',body:'Secret old body',classification:'confidential',compartments:['finance'],visibility:'organization'});
    await f.resources.addComment({...f.args(doc),input:{body:'Secret old comment',expectedVersion:doc.version}});
    doc=await f.edit(doc,{title:'New public briefing',body:'Safe replacement',classification:'internal',compartments:[]});
    assert.deepEqual((await f.resources.revisions(f.args(doc,'bob'))).map(r=>r.body),['Safe replacement']);
    assert.deepEqual(await f.resources.comments(f.args(doc,'bob')),[]);
    assert.equal((await f.resources.revisions(f.args(doc))).length,2);
    let acl=await f.create({body:'Private before grant'});
    await f.resources.addComment({...f.args(acl),input:{body:'Before grant',expectedVersion:acl.version}});
    acl=await f.edit(acl,{readerIds:['bob'],body:'After grant'});
    assert.deepEqual((await f.resources.revisions(f.args(acl,'bob'))).map(r=>r.body),['After grant']);
    assert.deepEqual(await f.resources.comments(f.args(acl,'bob')),[]);
    await f.repository.transact('org-a',async tx=>{await tx.put('comment','legacy-comment',{resourceId:acl.id,body:'Legacy secret',authorId:'alice'});await tx.put('revision','legacy-revision',{resourceId:acl.id,resourceVersion:0,snapshot:{title:'Legacy',body:'Legacy secret'}});});
    assert.equal((await f.resources.comments(f.args(acl))).some(r=>r.body==='Legacy secret'),false);
    assert.equal((await f.resources.revisions(f.args(acl))).some(r=>r.body==='Legacy secret'),false);
    acl=await f.edit(acl,{readerIds:[]});for(const method of ['get','comments','revisions'])await rejects(f.resources[method](f.args(acl,'bob')),'org_resource_not_found');
    const audit=await f.repository.read('org-a',tx=>tx.list('audit'));const auditText=JSON.stringify(audit);assert.equal(auditText.includes('Secret old'),false);assert.equal(auditText.includes('Private before'),false);
  }
  {
    const f=await fixture();await rejects(f.create({kind:'task',assigneeIds:['bob']}),'org_assignee_requires_resource_access');
    let task=await f.create({kind:'task',visibility:'team',teamIds:['team-a'],assigneeIds:['bob'],dueAt:'2026-12-01T09:00:00Z'});
    assert.equal(task.taskStatus,'todo');assert.deepEqual(task.assigneeIds,['bob']);assert.equal(task.dueAt,'2026-12-01T09:00:00.000Z');
    task=await f.edit(task,{taskStatus:'blocked'});assert.equal(task.taskStatus,'blocked');
    await rejects(f.edit(task,{dueAt:'invalid'}),'org_invalid_due_at');await rejects(f.create({taskStatus:'done'}),'org_task_fields_require_task');
    const decision=await f.create({kind:'decision',decisionStatus:'proposed'});assert.equal(decision.decisionStatus,'proposed');
    await rejects(f.create({kind:'task',classification:'confidential',visibility:'organization',assigneeIds:['bob']}),'org_assignee_requires_resource_access');
    const doc=await f.create({exportAllowed:true});await rejects(f.resources.export(f.args(doc)),'org_access_denied');
    await f.mutate('organization','org-a',{policy:{aiEnabled:false,exportEnabled:true,maxAiClassification:'internal',allowExternalGuests:false}});
    const exported=await f.resources.export(f.args(doc));assert.equal(exported.resource.body,'Document body');assert.equal(exported.kind,'panthorium_organization_resource');
    const denied=await f.create();await rejects(f.resources.export(f.args(denied)),'org_access_denied');
    await rejects(f.resources.list({user:user('alice'),orgId:'org-a',q:'a'.repeat(201)}),'org_invalid_search');
    await rejects(f.create({body:'x'.repeat(LIMITS.bodyChars+1)}),'org_invalid_resource_body');
  }
  {
    let calls=0;const complete=async request=>{calls++;assert.equal(request.maxOutputTokens,1024);assert.equal(request.timeoutMs,30000);assert.deepEqual(request.tools,[]);assert.equal(request.messages.length,1);assert.equal(request.messages[0].content.includes('other private document'),false);return {text:JSON.stringify({draft:'Scoped summary',sourceIds:[],unknowns:[],nextActions:[]})};};
    const f=await fixture({complete});const disabled=await f.create({aiAllowed:true});await rejects(f.resources.summarize({...f.args(disabled),expectedVersion:1}),'org_access_denied');assert.equal(calls,0);
    await f.mutate('organization','org-a',{policy:{aiEnabled:true,exportEnabled:false,maxAiClassification:'internal',allowExternalGuests:false}});
    const noflag=await f.create();await rejects(f.resources.summarize({...f.args(noflag),expectedVersion:1}),'org_access_denied');
    const classified=await f.create({classification:'confidential',aiAllowed:true});await rejects(f.resources.summarize({...f.args(classified),expectedVersion:1}),'org_access_denied');
    await f.create({body:'other private document'});const result=await f.resources.summarize({...f.args(disabled),expectedVersion:1});assert.equal(result.text,'Scoped summary');assert.equal(result.requiresReview,true);assert.deepEqual(result.externalActionsExecuted,[]);assert.equal(calls,1);
    const stored=await f.repository.read('org-a',async tx=>({runs:await tx.list('resourceAiRun'),audit:await tx.list('audit'),resource:await tx.get('resource',disabled.id)}));
    assert.equal(stored.resource.body,'Document body');assert.equal(JSON.stringify(stored).includes('Scoped summary'),false);assert.equal(stored.runs[0].status,'completed');
    await f.mutate('organization','org-a',{profile:'security'});await rejects(f.resources.summarize({...f.args(disabled),expectedVersion:1}),'org_access_denied');assert.equal(calls,1);
    const absent=await fixture({policy:{aiEnabled:true}});const r=await absent.create({aiAllowed:true});assert.equal(r.capabilities.ai,false);assert.equal(r.aiUnavailableReason,'provider_unavailable');assert.equal((await absent.resources.get(absent.args(r))).capabilities.ai,false);await rejects(absent.resources.summarize({...absent.args(r),expectedVersion:1}),'org_ai_unavailable');
  }
  {
    const f=await fixture();let doc=await f.create({readerIds:['bob']});
    for(let i=0;i<105;i++)doc=await f.edit(doc,{body:'Revision '+i});
    doc=await f.edit(doc,{readerIds:[]});
    await rejects(f.resources.get(f.args(doc,'bob')),'org_resource_not_found');
    const history=await f.resources.revisions(f.args(doc));assert.equal(history.length,LIMITS.revisionDisplayCount);assert.equal(history[0].resourceVersion,doc.version);
  }
  // Provider results cannot cross a revocation, policy change or version edit.
  for(const change of ['member','policy','resource']){
    let release,started;const entered=new Promise(resolve=>{started=resolve;});
    const f=await fixture({policy:{aiEnabled:true},complete:async()=>{started();return new Promise(resolve=>{release=()=>resolve({text:'{"draft":"Must be suppressed"}'});});}});
    const doc=await f.create({aiAllowed:true,editorIds:['bob']});const pending=f.resources.summarize({...f.args(doc,'bob'),expectedVersion:1});await entered;
    if(change==='member')await f.mutate('membership','bob',{status:'revoked'});
    if(change==='policy')await f.mutate('organization','org-a',{policy:{aiEnabled:false,exportEnabled:false,maxAiClassification:'internal',allowExternalGuests:false}});
    if(change==='resource')await f.edit(doc,{body:'Changed while running'});
    release();await rejects(pending,change==='resource'?'org_resource_version_conflict':'org_access_denied');
    const runs=await f.repository.read('org-a',tx=>tx.list('resourceAiRun'));assert.equal(runs.some(run=>run.status==='completed'),false);
  }
  {
    const f=await fixture({policy:{aiEnabled:true},complete:async()=>({text:'{"draft":"Forged"}',functionCalls:[{name:'send_mail'}]})});
    const doc=await f.create({aiAllowed:true});await rejects(f.resources.summarize({...f.args(doc),expectedVersion:1}),'org_ai_unexpected_tool_call');
    f.resources.complete=async()=>({text:'not-json'});await rejects(f.resources.summarize({...f.args(doc),expectedVersion:1}),'org_ai_invalid_output');
    f.resources.complete=async()=>({text:'{"draft":"Valid third response"}'});await f.resources.summarize({...f.args(doc),expectedVersion:1});
    await rejects(f.resources.summarize({...f.args(doc),expectedVersion:1}),'org_ai_rate_limit');
  }
  {
    let calls=0;const f=await fixture({policy:{aiEnabled:true},complete:async()=>{calls++;return {text:'{"draft":"Unused"}'};}});
    const oversized=await f.create({aiAllowed:true,body:'ก'.repeat(4500)});
    await rejects(f.resources.summarize({...f.args(oversized),expectedVersion:1}),'org_ai_input_too_large');assert.equal(calls,0);
    const doc=await f.create({aiAllowed:true});
    await f.repository.transact('org-a',async tx=>{for(let i=0;i<LIMITS.aiDaily;i++)await tx.put('resourceAiRun','previous-'+i,{resourceId:doc.id,resourceVersion:1,userId:'other-member',status:'completed',expiresAt:new Date().toISOString()});});
    await rejects(f.resources.summarize({...f.args(doc),expectedVersion:1}),'org_ai_rate_limit');assert.equal(calls,0);
  }
  {
    let release1,release2,entered=0;let ready;const started=new Promise(resolve=>{ready=resolve;});
    const f=await fixture({policy:{aiEnabled:true},complete:async()=>new Promise(resolve=>{const release=()=>resolve({text:'{"draft":"Concurrent result"}'});if(++entered===1)release1=release;else{release2=release;ready();}})});
    const doc=await f.create({aiAllowed:true});const p1=f.resources.summarize({...f.args(doc),expectedVersion:1}),p2=f.resources.summarize({...f.args(doc),expectedVersion:1});await started;
    await rejects(f.resources.summarize({...f.args(doc),expectedVersion:1}),'org_ai_concurrency_limit');release1();release2();await Promise.all([p1,p2]);
  }
  console.log('Organization resources passed: real policy/repository, tenant and metadata isolation, versions, historical security, task recipients, export gates, scoped AI and revocation, bounds');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture};
