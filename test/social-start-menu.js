"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const modules = ["feed", "short", "watch", "live", "tv", "market", "community", "talk", "connect", "profile", "friends"];

(async () => {
  for (const role of ["user", "administrator"]) {
    const dom = new JSDOM(read("sentinel.html"), {
      url: "https://panthorium.test" + (role === "administrator" ? "/admin" : "/"),
      runScripts: "outside-only", pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    });
    const w = dom.window, d = w.document;
    const evaluate = (code) => vm.runInContext(code, dom.getInternalVMContext());
    try {
      w.fetch = async () => ({ ok: true, json: async () => ({ ok: true, items: [], calls: [], orders: [] }) });
      const load = (file) => evaluate(read(file));
      load("panthorium-window-base.js");
      const inline = [...d.scripts].find(s => s.textContent.includes("const OS =")).textContent;
      evaluate(inline.replace(/\n    boot\(\);/, "\n    OS.state.booted = true;"));
      evaluate(`OS.state.user = ${JSON.stringify({sub: "menu-test", roles: [role], permissions: ["chat"]})}`);
      w.PanthoriumAuth = { isAdministrator: () => role === "administrator" };
      for (const file of ["start-menu-ui.js", "voice-window-catalog.js", "social-ui.js", "access-shell-ui.js"]) load(file);
      d.dispatchEvent(new w.Event("DOMContentLoaded"));
      w.dispatchEvent(new w.Event("panthorium:auth-changed"));
      const start = d.getElementById("start-btn");
      for (let repeat = 0; repeat < 3; repeat++) {
        start.click();
        w.PanthoriumAccessShell.sync();
        await new Promise(resolve => setImmediate(resolve));
        const group = d.querySelector('[data-start-group="social"]');
        assert(group, `${role}: Social Media survives Start click ${repeat + 1}`);
        assert.equal(d.querySelectorAll('[data-start-group="social"]').length, 1);
        const toggle = group.querySelector("[data-start-group-toggle]");
        if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
        for (const module of modules) {
          const entries = group.querySelectorAll(`[data-app-id="social-${module}"]`);
          assert.equal(entries.length, 1, `${module} has exactly one entry`);
          assert.notEqual(entries[0].dataset.searchHidden, "true");
          assert.equal(entries[0].closest("[data-start-group-items]").hidden, false);
        }
        start.click();
      }
      start.click();
      const search = d.getElementById("start-search");
      search.value = "Watch";
      search.dispatchEvent(new w.Event("input"));
      assert.notEqual(d.querySelector('[data-app-id="social-watch"]').dataset.searchHidden, "true");
      d.querySelector('[data-app-id="social-watch"]').click();
      await new Promise(resolve => setImmediate(resolve));
      assert(d.querySelector('[data-social="watch"]'), "menu opens actual Watch window");
      for (const user of [{sub:"guest:test",roles:["guest"],permissions:["chat"]}, {sub:"no-chat",roles:["user"],permissions:[]}]) {
        evaluate(`OS.state.user = ${JSON.stringify(user)}`);
        w.dispatchEvent(new w.Event("panthorium:auth-changed"));
        start.click();
        assert.equal(d.querySelector('[data-start-group="social"]'), null, "unauthorized account has no Social menu");
      }
    } finally { dom.window.close(); }
  }
  console.log("Social Start: actual shell clicks, reopen, search, launch and access checks passed for User/Admin");
})().catch(error => { console.error(error); process.exitCode = 1; });
