/** Panthorium OS Backend */
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const config = require("./config");
const { createAuthRepository } = require("./repositories/authRepository");
const { AuditService } = require("./services/auditService");
const { AuthService } = require("./services/authService");
const { SentinelCore } = require("./services/sentinelCore");
const { createApiRouter } = require("./routes/api");
const { createAuthRouter } = require("./routes/auth");
const { createSecurityRouter } = require("./routes/security");
const { requestContext } = require("./middleware/requestContext");

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);

const authRepository = createAuthRepository(config);
const audit = new AuditService(config.auditFile);
const authService = new AuthService({ repository: authRepository, config, audit });
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
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", ...config.allowedOrigins],
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
app.use("/api/security", createSecurityRouter(authService, authRepository, audit));
app.use("/api", createApiRouter(sentinelCore, authService, audit));

const frontendCandidates = [path.join(__dirname, ".."), __dirname];
const frontendRoot = frontendCandidates.find((dir) => fs.existsSync(path.join(dir, "sentinel.html"))) || __dirname;

for (const script of ["branding.js", "phase2-auth.js", "user-manager.js", "security-dashboard.js"]) {
  app.get(`/${script}`, (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      res.sendFile(path.join(frontendRoot, script));
    } catch (error) { next(error); }
  });
}

app.use(express.static(frontendRoot, { index: false, etag: true, maxAge: config.isProduction ? "1h" : 0 }));
app.get("/", (req, res, next) => {
  try {
    const file = path.join(frontendRoot, "sentinel.html");
    let html = fs.readFileSync(file, "utf8");
    if (!html.includes('/branding.js')) html = html.replace(/<\/body>/i, '  <script src="/branding.js?v=phase3-clean-loader"></script>\n</body>');
    if (!html.includes('/phase2-auth.js')) html = html.replace(/<\/body>/i, '  <script src="/phase2-auth.js?v=phase3-clean-loader"></script>\n</body>');
    if (!html.includes('/user-manager.js')) html = html.replace(/<\/body>/i, '  <script src="/user-manager.js?v=phase3-clean-loader"></script>\n</body>');
    if (!html.includes('/security-dashboard.js')) html = html.replace(/<\/body>/i, '  <script src="/security-dashboard.js?v=phase3-clean-loader"></script>\n</body>');

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.type("html").send(html);
  } catch (error) { next(error); }
});

app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, req, res, next) => {
  console.error("[HTTP]", err.message);
  if (err.message === "CORS origin denied") return res.status(403).json({ ok: false, error: "cors_denied" });
  res.status(500).json({ ok: false, error: "internal_error" });
});

async function start() {
  await authService.init();
  return app.listen(config.port, config.host, () => {
    console.log("========================================");
    console.log("  Panthorium OS Backend");
    console.log(`  Auth persistence: ${config.databaseUrl ? "PostgreSQL" : "JSON fallback"}`);
    console.log("  Sentinel Core is online");
    console.log(`  http://localhost:${config.port}`);
    console.log(`  API: http://localhost:${config.port}/api/health`);
    console.log("========================================");
  });
}

if (require.main === module) start().catch((error) => { console.error("[BOOT]", error); process.exit(1); });
module.exports = { app, sentinelCore, authService, start };
