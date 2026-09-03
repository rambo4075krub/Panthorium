const express = require("express");
const { requireAuth } = require("../middleware/auth");

function createSecurityRouter(authService, repository, audit, securityResponse) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const adminOnly = (req, res, next) => {
    if (!req.user?.roles?.includes("administrator")) return res.status(403).json({ ok: false, error: "forbidden" });
    next();
  };

  router.use(auth, adminOnly);

  router.get("/overview", async (req, res, next) => {
    try {
      const [sessions, auditSummary, alerts, blocks] = await Promise.all([
        repository.listActiveSessions(), audit.summary(), audit.securityAlerts(), securityResponse ? securityResponse.listBlocks() : []
      ]);
      res.json({
        ok: true,
        summary: {
          ...auditSummary,
          activeSessions: sessions.length,
          activeIpBlocks: blocks.length,
          persistence: repository.constructor.name.replace("AuthRepository", ""),
          riskStatus: alerts.status,
          alertCount: alerts.activeCount,
          acknowledgedAlertCount: alerts.acknowledgedCount
        },
        sessions,
        blocks,
        alerts: alerts.alerts
      });
    } catch (error) { next(error); }
  });

  router.get("/alerts", async (req, res, next) => {
    try { res.json({ ok: true, ...(await audit.securityAlerts()) }); }
    catch (error) { next(error); }
  });

  router.post("/alerts/:id/acknowledge", async (req, res, next) => {
    try {
      const current = await audit.securityAlerts();
      const alert = current.alerts.find((item) => item.id === req.params.id);
      if (!alert) return res.status(404).json({ ok: false, error: "alert_not_found" });
      const acknowledgement = await audit.acknowledgeAlert(req.params.id, req.user.sub, req.body?.ttlHours);
      audit.record("security.alert_action", { actorUserId: req.user.sub, alertId: req.params.id, alertCode: alert.code, action: "acknowledge", requestId: req.requestId, ip: req.ip || null, userAgent: req.headers["user-agent"] || null });
      res.json({ ok: true, acknowledgement });
    } catch (error) { next(error); }
  });

  router.delete("/alerts/:id/acknowledgement", async (req, res, next) => {
    try {
      const removed = await audit.clearAlertAcknowledgement(req.params.id, req.user.sub);
      if (!removed) return res.status(404).json({ ok: false, error: "acknowledgement_not_found" });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.get("/blocks", async (req, res, next) => {
    try { res.json({ ok: true, blocks: securityResponse ? await securityResponse.listBlocks() : [] }); }
    catch (error) { next(error); }
  });

  router.post("/blocks", async (req, res, next) => {
    try {
      if (!securityResponse) return res.status(503).json({ ok: false, error: "security_response_unavailable" });
      const block = await securityResponse.blockIp(req.body?.ip, {
        durationMinutes: req.body?.durationMinutes,
        reason: req.body?.reason || "Administrator block",
        source: "manual",
        actorUserId: req.user.sub
      });
      res.status(201).json({ ok: true, block });
    } catch (error) {
      if (error.message === "invalid_ip") return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  router.delete("/blocks/:ip", async (req, res, next) => {
    try {
      if (!securityResponse) return res.status(503).json({ ok: false, error: "security_response_unavailable" });
      const removed = await securityResponse.unblockIp(req.params.ip, req.user.sub);
      if (!removed) return res.status(404).json({ ok: false, error: "block_not_found" });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.get("/audit", async (req, res, next) => {
    try {
      const entries = await audit.listRecent({ limit: req.query.limit, event: req.query.event, q: req.query.q, userId: req.query.userId, status: req.query.status, from: req.query.from, to: req.query.to });
      res.json({ ok: true, entries });
    } catch (error) { next(error); }
  });

  router.get("/sessions", async (req, res, next) => {
    try { res.json({ ok: true, sessions: await repository.listActiveSessions() }); }
    catch (error) { next(error); }
  });

  router.delete("/sessions/:id", async (req, res, next) => {
    try {
      const revoked = await repository.revokeSession(req.params.id);
      audit.record("security.session_revoked", { actorUserId: req.user.sub, sessionId: req.params.id, requestId: req.requestId, ip: req.ip || null, userAgent: req.headers["user-agent"] || null });
      if (!revoked) return res.status(404).json({ ok: false, error: "session_not_found" });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.delete("/users/:id/sessions", async (req, res, next) => {
    try {
      const count = await repository.revokeUserSessions(req.params.id);
      audit.record("security.user_sessions_revoked", { actorUserId: req.user.sub, targetUserId: req.params.id, count, requestId: req.requestId, ip: req.ip || null, userAgent: req.headers["user-agent"] || null });
      res.json({ ok: true, revoked: count });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createSecurityRouter };
