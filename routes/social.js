"use strict";
const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { account } = require("../services/socialService");
function createSocialRouter(auth, service) {
  const r = express.Router();
  r.use(requireAuth(auth), requirePermission("chat"), (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    try {
      account(req.user);
      next();
    } catch (e) {
      next(e);
    }
  });
  const reads = rateLimit({
    windowMs: 60000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const writes = rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const signals = rateLimit({
    windowMs: 60000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const route = (fn) => async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      next(e);
    }
  };
  r.get(
    "/profile",
    reads,
    route(async (req) => ({
      ok: true,
      profile: await service.profile(req.user),
      connect: await service.repo.get("connect:" + req.user.sub),
    })),
  );
  r.get(
    "/people",
    reads,
    route((req) => service.people({ user: req.user, query: req.query.query })),
  );
  r.get(
    "/collections/:kind",
    reads,
    route((req) =>
      service.collections({ user: req.user, kind: req.params.kind }),
    ),
  );
  r.get(
    "/inbox",
    reads,
    route((req) => service.inbox({ user: req.user })),
  );
  r.get(
    "/reports",
    reads,
    route((req) => service.reports({ user: req.user })),
  );
  r.get(
    "/rtc/:id",
    reads,
    route((req) => service.rtc({ user: req.user, recordId: req.params.id })),
  );
  r.get(
    "/feed/:module",
    reads,
    route((req) =>
      service.read({
        user: req.user,
        module: req.params.module,
        query: req.query.query,
        before: req.query.before,
      }),
    ),
  );
  r.get(
    "/records/:id",
    reads,
    route((req) =>
      service.read({
        user: req.user,
        recordId: req.params.id,
        before: req.query.before,
      }),
    ),
  );
  r.get("/records/:id/files/:fileId", reads, async (req, res, next) => {
    try {
      const file = await service.media({
        user: req.user,
        recordId: req.params.id,
        fileId: req.params.fileId,
        download: req.query.download === "1",
      });
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Content-Security-Policy", "sandbox; default-src 'none'");
      res.type(file.contentType);
      res.set(
        "Content-Disposition",
        "attachment; filename*=UTF-8''" +
          encodeURIComponent(file.name).replace(/'/g, "%27"),
      );
      res.send(file.body);
    } catch (e) {
      next(e);
    }
  });
  r.post(
    "/actions",
    (req, res, next) =>
      (req.body?.action === "signal" ? signals : writes)(req, res, next),
    route((req) =>
      service.write({
        user: req.user,
        action: req.body.action,
        input: req.body.input,
        requestId: req.get("Idempotency-Key"),
      }),
    ),
  );
  r.use((e, req, res, next) => {
    if (e.status || e.code?.startsWith("social_"))
      return res
        .status(e.status || 400)
        .json({ ok: false, error: e.code || e.message });
    next(e);
  });
  return r;
}
module.exports = { createSocialRouter };
