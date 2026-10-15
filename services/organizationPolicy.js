'use strict';

// One policy for every organization surface. Callers must load ctx freshly inside
// the current server-side organization transaction; client role flags are never ctx.
const roles = Object.freeze(['owner', 'admin', 'manager', 'member', 'viewer', 'auditor', 'guest']);
const classifications = Object.freeze(['public', 'internal', 'confidential', 'restricted']);
const profiles = new Set(['micro', 'small', 'medium', 'large', 'security']);
const contributors = new Set(['owner', 'admin', 'manager', 'member']);
const resourceActions = new Set(['read', 'write', 'share', 'comment', 'export', 'ai', 'delete']);
const MAX_TEAM_DEPTH = 16;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\x00-\x1f\x7f]/.test(value);

class OrganizationPolicyError extends Error {
  constructor() {
    super('org_access_denied');
    this.name = 'OrganizationPolicyError';
    this.code = 'org_access_denied';
    this.status = 403;
  }
}
function error() { return new OrganizationPolicyError(); }
function list(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) && value.every(id) ? value : null;
}
function principalId(member) { return member?.userId || member?.id; }
function base(ctx) {
  if (!ctx || !id(ctx.userId)) return null;
  const organization = ctx.organization;
  let membership = ctx.membership;
  if (!organization || !id(organization.id) || organization.status !== 'active' || !profiles.has(organization.profile)) return null;
  if (!membership || membership.orgId !== organization.id || principalId(membership) !== ctx.userId) return null;
  // When a full fresh membership set is present, it is authoritative. A stale
  // membership version must not authorize requests after an access change.
  if (ctx.memberships !== undefined) {
    if (!Array.isArray(ctx.memberships)) return null;
    const matches = ctx.memberships.filter(item => item?.orgId === organization.id && principalId(item) === ctx.userId);
    if (matches.length !== 1 || matches[0].version !== membership.version) return null;
    membership = matches[0];
  }
  if (membership.status !== 'active' || !roles.includes(membership.role) || !classifications.includes(membership.clearance)) return null;
  const compartments = list(membership.compartments);
  if (!compartments) return null;
  const now = ctx.now === undefined ? Date.now() : ctx.now instanceof Date ? ctx.now.getTime() : typeof ctx.now === 'number' ? ctx.now : Date.parse(ctx.now);
  if (!Number.isFinite(now)) return null;
  if (membership.expiresAt !== undefined && membership.expiresAt !== null) {
    const expiresAt = Date.parse(membership.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  }
  if (membership.role === 'guest' && organization.policy?.allowExternalGuests !== true) return null;
  return { organization, membership, compartments, now };
}

function teamIndex(ctx, orgId) {
  const index = new Map();
  if (!Array.isArray(ctx.teams)) return index;
  for (const team of ctx.teams) {
    if (!team || team.orgId !== orgId || !id(team.id)) continue;
    if (index.has(team.id)) { index.set(team.id, null); continue; }
    index.set(team.id, team);
  }
  return index;
}
function lineage(teamId, index, orgId) {
  const path = [];
  const seen = new Set();
  let current = teamId;
  while (current) {
    if (seen.has(current) || path.length > MAX_TEAM_DEPTH) return null;
    seen.add(current);
    const team = index.get(current);
    if (!team || team.orgId !== orgId || (team.status !== undefined && team.status !== 'active')) return null;
    if (!list(team.memberIds) || !list(team.managerIds)) return null;
    path.push(current);
    if (team.parentId != null && team.parentId !== '' && !id(team.parentId)) return null;
    current = team.parentId || null;
  }
  return path;
}
function teamGrant(ctx, resource, orgId) {
  const index = teamIndex(ctx, orgId);
  const assigned = new Set((list(resource.teamIds) || []).filter(teamId => lineage(teamId, index, orgId)));
  if (!assigned.size) return false;
  for (const [teamId, team] of index) {
    if (!team || ![...(list(team.memberIds) || []), ...(list(team.managerIds) || [])].includes(ctx.userId)) continue;
    const path = lineage(teamId, index, orgId);
    if (!path) continue;
    if (assigned.has(teamId)) return true;
    // Explicit downward inheritance only: a resource shared with team A may be
    // read by descendants of A. Parent/sibling membership grants no access.
    if (resource.inheritTeamAccess === true && path.some(parentId => assigned.has(parentId))) return true;
  }
  return false;
}
function managesExactTeam(ctx, orgId) {
  const targetId = ctx.targetTeam?.id || ctx.targetTeamId;
  if (!id(targetId)) return false;
  const index = teamIndex(ctx, orgId);
  const target = index.get(targetId);
  return !!target && !!lineage(targetId, index, orgId) && (list(target.managerIds) || []).includes(ctx.userId);
}

function assertOrgAction(ctx, action) {
  const auth = base(ctx);
  if (!auth) throw error();
  const role = auth.membership.role;
  let allowed = false;
  switch (action) {
    case 'org.read':
    case 'access.request': allowed = true; break;
    case 'org.manage':
    case 'members.manage': allowed = role === 'owner' || role === 'admin'; break;
    case 'members.read': allowed = role !== 'guest'; break;
    case 'teams.manage': allowed = (!ctx.targetTeam || ctx.targetTeam.orgId === auth.organization.id) && (role === 'owner' || role === 'admin' || (role === 'manager' && managesExactTeam(ctx, auth.organization.id))); break;
    case 'audit.read': allowed = ['owner', 'admin', 'auditor'].includes(role); break;
    case 'resource.create':
    case 'access.approve': allowed = contributors.has(role); break;
    default: allowed = false;
  }
  // access.approve is only eligibility to enter the approval workflow. The
  // governance service must additionally authorize the exact resource/step.
  if (!allowed) throw error();
  return true;
}

function canAccessResource(ctx, resource, action = 'read') {
  if (!resourceActions.has(action)) return false;
  const auth = base(ctx);
  if (!auth || !resource || resource.orgId !== auth.organization.id || !id(resource.id) || !id(resource.ownerId)) return false;
  if (resource.status !== 'active' || !['document','task','decision'].includes(resource.kind) || !['private','team','organization'].includes(resource.visibility)) return false;
  const role = auth.membership.role;
  if (role === 'auditor') return false; // Audit/metadata access is a distinct surface, never content access.
  const level = classifications.indexOf(resource.classification);
  const clearance = classifications.indexOf(auth.membership.clearance);
  if (level < 0 || clearance < level) return false;
  // No verified assurance runtime exists in this pilot. Neither role, profile,
  // clearance nor a client-supplied assurance flag can unlock restricted data.
  if (resource.classification === 'restricted') return false;
  const compartments = list(resource.compartments);
  const readers = list(resource.readerIds);
  const editors = list(resource.editorIds);
  if (!compartments || !readers || !editors || !list(resource.teamIds)) return false;
  const held = new Set(auth.compartments);
  if (!compartments.every(compartment => held.has(compartment))) return false;
  const owns = resource.ownerId === ctx.userId;
  const direct = readers.includes(ctx.userId) || editors.includes(ctx.userId);
  let readable;
  if (role === 'guest') {
    readable = level <= classifications.indexOf('internal') && direct;
  } else {
    readable = owns || direct || resource.visibility === 'organization' || (resource.visibility === 'team' && teamGrant(ctx, resource, auth.organization.id));
  }
  if (!readable) return false;
  if (action === 'read') return true;
  if (role === 'guest') return false;
  if (action === 'export') return auth.organization.policy?.exportEnabled === true && resource.exportAllowed === true;
  if (!contributors.has(role)) return false;
  if (action === 'comment') return true;
  if (action === 'write') return owns || editors.includes(ctx.userId);
  if (action === 'delete') return owns;
  if (action === 'share') return owns || (['owner','admin'].includes(role) && editors.includes(ctx.userId));
  if (action === 'ai') {
    if (auth.organization.profile === 'security' || auth.organization.policy?.aiEnabled !== true || resource.aiAllowed !== true) return false;
    const configuredCeiling = classifications.indexOf(auth.organization.policy?.maxAiClassification || 'internal');
    // This pilot sends at most internal information to AI, even if a legacy or
    // malformed organization policy advertises a higher classification ceiling.
    const ceiling = Math.min(classifications.indexOf('internal'), configuredCeiling);
    return ceiling >= 0 && level <= ceiling;
  }
  return false;
}
function assertResourceAccess(ctx, resource, action = 'read') {
  if (!canAccessResource(ctx, resource, action)) throw error();
  return true;
}

module.exports = { roles, classifications, MAX_TEAM_DEPTH, OrganizationPolicyError, error, assertOrgAction, canAccessResource, assertResourceAccess };
