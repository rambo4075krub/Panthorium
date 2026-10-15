'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { requireAuth } = require('../middleware/auth');

// The OAuth login page uses the existing UI session. MCP calls accept only the
// separate, revocable OAuth tokens; an ordinary UI JWT is never forwarded here.
function createMcpRouter({ oauth, toolService, authService, config, audit }) {
  const router = express.Router();
  const uiAuth = requireAuth(authService);
  const origin = new URL(oauth.baseUrl).origin;
  const cookieName = 'pt_mcp_consent';
  const cookieOptions = { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/oauth', maxAge: 10 * 60 * 1000 };
  const limiter = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false });
  const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); };
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const sameOrigin = (req, res, next) => req.get('origin') === origin ? next() : res.status(403).json({ error: 'invalid_origin' });
  const page = (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.sendFile(path.join(__dirname, '..', 'mcp-connect.html'));
  };
  function flow(req) {
    try {
      const data = jwt.verify(req.cookies?.[cookieName] || '', config.jwtSecret, { algorithms: ['HS256'], audience: 'panthorium-mcp-consent', issuer: oauth.baseUrl });
      if (typeof data.requestId !== 'string' || typeof data.csrfToken !== 'string') throw new Error('invalid_flow');
      return data;
    } catch { throw Object.assign(new Error('Authorization request expired. Start connecting again.'), { code: 'invalid_request', status: 400 }); }
  }
  function challenge(res, invalid = false) {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${oauth.baseUrl}/.well-known/oauth-protected-resource/mcp"${invalid ? ', error="invalid_token"' : ''}`);
    return res.status(401).json({ error: invalid ? 'invalid_token' : 'authentication_required' });
  }
  const mcpAuth = asyncRoute(async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!match) return challenge(res);
    try {
      req.mcpIdentity = await oauth.authenticate(match[1]);
      req.user = req.mcpIdentity.user;
    } catch (error) {
      if (![400, 401, 403].includes(Number(error.status))) return res.status(503).json({ error: 'temporarily_unavailable' });
      return challenge(res, true);
    }
    next();
  });

  router.use(['/oauth', '/mcp', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'], noStore);
  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => res.json(oauth.resourceMetadata()));
  router.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(oauth.metadata()));
  router.post('/oauth/register', registrationLimiter, express.json({ limit: '16kb' }), asyncRoute(async (req, res) => res.status(201).json(await oauth.registerClient(req.body))));
  router.get('/oauth/authorize', limiter, asyncRoute(async (req, res) => {
    const request = await oauth.beginAuthorize(req.query);
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const cookie = jwt.sign({ requestId: request.requestId, csrfToken }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '10m', audience: 'panthorium-mcp-consent', issuer: oauth.baseUrl });
    res.cookie(cookieName, cookie, cookieOptions);
    page(req, res);
  }));
  router.get('/oauth/request', limiter, uiAuth, asyncRoute(async (req, res) => {
    const data = flow(req);
    const request = await oauth.getAuthorizationRequest(data.requestId);
    res.json({ ...request, requestId: data.requestId, csrfToken: data.csrfToken, user: { id: req.user.sub, username: req.user.username } });
  }));
  router.post('/oauth/authorize', limiter, sameOrigin, uiAuth, asyncRoute(async (req, res) => {
    const data = flow(req);
    const csrf = req.body?.csrfToken;
    if (typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(csrf) || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(data.csrfToken)) || req.body?.requestId !== data.requestId || typeof req.body?.approve !== 'boolean') return res.status(400).json({ error: 'invalid_request' });
    const result = await oauth.approveAuthorization({ requestId: data.requestId, user: req.user, approved: req.body.approve });
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.json(result);
  }));
  router.post('/oauth/token', limiter, express.urlencoded({ extended: false, limit: '16kb' }), asyncRoute(async (req, res) => res.json(await oauth.exchangeToken(req.body))));
  router.post('/oauth/revoke', limiter, express.urlencoded({ extended: false, limit: '16kb' }), asyncRoute(async (req, res) => { await oauth.revoke(req.body); res.status(200).json({}); }));
  router.get('/oauth/grants', limiter, uiAuth, asyncRoute(async (req, res) => res.json({ grants: await oauth.listGrants(req.user) })));
  router.delete('/oauth/grants/:grantId', limiter, sameOrigin, uiAuth, asyncRoute(async (req, res) => { await oauth.revokeGrant(req.user, req.params.grantId); res.json({ ok: true }); }));
  router.get(['/mcp/connect', '/mcp/approve'], page);
  router.get('/mcp-connect.js', noStore, (_req, res) => res.type('application/javascript').sendFile(path.join(__dirname, '..', 'mcp-connect.js')));

  // A fresh stateless transport per request is safe across Cloud Run workers.
  // Identity is captured for this one request, never shared by a global server.
  router.post('/mcp', limiter, mcpAuth, asyncRoute(async (req, res) => {
    const { user, scopes } = req.mcpIdentity;
    const server = new Server({ name: 'panthorium', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: 'Use only the connected account. Open returned Panthorium approval links for actions awaiting confirmation; never claim an action completed until its receipt says succeeded.' });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await toolService.listTools(user, { scopes }) }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const requestId = crypto.randomUUID();
      audit?.record('mcp.tool_call', { userId: user.sub, requestId, toolName: request.params.name, clientId: req.mcpIdentity.clientId });
      return toolService.callTool(user, request.params.name, request.params.arguments || {}, requestId, { scopes });
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }));
  router.all('/mcp', mcpAuth, (_req, res) => res.set('Allow', 'POST').status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'This stateless MCP endpoint supports POST.' }, id: null }));
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error.status) || 503;
    const safeCode = typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'temporarily_unavailable';
    res.status(status >= 400 && status < 600 ? status : 503).json({ error: safeCode });
  });
  return router;
}

module.exports = { createMcpRouter };
