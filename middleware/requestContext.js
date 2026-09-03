const { randomUUID } = require("crypto");

function requestContext(audit) {
  return (req, res, next) => {
    req.requestId = req.headers["x-request-id"] || randomUUID();
    res.setHeader("x-request-id", req.requestId);
    const started = Date.now();
    res.on("finish", () => {
      audit.record("http.request", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - started,
        userId: req.user?.sub || null,
        ip: req.ip || req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null
      });
    });
    next();
  };
}

module.exports = { requestContext };
