'use strict';

const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('crypto');

const SCOPES = ['panthorium:read', 'panthorium:media'];
const DEFAULT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const hash = value => createHash('sha256').update(value).digest('hex');
const random = prefix => prefix + randomBytes(32).toString('base64url');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

class OAuthError extends Error {
  constructor(code = 'invalid_request', status = 400, description = code) {
    super(description); this.name = 'OAuthError'; this.code = code; this.status = status;
  }
}
function fail(code = 'invalid_request', status = 400, description) { throw new OAuthError(code, status, description); }
function text(value, max = 2048, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail();
  return value;
}
function exactUrl(value) {
  text(value);
  let url; try { url = new URL(value); } catch { fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail();
  return url.href;
}
function same(left, right) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

class McpOAuthService {
  constructor({ repository, authService, baseUrl, allowedRedirectUris = [], now = () => Date.now() } = {}) {
    if (!repository || !authService) throw new Error('mcp_oauth_dependencies_required');
    const origin = exactUrl(baseUrl);
    const url = new URL(origin);
    if (url.pathname !== '/' || url.search) throw new Error('mcp_oauth_base_url_must_be_origin');
    this.baseUrl = url.origin;
    this.resource = `${this.baseUrl}/mcp`;
    this.repository = repository;
    this.authService = authService;
    this.now = now;
    this.allowedRedirectUris = new Set([DEFAULT_REDIRECT, ...allowedRedirectUris].map(uri => exactUrl(uri)));
    this.requestTtlMs = 10 * 60 * 1000;
    this.codeTtlMs = 2 * 60 * 1000;
    this.accessTtlMs = 60 * 60 * 1000;
    this.grantTtlMs = 30 * 86400000;
  }

  metadata() {
    return { issuer: this.baseUrl, authorization_endpoint: `${this.baseUrl}/oauth/authorize`, token_endpoint: `${this.baseUrl}/oauth/token`, registration_endpoint: `${this.baseUrl}/oauth/register`, revocation_endpoint: `${this.baseUrl}/oauth/revoke`, scopes_supported: [...SCOPES], response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true };
  }

  resourceMetadata() {
    return { resource: this.resource, authorization_servers: [this.baseUrl], scopes_supported: [...SCOPES], bearer_methods_supported: ['header'], resource_name: 'Panthorium' };
  }

  scopes(value, fallback = true) {
    if (value == null && fallback) return ['panthorium:read'];
    const scope = text(value, 120);
    const result = [...new Set(scope.split(' ').filter(Boolean))];
    if (!result.length || result.some(item => !SCOPES.includes(item))) fail('invalid_scope');
    return result.sort();
  }

  async registerClient(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
    if (body.token_endpoint_auth_method != null && body.token_endpoint_auth_method !== 'none') fail('invalid_client_metadata');
    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 8) fail('invalid_redirect_uri');
    const redirectUris = [...new Set(body.redirect_uris.map(uri => exactUrl(uri)))];
    if (redirectUris.some(uri => !this.allowedRedirectUris.has(uri))) fail('invalid_redirect_uri');
    if (body.grant_types != null && (!Array.isArray(body.grant_types) || !body.grant_types.includes('authorization_code') || body.grant_types.some(value => !['authorization_code', 'refresh_token'].includes(value)))) fail('invalid_client_metadata');
    if (body.response_types != null && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== 'code')) fail('invalid_client_metadata');
    const clientName = body.client_name == null ? 'ChatGPT' : text(body.client_name, 120);
    const client = { client_id: random('pt_client_'), client_name: clientName, redirect_uris: redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: Math.floor(this.now() / 1000) };
    await this.repository.put('client', client.client_id, client);
    return client;
  }

  async client(clientId) {
    const id = text(clientId, 200);
    const client = (await this.repository.get('client', id))?.data;
    if (!client) fail('invalid_client', 401);
    return client;
  }

  checkResource(resource, optional = false) {
    if (resource == null && optional) return this.resource;
    if (resource !== this.resource) fail('invalid_target');
    return this.resource;
  }

  async beginAuthorize(query = {}) {
    const client = await this.client(query.client_id);
    const redirectUri = text(query.redirect_uri);
    if (!client.redirect_uris.includes(redirectUri)) fail('invalid_redirect_uri');
    if (query.response_type !== 'code') fail('unsupported_response_type');
    if (query.code_challenge_method !== 'S256' || typeof query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge)) fail('invalid_request', 400, 'PKCE S256 is required.');
    const state = text(query.state, 2048, true);
    const resource = this.checkResource(query.resource, true);
    const scopes = this.scopes(query.scope);
    const requestId = random('pt_req_');
    const request = { requestId, clientId: client.client_id, clientName: client.client_name, redirectUri, challenge: query.code_challenge, state, resource, scopes, createdAt: this.now(), expiresAt: this.now() + this.requestTtlMs };
    await this.repository.put('request', requestId, request, request.expiresAt);
    return this.requestView(request);
  }

  requestView(request) {
    return { requestId: request.requestId, client: { client_id: request.clientId, client_name: request.clientName }, scopes: [...request.scopes], resource: request.resource, expiresAt: request.expiresAt };
  }

  async getAuthorizationRequest(requestId) {
    const row = await this.repository.get('request', text(requestId, 200));
    if (!row || row.consumedAt != null) fail('invalid_request', 400, 'Authorization request expired or already used.');
    return this.requestView(row.data);
  }

  async currentUser(principal, expectedVersion) {
    const id = principal?.sub || principal?.id;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || principal?.roles?.includes('guest')) fail('access_denied', 403);
    const raw = await this.authService.repository.findUserById(id);
    if (!raw || raw.disabled || raw.suspended || raw.roles?.includes('guest')) fail('access_denied', 403);
    const policy = this.authService.accountPolicy ? await this.authService.accountPolicy(id) : null;
    const version = Number(policy?.credentialVersion || 0);
    if ((expectedVersion != null && Number(expectedVersion) !== version) || (principal.accountVersion != null && Number(principal.accountVersion) !== version)) fail('invalid_grant', 401);
    let user = { sub: id, id, username: raw.email || raw.username, roles: raw.roles || [], permissions: raw.permissions || [], accountVersion: version };
    if (this.authService.validateAccountPrincipal) {
      try { user = await this.authService.validateAccountPrincipal(user); }
      catch (error) {
        if (['account_suspended', 'account_access_expired', 'account_day_restricted', 'account_not_found', 'account_session_revoked'].includes(error.message)) fail('access_denied', 403);
        throw error;
      }
    }
    if (user.roles?.includes('guest') || !(user.permissions || []).includes('chat')) fail('access_denied', 403);
    return user;
  }

  async approveAuthorization({ requestId, user, approved = true } = {}) {
    const row = await this.repository.get('request', text(requestId, 200));
    if (!row || row.consumedAt != null) fail('invalid_request');
    const principal = await this.currentUser(user);
    const request = row.data;
    const redirect = new URL(request.redirectUri);
    if (request.state) redirect.searchParams.set('state', request.state);
    redirect.searchParams.set('iss', this.baseUrl);
    if (approved !== true) {
      if (!await this.repository.consumeRequest(requestId)) fail('invalid_request');
      redirect.searchParams.set('error', 'access_denied');
      return { redirectUrl: redirect.href };
    }
    const rawCode = random('pt_code_');
    const code = { ...request, userId: principal.sub || principal.id, accountVersion: principal.accountVersion || 0, expiresAt: this.now() + this.codeTtlMs };
    if (!await this.repository.consumeRequest(requestId, hash(rawCode), code)) fail('invalid_request');
    redirect.searchParams.set('code', rawCode);
    return { redirectUrl: redirect.href };
  }

  issueTokens(grantExpiresAt = this.now() + this.grantTtlMs) {
    const accessRaw = random('pt_mcp_at_'); const refreshRaw = random('pt_mcp_rt_');
    return { accessRaw, refreshRaw, access: { hash: hash(accessRaw), expiresAt: Math.min(this.now() + this.accessTtlMs, grantExpiresAt) }, refresh: { hash: hash(refreshRaw) } };
  }

  tokenResponse(tokens, scopes) {
    return { access_token: tokens.accessRaw, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((tokens.access.expiresAt - this.now()) / 1000)), refresh_token: tokens.refreshRaw, scope: scopes.join(' ') };
  }

  async exchangeToken(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || own(body, 'client_secret')) fail('invalid_request');
    const client = await this.client(body.client_id);
    if (body.grant_type === 'authorization_code') {
      const rawCode = text(body.code, 200);
      const verifier = text(body.code_verifier, 128);
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail('invalid_grant');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const row = await this.repository.get('code', hash(rawCode));
      const code = row?.data;
      if (!code || row.consumedAt != null || code.clientId !== client.client_id || body.redirect_uri !== code.redirectUri || !same(challenge, code.challenge)) fail('invalid_grant');
      const resource = this.checkResource(body.resource, true);
      if (code.resource !== resource) fail('invalid_target');
      if (body.scope != null && this.scopes(body.scope).join(' ') !== code.scopes.join(' ')) fail('invalid_scope');
      await this.currentUser({ sub: code.userId }, code.accountVersion);
      const grant = { id: randomUUID(), userId: code.userId, clientId: client.client_id, clientName: client.client_name, resource, scopes: code.scopes, accountVersion: code.accountVersion, createdAt: this.now(), expiresAt: this.now() + this.grantTtlMs, revokedAt: null };
      const tokens = this.issueTokens(grant.expiresAt);
      if (!await this.repository.redeemCode(hash(rawCode), { clientId: client.client_id, redirectUri: body.redirect_uri, challenge, resource }, grant, tokens.access, tokens.refresh)) fail('invalid_grant');
      return this.tokenResponse(tokens, grant.scopes);
    }
    if (body.grant_type === 'refresh_token') {
      const raw = text(body.refresh_token, 200);
      const record = await this.repository.get('refresh', hash(raw));
      const grant = record && (await this.repository.get('grant', record.data.grantId))?.data;
      const resource = this.checkResource(body.resource, true);
      if (!grant || grant.revokedAt || grant.clientId !== client.client_id || grant.resource !== resource) fail('invalid_grant');
      if (body.scope != null && this.scopes(body.scope).join(' ') !== grant.scopes.join(' ')) fail('invalid_scope');
      await this.currentUser({ sub: grant.userId }, grant.accountVersion);
      const tokens = this.issueTokens(grant.expiresAt);
      const rotated = await this.repository.rotateRefresh(hash(raw), client.client_id, resource, tokens.access, tokens.refresh);
      if (!rotated) fail('invalid_grant');
      return this.tokenResponse(tokens, rotated.scopes);
    }
    fail('unsupported_grant_type');
  }

  async authenticate(rawToken) {
    if (typeof rawToken !== 'string' || !/^pt_mcp_at_[A-Za-z0-9_-]{43}$/.test(rawToken)) fail('invalid_token', 401);
    const token = await this.repository.get('access', hash(rawToken));
    const grant = token && (await this.repository.get('grant', token.data.grantId))?.data;
    if (!grant || grant.revokedAt || grant.resource !== this.resource) fail('invalid_token', 401);
    let user;
    try { user = await this.currentUser({ sub: grant.userId }, grant.accountVersion); }
    catch (error) { if (error instanceof OAuthError) fail('invalid_token', 401); throw error; }
    return { user, scopes: [...grant.scopes], clientId: grant.clientId, grantId: grant.id };
  }

  async revoke({ token, client_id: clientId } = {}) {
    const raw = text(token, 2048);
    const client = await this.client(clientId);
    const hashed = hash(raw);
    const record = await this.repository.get('refresh', hashed) || await this.repository.get('access', hashed);
    if (record) await this.repository.revokeGrant(record.data.grantId, { clientId: client.client_id });
  }

  async listGrants(user) {
    const principal = await this.currentUser(user);
    const grants = await this.repository.listGrants(principal.sub || principal.id);
    return grants.filter(grant => !grant.revokedAt).map(grant => ({ grantId: grant.id, clientName: grant.clientName, scopes: [...grant.scopes], createdAt: grant.createdAt, expiresAt: grant.expiresAt }));
  }

  async revokeGrant(user, grantId) {
    const principal = await this.currentUser(user);
    if (typeof grantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(grantId)) fail('invalid_request');
    const revoked = await this.repository.revokeGrant(grantId, { userId: principal.sub || principal.id });
    return { revoked };
  }
}

module.exports = { McpOAuthService, OAuthError, SCOPES, DEFAULT_REDIRECT };
