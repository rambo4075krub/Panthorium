"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { createPublicAssetMiddleware } = require("../middleware/publicAssets");

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "panthorium-public-assets-"));
const projectRoot = path.resolve(__dirname, "..");
const secretMarker = "private-static-regression-fixture";
const privateFiles = [
  "logs/audit.log", "data/panthorium.json", "server.js", "api.js", "sentinel.js",
  "config/index.js", "services/auditService.js", "routes/auth.js",
  "repositories/authRepository.js", "package.json", "package-lock.json",
  "electron/main.cjs", "test/smoke.js", "scripts/deploy.sh", "docs/operations.md",
  ".env", ".git/config", "browser-download.js.map", "manifest.json.bak"
];

function request(server, requestPath, method = "GET") {
  // Use raw paths so the client cannot normalize traversal cases before testing.
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: requestPath, method }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return server;
}

async function run() {
  for (const file of privateFiles) {
    const target = path.join(fixture, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, secretMarker);
  }
  for (const file of ["manifest.json", "browser-download.html", "browser-download.js", "panthorium-window-base.css"]) {
    fs.copyFileSync(path.join(projectRoot, file), path.join(fixture, file));
  }

  const fixtureApp = express();
  fixtureApp.use(createPublicAssetMiddleware(fixture));
  fixtureApp.use((req, res) => res.status(404).json({ error: "not_found" }));
  let server = await listen(fixtureApp);
  try {
    const deniedPaths = [
      ...privateFiles.map((file) => `/${file}`),
      "/logs/", "/logs//audit.log", "/logs/audit.log?download=1", "/LOGS/audit.log",
      "/logs%2faudit.log", "/%6cogs/audit.log", "/logs/%61udit.log", "/logs%5caudit.log",
      "/logs\\audit.log", "/%2eenv", "/%252eenv", "/.git%2fconfig",
      "/../logs/audit.log", "/panthorium-window-base.css/../logs/audit.log",
      "/panthorium-window-base.css/%2e%2e/logs/audit.log", "/%2e%2e/logs/audit.log",
      "//logs/audit.log", "/manifest.json/../server.js", "/manifest.json%00/../server.js",
      "/manifest.json/", "/manifest.json.map", "/does-not-exist.js", "/%"
    ];
    for (const requestPath of deniedPaths) {
      for (const method of ["GET", "HEAD"]) {
        const response = await request(server, requestPath, method);
        assert.equal(response.status, 404, `${method} ${requestPath} must not expose files`);
        assert.ok(!response.body.includes(secretMarker), "a private file was returned");
      }
    }
    for (const file of ["manifest.json", "browser-download.html", "browser-download.js", "panthorium-window-base.css"]) {
      const response = await request(server, `/${file}?v=security-test`);
      assert.equal(response.status, 200, file);
      assert.deepEqual(response.body, fs.readFileSync(path.join(fixture, file)), file);
      const head = await request(server, `/${file}`, "HEAD");
      assert.equal(head.status, 200, file);
      assert.equal(head.body.length, 0);
      assert.equal((await request(server, `/${file}`, "POST")).status, 404);
    }
    // Existing allowlist entries do not fall back to another file if missing.
    assert.equal((await request(server, "/panthorium-logo.svg")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-only-public-asset-boundary-secret";
  process.env.DATA_FILE = path.join(fixture, "runtime", "panthorium.json");
  process.env.AUDIT_FILE = path.join(fixture, "logs", "audit.log");
  process.env.DATABASE_URL = "";
  const { app } = require("../server");
  server = await listen(app);
  try {
    // Verify the real server actually uses the restricted boundary, not just
    // the middleware fixture above. These files exist in the project checkout.
    for (const file of ["server.js", "config/index.js", "services/auditService.js", "package.json", "package-lock.json"]) {
      assert.equal((await request(server, `/${file}`)).status, 404, `server leaked ${file}`);
    }
    const shell = await request(server, "/");
    assert.equal(shell.status, 200);
    const download = await request(server, "/browser-download.html");
    assert.equal(download.status, 200);
    const html = shell.body.toString() + download.body.toString();
    const localAssets = new Set(["/sw.js"]);
    for (const match of html.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)) {
      if (/\.(?:js|css|png|svg|json)(?:\?|$)/.test(match[1])) localAssets.add(match[1]);
    }
    assert.ok(localAssets.size > 50, "the rendered shell's asset links must be checked");
    for (const asset of localAssets) {
      const response = await request(server, asset);
      assert.equal(response.status, 200, `public UI asset unavailable: ${asset}`);
      assert.ok(response.body.length > 0, `empty public UI asset: ${asset}`);
    }
    const manifest = JSON.parse((await request(server, "/manifest.json")).body);
    for (const icon of manifest.icons) assert.equal((await request(server, icon.src)).status, 200, icon.src);
    for (const route of ["/privacy", "/account-deletion", "/admin", "/sentinel.html"]) {
      assert.equal((await request(server, route)).status, 200, route);
    }
    assert.equal((await request(server, "/browser")).headers.location, "/browser-download.html");

    // Executable CDN content must remain version-pinned and integrity checked.
    const faceApiTag = html.match(/<script\b[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/@vladmandic\/face-api[^>]*>/)?.[0];
    assert.ok(faceApiTag, "face detection library must remain available");
    const version = faceApiTag.match(/face-api@(\d+\.\d+\.\d+)\//)?.[1];
    assert.ok(version, "face-api must use an exact release");
    assert.match(faceApiTag, /integrity="sha384-[A-Za-z0-9+/]{64}"/);
    assert.match(faceApiTag, /crossorigin="anonymous"/);
    assert.ok(html.includes(`face-api@${version}/model/`), "face models and library releases must match");
    console.log(`Public asset security tests passed (${localAssets.size} UI assets; runtime logs, private files and traversal denied)`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});
