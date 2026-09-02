/** Panthorium OS Backend */
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const config = require("./config");
const { JsonStore } = require("./repositories/jsonStore");
const { AuditService } = require("./services/auditService");
const { AuthService } = require("./services/authService");
const { SentinelCore } = require("./services/sentinelCore");
const { createApiRouter } = require("./routes/api");
const { createAuthRouter } = require("./routes/auth");
const { requestContext } = require("./middleware/requestContext");

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);

const store = new JsonStore(config.dataFile);
const audit = new AuditService(config.auditFile);
const authService = new AuthService({ store, config, audit });
const sentinelCore = new SentinelCore();

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", ...config.allowedOrigins],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin denied"));
  },
  credentials: true
}));
app.use(express.json({ limit: "256kb", type: "application/json" }));
app.use(cookieParser());
app.use(requestContext(audit));

app.use("/api/auth", createAuthRouter(authService, config));
app.use("/api", createApiRouter(sentinelCore, authService, audit));

const frontendCandidates = [path.join(__dirname, ".."), __dirname];
const frontendRoot = frontendCandidates.find((dir) => fs.existsSync(path.join(dir, "sentinel.html"))) || __dirname;
app.use(express.static(frontendRoot, { index: false, etag: true, maxAge: config.isProduction ? "1h" : 0 }));
app.get("/", (req, res) => res.sendFile(path.join(frontendRoot, "sentinel.html")));

app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, req, res, next) => {
  console.error("[HTTP]", err.message);
  if (err.message === "CORS origin denied") return res.status(403).json({ ok: false, error: "cors_denied" });
  res.status(500).json({ ok: false, error: "internal_error" });
});

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log("========================================");
    console.log("  Panthorium OS Backend");
    console.log("  Sentinel Core is online");
    console.log(`  http://localhost:${config.port}`);
    console.log(`  API: http://localhost:${config.port}/api/health`);
    console.log("========================================");
  });
}

module.exports = { app, sentinelCore, authService };
