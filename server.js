/**
 * Panthorium OS Backend
 * Sentinel Core runs here
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { SentinelCore } = require("./services/sentinelCore");
const { createApiRouter } = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "0.0.0.0";

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

// Sentinel Core instance
const sentinelCore = new SentinelCore();

// API routes
app.use("/api", createApiRouter(sentinelCore));

// Serve frontend (optional - when running full stack together)
const frontendRoot = path.join(__dirname, "..");
app.use(express.static(frontendRoot));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendRoot, "sentinel.html"));
});

// Fallback
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

app.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("  Panthorium OS Backend");
  console.log("  Sentinel Core is online");
  console.log(`  http://localhost:${PORT}`);
  console.log(`  API: http://localhost:${PORT}/api/health`);
  console.log("========================================");
});
