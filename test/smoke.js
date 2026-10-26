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
    for (const route of ['/privacy', '/account-deletion']) {
      const publicResponse = await fetch(base + route);
      if (publicResponse.status !== 200 || !(await publicResponse.text()).includes('Panthorium Browser')) throw new Error('public policy unavailable: ' + route);
      if (publicResponse.headers.get('set-cookie')) throw new Error('public notice must not create a session');
    }
    const shell = await (await fetch(base + '/')).text();
    const releaseResponse = await fetch(base + '/app-release.json');
    if (releaseResponse.status !== 200 || !releaseResponse.headers.get('cache-control')?.includes('no-store')) throw new Error('public update metadata must bypass caches');
    const release = await releaseResponse.json();
    if (!/^[a-zA-Z0-9._-]{1,160}$/.test(release.release) || !shell.includes('data-panthorium-release="' + release.release + '"')) throw new Error('update baseline must identify the HTML actually served');
    if (!shell.includes('/app-update-client.js') || shell.indexOf('/app-update-client.js') > shell.indexOf('/access-shell-ui.js')) throw new Error('shared updater must load before the menu');
    const updateClient = await fetch(base + '/app-update-client.js');
    if (updateClient.status !== 200 || !updateClient.headers.get('cache-control')?.includes('no-store')) throw new Error('update client must bypass caches');
    if (shell.indexOf('/privacy-notice.js') < 0 || shell.indexOf('/privacy-notice.js') > shell.indexOf('/privacy-policy-ui.js')) throw new Error('shared policy must load before policy UI');
    let r = await fetch(base + "/api/health");
    if (r.status !== 200) throw new Error("health failed");
    r = await fetch(base + "/health");
    if (r.status !== 200) throw new Error("readiness failed");
    r = await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "test" }) });
    if (r.status !== 401) throw new Error("chat should require auth");
    r = await fetch(base + "/api/auth/guest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const auth = await r.json();
    if (!auth.accessToken) throw new Error("guest token missing");
    r = await fetch(base + "/api/sentinel/status", { headers: { authorization: `Bearer ${auth.accessToken}` } });
    if (r.status !== 200) throw new Error("authenticated status failed");
    console.log("Smoke tests passed");
  } finally {
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
