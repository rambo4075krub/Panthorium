const path = require("path");

function list(value, fallback = []) {
  if (!value) return fallback;
  return String(value).split(",").map((v) => v.trim()).filter(Boolean);
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch (_) {
    return null;
  }
}

function origins(value, fallback = []) {
  return [...new Set(list(value, fallback).map(normalizeOrigin).filter(Boolean))];
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
  allowedOrigins: origins(process.env.ALLOWED_ORIGINS, ["http://localhost:8787", "http://127.0.0.1:8787"]),
  integrationAllowedHosts: list(process.env.INTEGRATION_ALLOWED_HOSTS, []),
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "panthorium.json"),
  auditFile: process.env.AUDIT_FILE || path.join(__dirname, "..", "logs", "audit.log"),
  databaseUrl: process.env.DATABASE_URL || "",
  databaseSslMode: process.env.DATABASE_SSL_MODE || (isProduction ? "require" : "disable"),
  sentinelAutoTraining: process.env.SENTINEL_AUTO_TRAINING !== "0",
  sentinelAutoCapture: process.env.SENTINEL_AUTO_CAPTURE !== "0",
  sentinelAutoScoreThreshold: Number(process.env.SENTINEL_AUTO_SCORE_THRESHOLD || 85),
  sentinelAutoIntervalMs: Number(process.env.SENTINEL_AUTO_INTERVAL_MS || 60000),
  sentinelTeacherProviders: list(process.env.SENTINEL_TEACHER_PROVIDERS, ["groq"]),
  sentinelEvaluatorProviders: list(process.env.SENTINEL_EVALUATOR_PROVIDERS, ["openai", "gemini", "anthropic"]),
  sentinelMinEvaluators: Number(process.env.SENTINEL_MIN_EVALUATORS || 2),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  trustProxy: process.env.TRUST_PROXY === "1"
};
