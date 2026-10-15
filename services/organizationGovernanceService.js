'use strict';
const { randomUUID } = require('node:crypto');
const { assertOrgAction, assertResourceAccess } = require('./organizationPolicy');
const { validId } = require('./organizationRepository');
const { OrganizationResourceService, LIMITS:RESOURCE_LIMITS } = require('./organizationResourceService');
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const versionOf = item => Number.isSafeInteger(Number(item?.version)) ? Number(item.version) : 0;
const isSensitive = resource => ['confidential','restricted'].includes(resource?.classification);

class OrganizationGovernanceService {
  constructor({ organizations, clock = Date.now } = {}) {
    if (!organizations?.withContext) throw new Error('organization_service_required');
    this.organizations = organizations;
    this.resources = new OrganizationResourceService({organizations});
    this.clock = clock;
  }
  now() { return new Date(this.clock()).toISOString(); }
  resourceActive(resource) { return !!resource && resource.status === 'active'; }
  effectiveStatus(request) { return request.status === 'pending' && Date.parse(request.expiresAt) <= this.clock() ? 'expired' : request.status; }
  assertVersion(expectedVersion, request) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw failure('access_request_version_required');
    if (expectedVersion !== versionOf(request)) throw failure('access_request_version_conflict',409);
  }
  requesterContext(ctx, membership) { return { ...ctx, userId:membership?.userId, membership }; }
  approverEligible(ctx, resource, request) {
    if (!request || request.requesterId === ctx.userId || !this.resourceActive(resource)) return false;
    try { assertOrgAction(ctx,'access.approve'); assertResourceAccess(ctx,resource,'read'); assertResourceAccess(ctx,resource,'share'); }
    catch { return false; }
    if (resource.ownerId === ctx.userId) return true;
    return isSensitive(resource) && ['owner','admin'].includes(ctx.membership?.role) && Array.isArray(resource.editorIds) && resource.editorIds.includes(ctx.userId);
  }
  publicRequest(request, ctx, resource, { approver = false } = {}) {
    // A requester only sees their own supplied target ID and request state; even approval counts could disclose classification.
    const own = request.requesterId === ctx.userId;
    const status = this.effectiveStatus(request);
    const basic = { id:request.id, resourceId:request.resourceId, access:request.access, reason:request.reason,
      status, version:request.version, createdAt:request.createdAt, updatedAt:request.updatedAt,
      expiresAt:request.expiresAt, canApprove:false, canReject:false, selfApprovalForbidden:own,
      grantDuration:'until_revoked' };
    if (approver && !own) {
      const eligible = this.approverEligible(ctx,resource,request);
      const fresh = this.bindingCurrent(request,ctx,resource);
      return { ...basic,requesterId:request.requesterId,
        requiredApprovals:request.requiredApprovals,
        approvals:(request.approvals || []).map(item=>({memberId:item.memberId,at:item.at})),
        canApprove:eligible && status==='pending' && fresh && !(request.approvals || []).some(item=>item.memberId===ctx.userId),
        canReject:eligible && status==='pending',
        requiresNewRequest:status==='pending' && !fresh };
    }
    return basic;
  }
  bindingCurrent(request, ctx, resource) {
    const requester = (ctx.memberships || []).find(item=>item.userId===request.requesterId);
    return this.resourceActive(resource) && versionOf(resource)===request.resourceVersion &&
      versionOf(ctx.organization)===request.organizationPolicyVersion && !!requester &&
      versionOf(requester)===request.requesterMembershipVersion;
  }
  async requestAccess(user, orgId, input = {}) {
    if (!validId(input.resourceId)) throw failure('invalid_access_request_target');
    if (!['read','write'].includes(input.access)) throw failure('invalid_access_request_privilege');
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw failure('invalid_access_request_reason');
    return this.organizations.withContext(user,orgId,{write:true},async(ctx,tx)=>{
      assertOrgAction(ctx,'access.request');
      const existing = await tx.list('accessRequest');
      if (existing.filter(item=>item.requesterId===ctx.userId && item.createdAt >= new Date(this.clock()-REQUEST_TTL_MS).toISOString()).length >= 20) throw failure('access_request_rate_limit',429);
      const resource = await tx.get('resource',input.resourceId);
      const real = this.resourceActive(resource);
      const id=randomUUID(), createdAt=this.now();
      const request=await tx.put('accessRequest',id,{
        id,orgId,requesterId:ctx.userId,resourceId:input.resourceId,access:input.access,reason:input.reason.trim(),
        status:'pending',resourceVersion:real ? versionOf(resource) : null,
        requesterMembershipVersion:versionOf(ctx.membership),organizationPolicyVersion:versionOf(ctx.organization),
        requiredApprovals:real ? (isSensitive(resource) ? 2 : 1) : null,
        approvals:[],createdAt,expiresAt:new Date(this.clock()+REQUEST_TTL_MS).toISOString(),resolvedAt:null
      });
      await this.organizations.audit(tx,ctx,'access_request_submitted',{kind:'accessRequest',id},{action:input.access});
      return {ok:true,request:this.publicRequest(request,ctx,null)};
    });
  }
  async listRequests(user, orgId) {
    return this.organizations.withContext(user,orgId,{},async(ctx,tx)=>{
      assertOrgAction(ctx,'access.request');
      const requests=await tx.list('accessRequest'), visible=[];
      for(const request of requests){
        if(request.requesterId===ctx.userId){visible.push(this.publicRequest(request,ctx,null));continue;}
        const resource=await tx.get('resource',request.resourceId);
        if(this.approverEligible(ctx,resource,request)) visible.push(this.publicRequest(request,ctx,resource,{approver:true}));
      }
      return {ok:true,requests:visible.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))};
    });
  }
  async outcome(result) {
    if(result?.failure){const error=failure(result.failure,409);error.request=result.request;throw error;}
    return result;
  }
  async resolveInvalid(tx,ctx,request,resource,code,status='rejected') {
    const saved=await tx.put('accessRequest',request.id,{...request,status,resolvedAt:this.now(),resolutionCode:code},request.version);
    await this.organizations.audit(tx,ctx,'access_request_invalidated',{kind:'accessRequest',id:request.id},{reasonCode:code});
    return {failure:code,request:this.publicRequest(saved,ctx,resource,{approver:true})};
  }
  async approveRequest(user, orgId, requestId, { expectedVersion } = {}) {
    if (!validId(requestId)) throw failure('access_request_not_found',404);
    const result=await this.organizations.withContext(user,orgId,{write:true},async(ctx,tx)=>{
      const request=await tx.get('accessRequest',requestId);
      if(!request)throw failure('access_request_not_found',404);
      if(request.requesterId===ctx.userId)throw failure('access_request_self_approval_forbidden',403);
      const resource=await tx.get('resource',request.resourceId);
      if(!this.approverEligible(ctx,resource,request))throw failure('access_request_not_found',404);
      this.assertVersion(expectedVersion,request);
      if(request.status!=='pending')throw failure('access_request_not_pending',409);
      if(this.effectiveStatus(request)==='expired')return this.resolveInvalid(tx,ctx,request,resource,'access_request_expired','expired');
      if(!this.bindingCurrent(request,ctx,resource))return this.resolveInvalid(tx,ctx,request,resource,'access_request_context_changed');
      if((request.approvals || []).some(item=>item.memberId===ctx.userId))throw failure('access_request_already_approved_by_actor',409);
      const requester=await tx.get('membership',request.requesterId);
      const prospective={...resource,
        readerIds:request.access==='read' ? [...new Set([...(resource.readerIds || []),request.requesterId])] : [...(resource.readerIds || [])],
        editorIds:request.access==='write' ? [...new Set([...(resource.editorIds || []),request.requesterId])] : [...(resource.editorIds || [])]
      };
      if(prospective.readerIds.length>RESOURCE_LIMITS.aclEntries || prospective.editorIds.length>RESOURCE_LIMITS.aclEntries) return this.resolveInvalid(tx,ctx,request,resource,'access_request_acl_capacity_exceeded');
      const targetCtx=this.requesterContext(ctx,requester);
      // ACL review never changes role, clearance or compartment membership.
      try { assertOrgAction(targetCtx,'access.request'); assertResourceAccess(targetCtx,prospective,request.access); }
      catch { return this.resolveInvalid(tx,ctx,request,resource,'access_request_requester_ineligible'); }
      const approvals=[...(request.approvals || []),{memberId:ctx.userId,membershipVersion:versionOf(ctx.membership),at:this.now()}];
      for(const approval of approvals){
        const membership=await tx.get('membership',approval.memberId);
        const approverCtx=this.requesterContext(ctx,membership);
        if(!membership || versionOf(membership)!==approval.membershipVersion || !this.approverEligible(approverCtx,resource,request)) return this.resolveInvalid(tx,ctx,request,resource,'access_request_approval_context_changed');
      }
      const ownerApproved=approvals.some(item=>item.memberId===resource.ownerId);
      const secondApproved=approvals.some(item=>item.memberId!==resource.ownerId && item.memberId!==request.requesterId);
      const complete=ownerApproved && (request.requiredApprovals===1 || approvals.length>=2 && secondApproved);
      let savedResource=resource;
      if(complete){
        await this.resources.saveRevision(tx,ctx,resource);
        savedResource=await tx.put('resource',resource.id,prospective,resource.version);
        await this.resources.saveRevision(tx,ctx,savedResource);
        await this.organizations.audit(tx,ctx,'resource_access_granted',{kind:'resource',id:resource.id},{requestId:request.id,action:request.access,result:'until_revoked',resourceVersion:savedResource.version});
      }
      const saved=await tx.put('accessRequest',request.id,{...request,approvals,status:complete?'approved':'pending',resolvedAt:complete?this.now():null},request.version);
      await this.organizations.audit(tx,ctx,complete?'access_request_approved':'access_request_approval_recorded',{kind:'accessRequest',id:request.id},{approvalCount:approvals.length});
      return {ok:true,request:this.publicRequest(saved,ctx,savedResource,{approver:true})};
    });
    return this.outcome(result);
  }
  async rejectRequest(user, orgId, requestId, { expectedVersion } = {}) {
    if (!validId(requestId)) throw failure('access_request_not_found',404);
    const result=await this.organizations.withContext(user,orgId,{write:true},async(ctx,tx)=>{
      const request=await tx.get('accessRequest',requestId);
      if(!request)throw failure('access_request_not_found',404);
      if(request.requesterId===ctx.userId)throw failure('access_request_self_approval_forbidden',403);
      const resource=await tx.get('resource',request.resourceId);
      if(!this.approverEligible(ctx,resource,request))throw failure('access_request_not_found',404);
      this.assertVersion(expectedVersion,request);
      if(request.status!=='pending')throw failure('access_request_not_pending',409);
      if(this.effectiveStatus(request)==='expired')return this.resolveInvalid(tx,ctx,request,resource,'access_request_expired','expired');
      const saved=await tx.put('accessRequest',request.id,{...request,status:'rejected',resolvedAt:this.now(),resolutionCode:'reviewer_rejected'},request.version);
      await this.organizations.audit(tx,ctx,'access_request_rejected',{kind:'accessRequest',id:request.id},{});
      return {ok:true,request:this.publicRequest(saved,ctx,resource,{approver:true})};
    });
    return this.outcome(result);
  }
}
module.exports={OrganizationGovernanceService,REQUEST_TTL_MS};
