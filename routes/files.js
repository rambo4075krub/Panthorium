const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { CloudFilesError, MAX_FILE_BYTES } = require("../services/cloudFilesService");

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createFilesRouter(authService, files) {
  const router = express.Router();
  const auth = requireAuth(authService);
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const rawUpload = express.raw({ type: "application/octet-stream", limit: MAX_FILE_BYTES });

  function requireAccount(req, res, next) {
    const user = req.user || {};
    const id = String(user.sub || "");
    if (!USER_ID_RE.test(id) || (Array.isArray(user.roles) && user.roles.includes("guest"))) {
      return res.status(403).json({ ok: false, error: "account_required" });
    }
    next();
  }

  router.get("/", auth, requireAccount, limiter, async (req, res, next) => {
    try {
      const result = await files.list(req.user.sub);
      res.set("Cache-Control", "private, no-store");
      res.json({ ok: true, ...result });
    } catch (error) { next(error); }
  });

  router.post("/", auth, requireAccount, limiter, rawUpload, async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ ok: false, error: "file_body_required" });
      let filename = "";
      try { filename = decodeURIComponent(req.get("x-file-name") || ""); }
      catch { return res.status(400).json({ ok: false, error: "invalid_file_name" }); }
      const file = await files.upload(req.user.sub, filename, req.get("x-file-content-type"), req.body);
      res.status(201).set("Cache-Control", "private, no-store").json({ ok: true, file });
    } catch (error) { next(error); }
  });

  router.get("/:fileId", auth, requireAccount, limiter, async (req, res, next) => {
    try {
      const file = await files.download(req.user.sub, req.params.fileId);
      const encodedName = encodeURIComponent(file.name).replace(/'/g, "%27");
      res.set("Cache-Control", "private, no-store");
      res.set("Content-Type", file.contentType || "application/octet-stream");
      res.set("Content-Length", String(file.body.length));
      res.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodedName);
      res.status(200).send(file.body);
    } catch (error) { next(error); }
  });

  router.delete("/:fileId", auth, requireAccount, limiter, async (req, res, next) => {
    try {
      const result = await files.remove(req.user.sub, req.params.fileId);
      res.set("Cache-Control", "private, no-store").json(result);
    } catch (error) { next(error); }
  });

  router.use((error, req, res, next) => {
    if (error && error.type === "entity.too.large") {
      return res.status(413).json({ ok: false, error: "file_too_large" });
    }
    if (error instanceof CloudFilesError) {
      return res.status(error.status).json({ ok: false, error: error.code });
    }
    next(error);
  });

  return router;
}

module.exports = { createFilesRouter };
