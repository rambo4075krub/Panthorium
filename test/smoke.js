process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-panthorium";
process.env.DATA_FILE = "/tmp/panthorium-test.json";
process.env.AUDIT_FILE = "/tmp/panthorium-audit.log";
const fs = require("fs");
for (const f of [process.env.DATA_FILE, process.env.AUDIT_FILE]) { try { fs.unlinkSync(f); } catch {} }
const { app } = require("../server");

(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(base + "/api/health");
    if (r.status !== 200) throw new Error("health failed");
    r = await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "test" }) });
    if (r.status !== 401) throw new Error("chat should require auth");
    r = await fetch(base + "/api/auth/guest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const auth = await r.json();
    if (!auth.accessToken) throw new Error("guest token missing");
    r = await fetch(base + "/api/core/status", { headers: { authorization: `Bearer ${auth.accessToken}` } });
    if (r.status !== 200) throw new Error("authenticated status failed");
    console.log("Smoke tests passed");
  } finally {
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
