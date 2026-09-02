/**
 * Panthorium OS Backend
 * Sentinel Core runs here
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

function loadModule(candidates) {
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      if (err.code !== "MODULE_NOT_FOUND") throw err;
    }
  }
  throw new Error("Cannot find module from candidates: " + candidates.join(", "));
}

const { SentinelCore } = loadModule([
  "./services/sentinelCore",
  "./sentinelCore"
]);

const { createApiRouter } = loadModule([
  "./routes/api",
  "./api"
]);

const app = express();
const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

const sentinelCore = new SentinelCore();
app.use("/api", createApiRouter(sentinelCore));

const frontendCandidates = [
  path.join(__dirname, ".."),
  __dirname
];
const frontendRoot = frontendCandidates.find((dir) =>
  fs.existsSync(path.join(dir, "sentinel.html"))
) || __dirname;

app.use(express.static(frontendRoot));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendRoot, "sentinel.html"));
});

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
