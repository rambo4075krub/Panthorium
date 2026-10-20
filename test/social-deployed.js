"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const base = process.env.SOCIAL_SMOKE_URL;
  if (!base) throw Error("SOCIAL_SMOKE_URL required");
  for (const path of ["/", "/admin"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert(html.includes("window.PanthoriumSocial?.renderMenu?.()"), path + " missing Social menu rebuild hook");
    for (const file of ["social-ui.js", "social-rtc.js", "contact-ui.js"])
      assert(html.includes(file), path + " missing " + file);
  }
  for (const file of [
    "contact-ui.js",
    "start-menu-ui.js",
    "access-shell-ui.js",
    "social-ui.js",
    "social-rtc.js",
    "voice-window-catalog.js",
  ]) {
    const r = await fetch(base + "/" + file);
    assert.equal(r.status, 200);
    assert.equal(
      await r.text(),
      fs.readFileSync(file, "utf8"),
      file + " differs from release",
    );
  }
  for (const path of [
    "/api/social/feed/community",
    "/api/social/profile",
    "/api/social/inbox",
    "/api/social/notifications",
    "/api/social/reports",
  ])
    assert.equal(
      (await fetch(base + path)).status,
      401,
      path + " must require authentication",
    );
  assert.equal((await fetch(base + "/api/social/support", { method: "POST" })).status, 401, "support chat requires authentication");
  assert.equal((await fetch(base + "/api/social/records/unavailable/read", { method: "POST" })).status, 401, "read receipts require authentication");
  assert.equal((await fetch(base + "/api/social/notifications/read", { method: "POST" })).status, 401, "notification acknowledgements require authentication");
  console.log(
    "Deployed Social: both shells, exact six-app/RTC assets and protected APIs passed. Public posts and real user messages were not created.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
