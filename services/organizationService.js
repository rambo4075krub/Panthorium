'use strict';
const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('crypto');
const policy = require('./organizationPolicy');
const { PILOT_LIMITS, validId, failure } = require('./organizationRepository');
const PROFILES = Object.freeze(['micro', 'small', 'medium', 'large', 'security']);
const DEFAULT_POLICY = Object.freeze({ aiEnabled: false, exportEnabled: false, maxAiClassification: 'internal', allowExternalGuests: false });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw failure('org_invalid_input');
}
function text(value, max = 120) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value)) throw failure('org_invalid_input'); return value.trim(); }
function compartments(value = []) {
  if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(item) || !validId(item))) throw failure('org_invalid_compartments');
  return [...new Set(value)].sort();
}
function expiry(value, now, maxDays) {
  if (value == null || value === '') return null;
  const time = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(time) || time <= now || (maxDays && time > now + maxDays * 86400000)) throw failure('org_invalid_expiry');
  return new Date(time).toISOString();
}
function active(member, now) { return member?.status === 'active' && (!member.expiresAt || Date.parse(member.expiresAt) > now); }

class OrganizationService {
  constructor({ repository, authRepository, validatePrincipal, clock = Date.now } = {}) { this.repository = repository; this.authRepository = authRepository; this.validatePrincipal = validatePrincipal; this.clock = clock; }
  actor(user) {
    const id = user?.sub || user?.id;
    if (!validId(id) || user?.isGuest || user?.guest || user?.roles?.includes('guest') || id.startsWith('guest_')) throw failure('org_account_required', 403);
    return id;
  }
  async currentPrincipal(user) {
    const userId = this.actor(user);
    if (!this.validatePrincipal) return user;
    try {
      const current = await this.validatePrincipal(user);
      if (this.actor(current) !== userId) throw failure('org_account_access_denied', 403);
      return current;
    } catch (error) {
      if (error.status === 403 || error.status === 401 || /^account_(suspended|access_expired|day_restricted|not_found|session_revoked)$/.test(error.code || error.message || '')) throw failure('org_account_access_denied', 403);
      throw failure('org_identity_unavailable', 503);
    }
  }
  async account(user, verified = false) {
    const id = this.actor(await this.currentPrincipal(user));
    if (!this.authRepository?.findUserById) throw failure('org_identity_unavailable', 503);
    const account = await this.authRepository.findUserById(id);
    if (!account || account.id !== id) throw failure('org_account_required', 403);
    if (verified && (!account.email || !account.emailVerifiedAt)) throw failure('org_verified_email_required', 403);
    return account;
  }
  async withContext(user, orgId, { write = false } = {}, callback) {
    // Also runs after a long AI call, before the org lock, so account-wide
    // suspension can stop delivery without nested database-pool acquisition.
    const userId = this.actor(await this.currentPrincipal(user));
    return this.repository[write ? 'transact' : 'read'](orgId, async tx => {
      const organization = await tx.get('organization', orgId), membership = await tx.get('membership', userId);
      const now = this.clock();
      if (organization?.status !== 'active' || !active(membership, now) || membership.userId !== userId || membership.orgId !== orgId) throw failure('org_access_denied', 403);
      const ctx = { userId, organization, membership, memberships: await tx.list('membership'), teams: await tx.list('team'), now: new Date(now).toISOString() };
      policy.assertOrgAction(ctx, 'org.read');
      return callback(ctx, tx);
    });
  }
  capabilities(ctx) {
    const permitted = action => { try { policy.assertOrgAction(ctx, action); return true; } catch { return false; } };
    return { manageMembers: permitted('members.manage'), manageTeams: ['owner', 'admin'].includes(ctx.membership.role) && permitted('teams.manage'), managePolicy: permitted('org.manage'), viewAudit: permitted('audit.read'), createResource: permitted('resource.create') };
  }
  visibleMember(member, viewer) {
    const value = { ...member };
    if (!['owner', 'admin', 'manager'].includes(viewer.role)) delete value.email;
    return value;
  }
  response(ctx) { return { ok: true, organization: ctx.organization, membership: this.visibleMember(ctx.membership, ctx.membership), capabilities: this.capabilities(ctx) }; }
  async list(user) {
    const userId = this.actor(user);
    const entries = await this.repository.listOrganizationsForUser(userId);
    const organizations = [];
    for (const entry of entries) {
      try {
        const data = await this.get(user, entry.organization.id);
        organizations.push({ organization: data.organization, membership: data.membership, capabilities: data.capabilities });
      } catch (error) { if (!['org_access_denied', 'org_not_found', 'org_action_denied'].includes(error.code)) throw error; }
    }
    return { ok: true, organizations, readiness: this.repository.readiness(), profiles: PROFILES };
  }
  async create(user, input) {
    fields(input, ['name', 'profile', 'compartments']);
    const account = await this.account(user, true), now = this.clock();
    const profile = input.profile || 'micro'; if (!PROFILES.includes(profile)) throw failure('org_invalid_profile');
    const orgId = randomUUID(), labels = compartments(input.compartments);
    await this.repository.createOrganization({ id: orgId, name: text(input.name), profile, status: 'active', policy: { ...DEFAULT_POLICY }, compartmentCatalog: labels }, { id: account.id, userId: account.id, role: 'owner', status: 'active', clearance: 'confidential', compartments: labels, expiresAt: null, email: String(account.email).toLowerCase(), displayName: String(account.username || '').includes('@') ? '' : String(account.username || '').slice(0, 120), joinedAt: new Date(now).toISOString() });
    return this.get(user, orgId);
  }
  get(user, orgId) { return this.withContext(user, orgId, {}, async ctx => this.response(ctx)); }
  async update(user, orgId, input) {
    fields(input, ['name', 'policy', 'version']);
    if (!Number.isSafeInteger(input.version)) throw failure('org_version_required');
    return this.withContext(user, orgId, { write: true }, async (ctx, tx) => {
      policy.assertOrgAction(ctx, 'org.manage');
      const next = { ...ctx.organization };
      if (own(input, 'name')) next.name = text(input.name);
      if (own(input, 'policy')) {
        fields(input.policy, Object.keys(DEFAULT_POLICY));
        for (const key of ['aiEnabled', 'exportEnabled', 'allowExternalGuests']) if (own(input.policy, key) && typeof input.policy[key] !== 'boolean') throw failure('org_invalid_policy');
        if (own(input.policy, 'maxAiClassification') && !['public', 'internal'].includes(input.policy.maxAiClassification)) throw failure('org_invalid_policy');
        next.policy = { ...ctx.organization.policy, ...input.policy };
        if (next.profile === 'security' && next.policy.aiEnabled) throw failure('org_security_ai_unavailable', 403);
      }
      ctx.organization = await tx.put('organization', orgId, next, input.version);
      await this.audit(tx, ctx, 'organization.updated', { kind: 'organization', id: orgId }, { fields: Object.keys(input).filter(key => key !== 'version'), version: ctx.organization.version });
      return this.response(ctx);
    });
  }
  listMembers(user, orgId) { return this.withContext(user, orgId, {}, async ctx => { policy.assertOrgAction(ctx, 'members.read'); return { ok: true, members: ctx.memberships.map(member => this.visibleMember(member, ctx.membership)) }; }); }
  grant(ctx, value, existing) {
    if (!policy.roles.includes(value.role) || !policy.classifications.includes(value.clearance)) throw failure('org_invalid_membership');
    if (value.role === 'guest' && !ctx.organization.policy.allowExternalGuests) throw failure('org_guests_disabled', 403);
    if (ctx.membership.role !== 'owner' && (value.role === 'owner' || existing?.role === 'owner')) throw failure('org_owner_grant_denied', 403);
    if (policy.classifications.indexOf(value.clearance) > policy.classifications.indexOf(ctx.membership.clearance)) throw failure('org_clearance_grant_denied', 403);
    const actorLabels = ctx.membership.compartments || [], catalog = ctx.organization.compartmentCatalog || [];
    if (value.compartments.some(label => !actorLabels.includes(label) || !catalog.includes(label))) throw failure('org_compartment_grant_denied', 403);
  }
  async invite(user, orgId, input) {
    fields(input, ['email', 'role', 'clearance', 'compartments', 'expiresAt', 'memberExpiresAt']);
    const email = text(input.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('org_invalid_email');
    // Read account data before taking an organization connection (pool is bounded).
    const existingAccount = this.authRepository?.findUserByEmail ? await this.authRepository.findUserByEmail(email) : null;
    return this.withContext(user, orgId, { write: true }, async (ctx, tx) => {
      policy.assertOrgAction(ctx, 'members.manage');
      const now = this.clock();
      const grant = { role: input.role || 'member', clearance: input.clearance || 'internal', compartments: compartments(input.compartments) };
      this.grant(ctx, grant);
      if (existingAccount && ctx.memberships.some(member => member.userId === existingAccount.id)) throw failure('org_member_exists', 409);
      if (ctx.memberships.length >= PILOT_LIMITS.members) throw failure('org_members_limit', 409);
      const invitations = await tx.list('invitation');
      const pending = invitations.filter(invitation => invitation.status === 'pending' && Date.parse(invitation.expiresAt) > now);
      if (pending.some(invitation => invitation.email === email)) throw failure('org_invitation_exists', 409);
      if (pending.length >= PILOT_LIMITS.pendingInvitations) throw failure('org_invitations_limit', 409);
      const id = randomUUID(), token = `${orgId}.${id}.${randomBytes(32).toString('base64url')}`;
      const memberExpiresAt = expiry(input.memberExpiresAt, now, grant.role === 'guest' ? 90 : undefined) || (grant.role === 'guest' ? new Date(now + 30 * 86400000).toISOString() : null);
      const invitation = await tx.put('invitation', id, { email, ...grant, expectedUserId: existingAccount?.id || null, invitedBy: ctx.userId, status: 'pending', expiresAt: expiry(input.expiresAt, now, 7) || new Date(now + 7 * 86400000).toISOString(), memberExpiresAt, tokenHash: createHash('sha256').update(token).digest('hex') });
      await this.audit(tx, ctx, 'invitation.created', { kind: 'invitation', id }, { role: grant.role, clearance: grant.clearance });
      const { tokenHash, expectedUserId, ...safe } = invitation;
      return { ok: true, invitation: safe, token };
    });
  }
  async acceptInvitation(user, input) {
    fields(input, ['token']);
    const account = await this.account(user, true), token = input.token;
    if (typeof token !== 'string' || token.length > 350) throw failure('org_invalid_invitation');
    const parts = token.split('.');
    if (parts.length !== 3 || !validId(parts[0]) || !validId(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) throw failure('org_invalid_invitation');
    const [orgId, invitationId] = parts;
    return this.repository.transact(orgId, async tx => {
      const organization = await tx.get('organization', orgId), invitation = await tx.get('invitation', invitationId), now = this.clock();
      const hash = createHash('sha256').update(token).digest('hex');
      if (!invitation || typeof invitation.tokenHash !== 'string' || invitation.tokenHash.length !== hash.length || !timingSafeEqual(Buffer.from(hash), Buffer.from(invitation.tokenHash))) throw failure('org_invalid_invitation', 403);
      if (organization?.status !== 'active' || invitation.status !== 'pending' || !Number.isFinite(Date.parse(invitation.expiresAt)) || Date.parse(invitation.expiresAt) <= now) throw failure('org_invitation_unavailable', 409);
      if (String(account.email).toLowerCase() !== invitation.email || (invitation.expectedUserId && invitation.expectedUserId !== account.id)) throw failure('org_invitation_account_mismatch', 403);
      if (invitation.memberExpiresAt && (!Number.isFinite(Date.parse(invitation.memberExpiresAt)) || Date.parse(invitation.memberExpiresAt) <= now)) throw failure('org_invitation_unavailable', 409);
      const memberships = await tx.list('membership'), teams = await tx.list('team');
      if (memberships.some(member => member.userId === account.id)) throw failure('org_member_exists', 409);
      if (memberships.length >= PILOT_LIMITS.members) throw failure('org_members_limit', 409);
      const inviter = await tx.get('membership', invitation.invitedBy);
      const inviterCtx = { userId: invitation.invitedBy, organization, membership: inviter, memberships, teams, now: new Date(now).toISOString() };
      policy.assertOrgAction(inviterCtx, 'members.manage');
      this.grant(inviterCtx, invitation);
      const membership = await tx.put('membership', account.id, { userId: account.id, role: invitation.role, clearance: invitation.clearance, compartments: invitation.compartments, status: 'active', expiresAt: invitation.memberExpiresAt || null, email: invitation.email, displayName: String(account.username || '').includes('@') ? '' : String(account.username || '').slice(0, 120), joinedAt: new Date(now).toISOString() });
      await tx.put('invitation', invitationId, { ...invitation, status: 'accepted', acceptedBy: account.id, acceptedAt: new Date(now).toISOString() });
      const ctx = { userId: account.id, organization, membership, memberships: [...memberships, membership], teams, now: new Date(now).toISOString() };
      await this.audit(tx, ctx, 'invitation.accepted', { kind: 'invitation', id: invitationId }, { role: membership.role });
      return this.response(ctx);
    });
  }
  async updateMember(user, orgId, memberId, input) {
    fields(input, ['role', 'status', 'clearance', 'compartments', 'expiresAt', 'version']);
    if (!Number.isSafeInteger(input.version)) throw failure('org_version_required');
    return this.withContext(user, orgId, { write: true }, async (ctx, tx) => {
      policy.assertOrgAction(ctx, 'members.manage');
      const existing = await tx.get('membership', memberId); if (!existing) throw failure('org_member_not_found', 404);
      if (memberId === ctx.userId) throw failure('org_self_authority_change_denied', 403);
      const next = { ...existing, ...input };
      if (own(input, 'compartments')) next.compartments = compartments(input.compartments);
      if (own(input, 'expiresAt')) next.expiresAt = expiry(input.expiresAt, this.clock());
      if (!['active', 'suspended', 'revoked'].includes(next.status)) throw failure('org_invalid_membership');
      const denialOnly = Object.keys(input).every(key => ['status', 'version'].includes(key)) && ['suspended', 'revoked'].includes(next.status);
      if (denialOnly) {
        if (existing.role === 'owner' && ctx.membership.role !== 'owner') throw failure('org_owner_grant_denied', 403);
      } else this.grant(ctx, next, existing);
      if (existing.role === 'owner' && active(existing, this.clock()) && (next.role !== 'owner' || next.status !== 'active' || next.expiresAt) && !ctx.memberships.some(member => member.userId !== memberId && member.role === 'owner' && active(member, this.clock()) && !member.expiresAt)) throw failure('org_last_owner', 409);
      const membership = await tx.put('membership', memberId, next, input.version);
      await this.audit(tx, ctx, 'membership.updated', { kind: 'membership', id: memberId }, { fields: Object.keys(input).filter(key => key !== 'version'), role: membership.role, status: membership.status, version: membership.version });
      return { ok: true, membership: this.visibleMember(membership, ctx.membership) };
    });
  }
  listTeams(user, orgId) { return this.withContext(user, orgId, {}, async ctx => ({ ok: true, teams: ctx.teams.map(team => { let canManage = false; try { policy.assertOrgAction({ ...ctx, targetTeam: team }, 'teams.manage'); canManage = true; } catch {} return { ...team, canManage }; }) })); }
  teamValue(ctx, input, existing) {
    if (!['owner', 'admin'].includes(ctx.membership.role)) {
      if (!existing || ctx.membership.role !== 'manager') throw failure('org_team_management_denied', 403);
      if ((own(input, 'parentId') && input.parentId !== existing.parentId) || (own(input, 'managerIds') && (!Array.isArray(input.managerIds) || JSON.stringify([...input.managerIds].sort()) !== JSON.stringify([...existing.managerIds].sort())))) throw failure('org_team_management_denied', 403);
    }
    policy.assertOrgAction({ ...ctx, targetTeam: existing }, 'teams.manage');
    const value = { ...(existing || { parentId: null, memberIds: [], managerIds: [] }), ...input };
    value.name = text(value.name);
    if (value.parentId != null && (!validId(value.parentId) || !ctx.teams.some(team => team.id === value.parentId))) throw failure('org_invalid_parent');
    for (const key of ['memberIds', 'managerIds']) {
      if (!Array.isArray(value[key]) || value[key].length > PILOT_LIMITS.members || value[key].some(id => !validId(id) || !ctx.memberships.some(member => member.userId === id && active(member, this.clock())))) throw failure('org_invalid_team_members');
      value[key] = [...new Set(value[key])];
    }
    if (value.managerIds.some(id => !value.memberIds.includes(id))) throw failure('org_manager_not_member');
    const all = [...ctx.teams.filter(team => team.id !== value.id), value];
    for (const team of all) {
      const visited = new Set(); let cursor = team, depth = 0;
      while (cursor) {
        if (visited.has(cursor.id) || ++depth > 8) throw failure('org_team_hierarchy_invalid');
        visited.add(cursor.id); cursor = cursor.parentId ? all.find(item => item.id === cursor.parentId) : null;
      }
    }
    return value;
  }
  createTeam(user, orgId, input) {
    fields(input, ['name', 'parentId', 'memberIds', 'managerIds']);
    return this.withContext(user, orgId, { write: true }, async (ctx, tx) => {
      if (ctx.teams.length >= PILOT_LIMITS.teams) throw failure('org_teams_limit', 409);
      const id = randomUUID(), value = this.teamValue(ctx, { ...input, id });
      const team = await tx.put('team', id, value);
      await this.audit(tx, ctx, 'team.created', { kind: 'team', id }, { memberCount: team.memberIds.length, managerCount: team.managerIds.length });
      return { ok: true, team };
    });
  }
  updateTeam(user, orgId, teamId, input) {
    fields(input, ['name', 'parentId', 'memberIds', 'managerIds', 'version']);
    if (!Number.isSafeInteger(input.version)) throw failure('org_version_required');
    return this.withContext(user, orgId, { write: true }, async (ctx, tx) => {
      const existing = await tx.get('team', teamId); if (!existing) throw failure('org_team_not_found', 404);
      const team = await tx.put('team', teamId, this.teamValue(ctx, input, existing), input.version);
      await this.audit(tx, ctx, 'team.updated', { kind: 'team', id: teamId }, { fields: Object.keys(input).filter(key => key !== 'version'), version: team.version });
      return { ok: true, team };
    });
  }
  async audit(tx, ctx, event, target, details = {}) {
    if (typeof event !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(event) || !target || !validId(target.id)) throw failure('org_invalid_audit');
    const allowed = new Set(['profile', 'role', 'status', 'clearance', 'classification', 'action', 'reasonCode', 'version', 'resourceVersion', 'resourceId', 'requestId', 'invitationId', 'teamId', 'parentId', 'memberCount', 'managerCount', 'count', 'fields', 'policyKeys', 'approvalCount', 'decision', 'kind', 'revisionId', 'commentId', 'result', 'operation']);
    const metadata = {};
    for (const [key, value] of Object.entries(details || {})) {
      if (!allowed.has(key)) continue;
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) metadata[key] = value;
      else if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)) metadata[key] = value;
      else if (['fields', 'policyKeys'].includes(key) && Array.isArray(value)) metadata[key] = value.filter(item => typeof item === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(item)).slice(0, 20);
    }
    return tx.put('audit', randomUUID(), { actorId: ctx.userId, event, target: { kind: String(target.kind || '').replace(/[^A-Za-z]/g, '').slice(0, 40), id: target.id }, details: metadata, occurredAt: ctx.now });
  }
  listAudit(user, orgId, { limit = 100, cursor } = {}) {
    limit = Number(limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw failure('org_invalid_limit');
    let before;
    if (cursor) {
      if (typeof cursor !== 'string' || cursor.length > 400 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw failure('org_invalid_cursor');
      try { before = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw failure('org_invalid_cursor'); }
      if (!before || !validId(before.id) || typeof before.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(before.createdAt) || !Number.isFinite(Date.parse(before.createdAt))) throw failure('org_invalid_cursor');
    }
    return this.withContext(user, orgId, {}, async (ctx, tx) => {
      policy.assertOrgAction(ctx, 'audit.read');
      const rows = await tx.list('audit', { limit: limit + 1, before }), events = rows.slice(0, limit), last = events[events.length - 1];
      return { ok: true, events, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null };
    });
  }
}
module.exports = { OrganizationService, PROFILES, DEFAULT_POLICY };
