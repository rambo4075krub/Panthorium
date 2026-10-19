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
    for (const file of ["social-ui.js", "social-rtc.js"])
      assert(html.includes(file), path + " missing " + file);
  }
  for (const file of [
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
    "/api/social/reports",
  ])
    assert.equal(
      (await fetch(base + path)).status,
      401,
      path + " must require authentication",
    );
  console.log(
    "Deployed Social: both shells, exact six-app/RTC assets and protected APIs passed. Public posts and real user messages were not created.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
