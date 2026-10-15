'use strict';
const assert = require('node:assert/strict');
const { roles, classifications, assertOrgAction, canAccessResource, assertResourceAccess, MAX_TEAM_DEPTH } = require('../services/organizationPolicy');
const now = '2026-10-15T10:00:00.000Z';
function context(role = 'member', patch = {}) {
  const organization = { id:'org-a',name:'A',profile:'small',status:'active',policy:{aiEnabled:true,exportEnabled:true,maxAiClassification:'internal',allowExternalGuests:true},version:3 };
  const membership = { id:'user-a',userId:'user-a',orgId:'org-a',role,status:'active',clearance:'confidential',compartments:['project-a','finance'],expiresAt:null,version:2 };
  const ctx = { userId:'user-a',organization,membership,teams:[],now,...patch };
  if (!Object.prototype.hasOwnProperty.call(patch,'memberships')) ctx.memberships = [ctx.membership];
  return ctx;
}
function resource(patch = {}) {
  return { id:'doc-a',orgId:'org-a',ownerId:'user-a',title:'Private',body:'Do not disclose',kind:'document',visibility:'private',teamIds:[],inheritTeamAccess:false,readerIds:[],editorIds:[],classification:'internal',compartments:[],aiAllowed:true,exportAllowed:true,version:1,status:'active',...patch };
}
const deny = fn => assert.throws(fn, error => error.code === 'org_access_denied' && error.status === 403);
function grant(ctx, res, action, expected) { assert.equal(canAccessResource(ctx,res,action),expected, `${ctx.membership.role} ${action}`); if (expected) assert.equal(assertResourceAccess(ctx,res,action),true); else deny(() => assertResourceAccess(ctx,res,action)); }

assert.deepEqual(roles,['owner','admin','manager','member','viewer','auditor','guest']);
assert.deepEqual(classifications,['public','internal','confidential','restricted']);
const matrix = {
  owner:   {read:true,write:true,share:true,comment:true,export:true,ai:true,delete:true},
  admin:   {read:true,write:true,share:true,comment:true,export:true,ai:true,delete:true},
  manager: {read:true,write:true,share:true,comment:true,export:true,ai:true,delete:true},
  member:  {read:true,write:true,share:true,comment:true,export:true,ai:true,delete:true},
  viewer:  {read:true,write:false,share:false,comment:false,export:true,ai:false,delete:false},
  auditor: {read:false,write:false,share:false,comment:false,export:false,ai:false,delete:false},
  guest:   {read:false,write:false,share:false,comment:false,export:false,ai:false,delete:false}
};
for (const role of roles) for (const [action,expected] of Object.entries(matrix[role])) grant(context(role),resource(),action,expected);
for (const role of roles) {
  const ctx = context(role);
  assert.equal(assertOrgAction(ctx,'org.read'),true);
  assert.equal(assertOrgAction(ctx,'access.request'),true);
  const organizationActions = {
    'org.manage':['owner','admin'], 'members.manage':['owner','admin'],
    'members.read':['owner','admin','manager','member','viewer','auditor'],
    'teams.manage':['owner','admin'], 'audit.read':['owner','admin','auditor'],
    'resource.create':['owner','admin','manager','member'], 'access.approve':['owner','admin','manager','member']
  };
  for (const [action,eligible] of Object.entries(organizationActions)) {
    if (eligible.includes(role)) assert.equal(assertOrgAction(ctx,action),true);
    else deny(() => assertOrgAction(ctx,action));
  }
}
deny(() => assertOrgAction(context(),'not-a-policy-action'));
grant(context(),resource(),'edit',false);

// Roles, platform administration and ownership never replace need-to-know.
const othersPrivate = resource({ownerId:'someone-else'});
for (const role of ['owner','admin','manager','auditor']) grant(context(role),othersPrivate,'read',false);
grant({...context('admin'),permissions:['*'],platformAdministrator:true},othersPrivate,'read',false);
const admin = context('admin');
grant(admin,resource({ownerId:'someone-else',readerIds:['user-a']}),'read',true);
grant(admin,resource({ownerId:'someone-else',readerIds:['user-a']}),'share',false);
grant(admin,resource({ownerId:'someone-else',editorIds:['user-a']}),'share',true);
grant(admin,resource({ownerId:'someone-else',editorIds:['user-a']}),'delete',false);
grant(context('manager'),resource({ownerId:'someone-else',editorIds:['user-a']}),'write',true);
grant(context('manager'),resource({ownerId:'someone-else',editorIds:['user-a']}),'share',false);
grant(context('member'),resource({ownerId:'someone-else',visibility:'organization'}),'read',true);
grant(context('member'),resource({ownerId:'someone-else',visibility:'organization'}),'comment',true);
grant(context('member'),resource({ownerId:'someone-else',visibility:'organization'}),'write',false);

for (const patch of [
  {orgId:'org-b'}, {status:'deleted'}, {classification:'invented'}, {compartments:['finance','unassigned']},
  {visibility:'anything'}, {kind:'unknown'}, {readerIds:'user-a'}, {teamIds:['']}
]) grant(context('owner'),resource(patch),'read',false);
const low = context('owner'); low.membership.clearance = 'internal';
grant(low,resource({classification:'confidential'}),'read',false);
grant(context(),resource({classification:'confidential',compartments:['finance','project-a']}),'read',true);
grant(context(),resource({classification:'confidential',compartments:['finance','other']}),'read',false);
for (const [field,value] of [['status','suspended'],['expiresAt',now],['expiresAt','invalid'],['orgId','org-b'],['userId','someone-else']]) {
  const ctx = context('owner'); ctx.membership[field] = value;
  grant(ctx,resource(),'read',false); deny(() => assertOrgAction(ctx,'org.manage'));
}
const inactive = context('owner'); inactive.organization.status = 'suspended'; grant(inactive,resource(),'read',false);
const stale = context('owner'); stale.memberships = [{...stale.membership,version:stale.membership.version+1}]; grant(stale,resource(),'read',false);
const changedRole = context('owner'); changedRole.memberships = [{...changedRole.membership,role:'viewer'}]; grant(changedRole,resource(),'write',false);
const noMember = context('owner',{memberships:[]}); grant(noMember,resource(),'read',false);

// Guest access requires explicit ACL plus organization opt-in; broad visibility
// and ownership alone do not create external access, even to public content.
const guest = context('guest');
grant(guest,resource({ownerId:'other',visibility:'organization',classification:'public'}),'read',false);
grant(guest,resource({ownerId:'other',readerIds:['user-a']}),'read',true);
grant(guest,resource({ownerId:'other',editorIds:['user-a']}),'write',false);
grant(guest,resource({ownerId:'other',readerIds:['user-a'],classification:'confidential'}),'read',false);
guest.organization.policy.allowExternalGuests = false;
grant(guest,resource({readerIds:['user-a']}),'read',false);
deny(() => assertOrgAction(guest,'org.read'));

// Team access goes down the tree only when the resource explicitly opts in.
const team = (id,parentId,memberIds=[],managerIds=[]) => ({id,orgId:'org-a',name:id,parentId,memberIds,managerIds,version:1});
const ctx = context('member',{teams:[team('root',null),team('child','root',['user-a']),team('sibling','root'),team('other-root',null)]});
const parentResource = resource({ownerId:'other',visibility:'team',teamIds:['root']});
grant(ctx,parentResource,'read',false);
grant(ctx,{...parentResource,inheritTeamAccess:true},'read',true);
grant(ctx,resource({ownerId:'other',visibility:'team',teamIds:['child']}),'read',true);
grant(ctx,resource({ownerId:'other',visibility:'team',teamIds:['sibling'],inheritTeamAccess:true}),'read',false);
grant(context('member',{teams:[team('root',null,['user-a']),team('child','root')]}),resource({ownerId:'other',visibility:'team',teamIds:['child'],inheritTeamAccess:true}),'read',false);
grant(context('member',{teams:[{...team('foreign',null,['user-a']),orgId:'org-b'}]}),resource({ownerId:'other',visibility:'team',teamIds:['foreign']}),'read',false);
grant(context('member',{teams:[team('a','b',['user-a']),team('b','a')]}),resource({ownerId:'other',visibility:'team',teamIds:['a'],inheritTeamAccess:true}),'read',false);
const depth = Array.from({length:MAX_TEAM_DEPTH+1},(_,i)=>team('t'+i,i ? 't'+(i-1) : null,i===MAX_TEAM_DEPTH ? ['user-a'] : []));
grant(context('member',{teams:depth}),resource({ownerId:'other',visibility:'team',teamIds:['t0'],inheritTeamAccess:true}),'read',true);
depth[MAX_TEAM_DEPTH].memberIds=[]; depth.push(team('too-deep','t'+MAX_TEAM_DEPTH,['user-a']));
grant(context('member',{teams:depth}),resource({ownerId:'other',visibility:'team',teamIds:['t0'],inheritTeamAccess:true}),'read',false);
const manager = context('manager',{teams:[team('managed',null,[],['user-a']),team('unmanaged',null)]});
manager.targetTeam = manager.teams[0]; assert.equal(assertOrgAction(manager,'teams.manage'),true);
manager.targetTeam = manager.teams[1]; deny(() => assertOrgAction(manager,'teams.manage'));
manager.targetTeam = {...manager.teams[1],managerIds:['user-a']}; deny(() => assertOrgAction(manager,'teams.manage'));

// AI/export are separate approvals and never grant content access by themselves.
grant(context(),othersPrivate,'ai',false);
grant(context(),othersPrivate,'export',false);
for (const flag of ['aiEnabled','exportEnabled']) {
  const disabled = context(); disabled.organization.policy[flag] = false;
  grant(disabled,resource(),flag==='aiEnabled' ? 'ai' : 'export',false);
}
grant(context(),resource({aiAllowed:false}),'ai',false);
grant(context(),resource({exportAllowed:false}),'export',false);
grant(context(),resource({classification:'confidential'}),'ai',false);
const aiConfidential = context(); aiConfidential.organization.policy.maxAiClassification='confidential';
grant(aiConfidential,resource({classification:'confidential'}),'ai',false);
const security = context('owner'); security.organization.profile='security'; security.organization.policy.maxAiClassification='restricted';
grant(security,resource(),'ai',false);
security.membership.clearance='restricted'; security.assurance={verified:true};
grant(security,resource({classification:'restricted'}),'read',false);
const noAssurance = context('owner'); noAssurance.membership.clearance='restricted';
grant(noAssurance,resource({classification:'restricted'}),'read',false);
console.log('Organization policy tests passed: role matrix, tenant, clearance+compartments, explicit ACL, hierarchy, guest, expiry, AI/export gates');
