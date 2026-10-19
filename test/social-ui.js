"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const { randomUUID } = require("node:crypto");
const { SocialService } = require("../services/socialService");
const { SocialRepository } = require("../services/socialRepository");
(async () => {
  for (const role of ["user", "administrator"]) {
    const user = {
      sub: randomUUID(),
      roles: [role],
      permissions: ["chat", ...(role === "administrator" ? ["settings"] : [])],
    };
    const service = new SocialService({
      repository: new SocialRepository({ allowMemory: true }),
      files: {
        findObject: async () => {
          throw Error("file_not_found");
        },
      },
    });
    await service.init();
    await service.write({
      user,
      action: "profile",
      input: { name: "Owner", discoverable: true },
    });
    const item = (
      await service.write({
        user,
        action: "publish",
        input: {
          module: "community",
          title: "<img src=x onerror=alert(1)>",
          text: "<script>oops</script>",
        },
      })
    ).record;
    const dom = new JSDOM(
        '<body><div id="sm-apps"></div><div id="start-menu"></div></body>',
        { url: "https://panthorium.test", runScripts: "outside-only" },
      ),
      w = dom.window;
    w.OS = {
      state: { user },
      config: { backendUrl: "https://panthorium.test", accessToken: "fixture" },
      windows: new Map(),
    };
    w.confirm = () => true;
    w.createWindow = (id, title, markup, opts) => {
      const n = w.document.createElement("div");
      n.className = "window";
      n.dataset.id = id;
      n.innerHTML = markup;
      w.document.body.append(n);
      w.OS.windows.set(id, { el: n, onClose: opts.onClose });
    };
    w.focusWindow = () => {};
    w.fetch = async (url, opts = {}) => {
      const p = new URL(url);
      let out;
      try {
        if (p.pathname.startsWith("/api/social/feed/"))
          out = await service.read({
            user: w.OS.state.user,
            module: p.pathname.split("/").pop(),
          });
        else if (p.pathname === "/api/social/profile")
          out = { ok: true, profile: await service.profile(w.OS.state.user) };
        else if (p.pathname === "/api/social/inbox")
          out = await service.inbox({ user: w.OS.state.user });
        else if (p.pathname.startsWith("/api/social/records/"))
          out = await service.read({
            user: w.OS.state.user,
            recordId: decodeURIComponent(p.pathname.split("/")[4]),
          });
        else if (p.pathname === "/api/social/actions") {
          const b = JSON.parse(opts.body);
          out = await service.write({ user: w.OS.state.user, ...b });
        } else
          out = {
            ok: true,
            items: [],
            files: [],
            usedBytes: 0,
            maxBytes: 1000,
          };
        return { ok: true, status: 200, json: async () => out };
      } catch (e) {
        return {
          ok: false,
          status: e.status || 400,
          json: async () => ({ ok: false, error: e.message }),
        };
      }
    };
    for (const file of [
      "start-menu-ui.js",
      "voice-window-catalog.js",
      "social-rtc.js",
      "social-ui.js",
    ])
      w.eval(fs.readFileSync(file, "utf8"));
    w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
    assert.equal(
      w.document.querySelectorAll('[data-start-group="social"] .sm-app').length,
      6,
      role + " gets six apps",
    );
    for (const mod of [
      "watch",
      "community",
      "talk",
      "market",
      "live",
      "connect",
    ])
      await w.PanthoriumSocial.open(mod);
    assert.equal(w.document.querySelectorAll("[data-social]").length, 6);
    assert.equal(
      w.document.querySelector("img"),
      null,
      "user text cannot become markup",
    );
    assert.match(
      w.document.querySelector('[data-social="community"]').textContent,
      /<script>oops<\/script>/,
    );
    await w.PanthoriumSocial.open("community", { recordId: item.id });
    assert(w.document.querySelector("[data-social-messages]"));
    const c = w.document.querySelector('[data-social="community"]');
    [...c.querySelectorAll("button")]
      .find((b) => b.textContent === "สร้างโพสต์")
      .click();
    await new Promise((r) => setTimeout(r, 10));
    const form = c.querySelector("form");
    assert(form);
    const text = form.querySelector("textarea");
    text.value = "created from real UI";
    form.dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 30));
    assert(
      (await service.read({ user, module: "community" })).items.some(
        (x) => x.text === "created from real UI",
      ),
    );
    w.OS.state.user = { sub: "guest:new", roles: ["guest"] };
    w.dispatchEvent(new w.Event("panthorium:auth-changed"));
    assert.equal(w.document.querySelector('[data-start-group="social"]'), null);
    assert.doesNotMatch(w.document.body.textContent, /created from real UI/);
    await assert.rejects(
      () => w.PanthoriumSocial.open("community"),
      /account_required/,
    );
    for (const rec of w.OS.windows.values()) rec.onClose();
    dom.window.close();
  }
  console.log(
    "Social UI: User/Admin six-app menu, actual service publish, safe rendering, account switch and guest denial passed",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
