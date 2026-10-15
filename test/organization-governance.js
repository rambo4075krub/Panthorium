'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {OrganizationRepository}=require('../services/organizationRepository');
const {OrganizationService}=require('../services/organizationService');
const {OrganizationResourceService}=require('../services/organizationResourceService');
const {OrganizationGovernanceService,REQUEST_TTL_MS}=require('../services/organizationGovernanceService');
const {assertOrgAction,canAccessResource}=require('../services/organizationPolicy');
const user=id=>({id,sub:id});
async function fixture(classification='confidential'){
  const repository=new OrganizationRepository({allowMemory:true,required:false});await repository.init();
  const orgId=randomUUID();
  await repository.createOrganization({id:orgId,name:'Governance test',profile:'small',status:'active',policy:{allowExternalGuests:false}},
    {id:'org-owner',userId:'org-owner',orgId,role:'owner',status:'active',clearance:'confidential',compartments:['project-a']});
  const member=(id,role='member',clearance='confidential',compartments=['project-a'])=>({id,userId:id,orgId,role,status:'active',clearance,compartments,expiresAt:null});
  const resourceId=randomUUID();
  await repository.transact(orgId,async tx=>{
    for(const row of [member('document-owner'),member('requester'),member('other-requester'),member('blind-admin','admin'),member('outsider','member','internal',[])])await tx.put('membership',row.id,row);
    await tx.put('resource',resourceId,{id:resourceId,orgId,kind:'document',ownerId:'document-owner',title:'SECRET TITLE',body:'SECRET BODY',visibility:'private',readerIds:[],editorIds:classification==='internal'?[]:['org-owner'],teamIds:[],classification,compartments:classification==='internal'?[]:['project-a'],aiAllowed:false,exportAllowed:false,status:'active'});
  });
  const organizations=new OrganizationService({repository});
  let now=Date.now();const service=new OrganizationGovernanceService({organizations,clock:()=>now});
  const create=(actor='requester',access='read',target=resourceId)=>service.requestAccess(user(actor),orgId,{resourceId:target,access,reason:'Need this for my assigned task'});
  const readResource=()=>repository.read(orgId,tx=>tx.get('resource',resourceId));
  const mutateMember=(id,patch)=>repository.transact(orgId,async tx=>{const m=await tx.get('membership',id);return tx.put('membership',id,{...m,...patch},m.version);});
  return{repository,organizations,service,orgId,resourceId,create,readResource,mutateMember,advance:ms=>{now+=ms;}};
}
const timeout=setTimeout(()=>{console.error('Organization governance test timed out');process.exit(1);},15000);
(async()=>{
  {
    const f=await fixture();
    const real=(await f.create()).request, missing=(await f.create('requester','read',randomUUID())).request;
    assert.equal(real.status,'pending');assert.equal(missing.status,'pending');
    assert.deepEqual(Object.keys(real).sort(),Object.keys(missing).sort());
    for(const key of ['title','body','classification','resourceVersion','requiredApprovals','approvals','ownerId','requesterMembershipVersion','organizationPolicyVersion'])assert(!Object.hasOwn(real,key),`Own requests must not disclose ${key}`);
    const own=await f.service.listRequests(user('requester'),f.orgId);
    assert.equal(own.requests.length,2);assert(!JSON.stringify(own).includes('SECRET'));
    assert.equal((await f.service.listRequests(user('blind-admin'),f.orgId)).requests.length,0,'Org role alone must not discover private requests');
    await assert.rejects(()=>f.service.approveRequest(user('blind-admin'),f.orgId,real.id,{expectedVersion:1}),e=>e.code==='access_request_not_found');
    await assert.rejects(()=>f.service.approveRequest(user('requester'),f.orgId,real.id,{expectedVersion:1}),e=>e.code==='access_request_self_approval_forbidden');
    f.advance(REQUEST_TTL_MS+1);
    const expired=(await f.service.listRequests(user('requester'),f.orgId)).requests;
    assert(expired.every(x=>x.status==='expired'));
  }
  {
    const f=await fixture(); const request=(await f.create()).request;
    const before=await f.readResource();
    const first=await f.service.approveRequest(user('document-owner'),f.orgId,request.id,{expectedVersion:1});
    assert.equal(first.request.status,'pending');assert.equal(first.request.version,2);assert.equal((await f.readResource()).version,before.version);
    await assert.rejects(()=>f.service.approveRequest(user('document-owner'),f.orgId,request.id,{expectedVersion:2}),e=>e.code==='access_request_already_approved_by_actor');
    const approved=await f.service.approveRequest(user('org-owner'),f.orgId,request.id,{expectedVersion:2});
    assert.equal(approved.request.status,'approved');
    const after=await f.readResource();assert.equal(after.version,before.version+1);assert.deepEqual(after.readerIds,['requester']);assert(!after.editorIds.includes('requester'));
    const membership=await f.repository.read(f.orgId,tx=>tx.get('membership','requester'));
    assert.equal(membership.clearance,'confidential');assert.deepEqual(membership.compartments,['project-a']);assert.equal(membership.version,1);
    const revisions=await f.repository.read(f.orgId,tx=>tx.list('revision'));assert.equal(revisions.length,2);assert.deepEqual(revisions.map(item=>item.snapshot.version).sort((a,b)=>a-b),[before.version,after.version]);
    assert(revisions.every(x=>x.resourceSecurity && x.resourceSecurity.classification==='confidential'));
    const visibleHistory=await new OrganizationResourceService({organizations:f.organizations}).revisions({user:user('requester'),orgId:f.orgId,resourceId:f.resourceId});
    assert.equal(visibleHistory.length,1);assert.equal(visibleHistory[0].resourceVersion,after.version,'New reader sees only history allowed by its historical ACL');
    await f.organizations.withContext(user('requester'),f.orgId,{},async ctx=>assert(canAccessResource(ctx,after,'read')));
    await f.repository.transact(f.orgId,tx=>tx.put('resource',after.id,{...after,readerIds:[]},after.version));
    const revoked=await f.readResource();
    await f.organizations.withContext(user('requester'),f.orgId,{},async ctx=>assert(!canAccessResource(ctx,revoked,'read')));
  }
  {
    const f=await fixture('internal');const request=(await f.create('requester','write')).request;
    const done=await f.service.approveRequest(user('document-owner'),f.orgId,request.id,{expectedVersion:1});
    assert.equal(done.request.status,'approved');assert((await f.readResource()).editorIds.includes('requester'));
    const own=(await f.create('document-owner','write')).request;
    await assert.rejects(()=>f.service.approveRequest(user('document-owner'),f.orgId,own.id,{expectedVersion:1}),e=>e.code==='access_request_self_approval_forbidden');
  }
  for(const changed of ['resource','requester','organization','prior-approver']){
    const f=await fixture();const request=(await f.create()).request;
    let expectedVersion=1;
    if(changed==='prior-approver'){await f.service.approveRequest(user('document-owner'),f.orgId,request.id,{expectedVersion:1});expectedVersion=2;}
    if(changed==='resource')await f.repository.transact(f.orgId,async tx=>{const r=await tx.get('resource',f.resourceId);await tx.put('resource',r.id,{...r,title:'Changed after request'},r.version);});
    if(changed==='requester')await f.mutateMember('requester',{compartments:[]});
    if(changed==='organization')await f.repository.transact(f.orgId,async tx=>{const o=await tx.get('organization',f.orgId);await tx.put('organization',f.orgId,{...o,policy:{...o.policy,aiEnabled:true}},o.version);});
    if(changed==='prior-approver')await f.mutateMember('document-owner',{status:'suspended'});
    const actor=changed==='prior-approver'?'org-owner':'document-owner';
    await assert.rejects(()=>f.service.approveRequest(user(actor),f.orgId,request.id,{expectedVersion}),e=>e.status===409 && e.code.includes('context_changed'));
    assert(!(await f.readResource()).readerIds.includes('requester'));
    assert.equal((await f.service.listRequests(user('requester'),f.orgId)).requests[0].status,'rejected');
  }
  {
    const f=await fixture();const request=(await f.create('outsider')).request;
    await assert.rejects(()=>f.service.approveRequest(user('document-owner'),f.orgId,request.id,{expectedVersion:1}),e=>e.code==='access_request_requester_ineligible');
    assert(!(await f.readResource()).readerIds.includes('outsider'));
    const second=(await f.create()).request;f.advance(REQUEST_TTL_MS+1);
    await assert.rejects(()=>f.service.approveRequest(user('document-owner'),f.orgId,second.id,{expectedVersion:1}),e=>e.code==='access_request_expired');
    assert.equal((await f.service.listRequests(user('requester'),f.orgId)).requests[0].status,'expired');
  }
  {
    const f=await fixture();const request=(await f.create()).request;
    const approvals=await Promise.allSettled([
      f.service.approveRequest(user('document-owner'),f.orgId,request.id,{expectedVersion:1}),
      f.service.approveRequest(user('org-owner'),f.orgId,request.id,{expectedVersion:1})
    ]);
    assert.equal(approvals.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(approvals.find(x=>x.status==='rejected').reason.code,'access_request_version_conflict');
    assert(!(await f.readResource()).readerIds.includes('requester'));
    const winningActor=approvals[0].status==='fulfilled'?'document-owner':'org-owner';
    const losingActor=winningActor==='document-owner'?'org-owner':'document-owner';
    const done=await f.service.approveRequest(user(losingActor),f.orgId,request.id,{expectedVersion:2});
    assert.equal(done.request.status,'approved');
  }
  console.log('Organization governance: private discovery, owner/dual review, exact privilege, expiry, freshness, revocation and concurrent version checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(timeout));
