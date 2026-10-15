'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
function createOrganizationsRouter(authService, service) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireAuth(authService));
  router.use(rateLimit({ windowMs: 60000, limit: 90, standardHeaders: true, legacyHeaders: false }));
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ ok: false, error: 'org_cross_site_denied' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'org_json_required' });
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Buffer.byteLength(JSON.stringify(req.body)) > 80000) return res.status(413).json({ ok: false, error: 'org_invalid_body' });
    }
    next();
  });
  const safe = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      const known = /^org_[a-z0-9_]+$/.test(error.code || '');
      res.status(known ? error.status || 400 : 503).json({ ok: false, error: known ? error.code : 'org_unavailable' });
    }
  };
  router.get('/', safe(async (req, res) => res.json(await service.list(req.user))));
  router.post('/', safe(async (req, res) => res.status(201).json(await service.create(req.user, req.body))));
  router.post('/invitations/accept', safe(async (req, res) => res.json(await service.acceptInvitation(req.user, req.body))));
  router.get('/:orgId', safe(async (req, res) => res.json(await service.get(req.user, req.params.orgId))));
  router.patch('/:orgId', safe(async (req, res) => res.json(await service.update(req.user, req.params.orgId, req.body))));
  router.get('/:orgId/members', safe(async (req, res) => res.json(await service.listMembers(req.user, req.params.orgId))));
  router.patch('/:orgId/members/:userId', safe(async (req, res) => res.json(await service.updateMember(req.user, req.params.orgId, req.params.userId, req.body))));
  router.post('/:orgId/invitations', safe(async (req, res) => res.status(201).json(await service.invite(req.user, req.params.orgId, req.body))));
  router.get('/:orgId/teams', safe(async (req, res) => res.json(await service.listTeams(req.user, req.params.orgId))));
  router.post('/:orgId/teams', safe(async (req, res) => res.status(201).json(await service.createTeam(req.user, req.params.orgId, req.body))));
  router.patch('/:orgId/teams/:teamId', safe(async (req, res) => res.json(await service.updateTeam(req.user, req.params.orgId, req.params.teamId, req.body))));
  router.get('/:orgId/audit', safe(async (req, res) => res.json(await service.listAudit(req.user, req.params.orgId, { limit: req.query.limit, cursor: req.query.cursor }))));
  return router;
}
module.exports = { createOrganizationsRouter };
