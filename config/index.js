const path = require("path");

function list(value, fallback = []) {
  if (!value) return fallback;
  return String(value).split(",").map((v) => v.trim()).filter(Boolean);
}

const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || (isProduction ? "" : "dev-only-change-me-panthorium");
if (!jwtSecret) throw new Error("JWT_SECRET is required in production");

module.exports = {
  env: process.env.NODE_ENV || "development",
  isProduction,
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8787),
  jwtSecret,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS, ["http://localhost:8787", "http://127.0.0.1:8787"]),
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "panthorium.json"),
  auditFile: process.env.AUDIT_FILE || path.join(__dirname, "..", "logs", "audit.log"),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  trustProxy: process.env.TRUST_PROXY === "1"
};
