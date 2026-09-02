const express = require("express");
const { randomUUID } = require("crypto");

function createApiRouter(sentinelCore) {
  const router = express.Router();

  // สุขภาพระบบ
  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "Panthorium Backend",
      core: sentinelCore.status(),
      time: new Date().toISOString()
    });
  });

  // สถานะ Sentinel Core
  router.get("/core/status", (req, res) => {
    res.json({ ok: true, ...sentinelCore.status() });
  });

  // สนทนากับ Sentinel (ผ่าน Core)
  router.post("/chat", async (req, res) => {
    try {
      const { message, sessionId, mode } = req.body || {};
      const sid = sessionId || req.headers["x-session-id"] || randomUUID();

      const result = await sentinelCore.chat({
        sessionId: sid,
        message,
        mode: mode || "default"
      });

      res.json({
        ...result,
        sessionId: sid
      });
    } catch (err) {
      console.error("[API /chat]", err);
      res.status(500).json({
        ok: false,
        error: "internal_error",
        text: "เกิดข้อผิดพลาดภายใน Sentinel Core"
      });
    }
  });

  // สั่งงาน Core โดยตรง
  router.post("/core/command", async (req, res) => {
    try {
      const { command, sessionId } = req.body || {};
      const sid = sessionId || req.headers["x-session-id"] || randomUUID();

      const result = await sentinelCore.chat({
        sessionId: sid,
        message: command,
        mode: "core"
      });

      res.json({
        ...result,
        sessionId: sid
      });
    } catch (err) {
      console.error("[API /core/command]", err);
      res.status(500).json({
        ok: false,
        error: "internal_error",
        text: "เกิดข้อผิดพลาดภายใน Sentinel Core"
      });
    }
  });

  // ล้างประวัติสนทนา
  router.post("/chat/clear", (req, res) => {
    const { sessionId } = req.body || {};
    if (sessionId) sentinelCore.clearSession(sessionId);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createApiRouter };
