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
    const second = (await service.write({ user, action: "publish",
      input: { module: "community", text: "Second post" } })).record;
    await service.write({ user, action: "comment", input: { recordId: item.id, text: "First post comment <script>safe</script>" } });
    await service.write({ user, action: "comment", input: { recordId: second.id, text: "Second post comment" } });
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
    let watchFixture = false, reportCount = 0;
    w.URL.createObjectURL = () => "blob:watch-fixture";
    w.URL.revokeObjectURL = () => {};
    w.fetch = async (url, opts = {}) => {
      const p = new URL(url);
      let out;
      if (watchFixture && p.pathname === "/api/social/feed/watch")
        return { ok: true, json: async () => ({ ok: true, items: [{
          id: "watch-fixture", kind: "watch", ownerId: "another-member", title: "Watch preview",
          text: "Inline post text", files: [{id:"video",name:"clip.mp4"},{id:"image",name:"photo.png"},{id:"text",name:"note.txt"}]
        }] }) };
      if (watchFixture && p.pathname.includes("/files/")) {
        const id = p.pathname.split("/").pop();
        return { ok: true, blob: async () => new Blob(["<script>plain text</script>"],
          {type: id === "video" ? "video/mp4" : id === "image" ? "image/png" : "text/plain"}) };
      }
      if (watchFixture && p.pathname === "/api/social/records/watch-fixture")
        return { ok: true, json: async () => ({ ok: true, items: [{
          id: "watch-comment", kind: "comment", ownerId: "another-member", author: { name: "เพื่อน" },
          createdAt: new Date().toISOString(), text: "ความคิดเห็นใต้ Watch",
        }] }) };
      if (watchFixture && p.pathname === "/api/social/actions") {
        const action = JSON.parse(opts.body);
        if (action.action === "report") { reportCount++; return {ok:true,json:async()=>({ok:true})}; }
      }
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
    await new Promise(resolve => setTimeout(resolve, 10));
    const postCard = w.document.querySelector(`[data-record-id="${item.id}"]`);
    const secondCard = w.document.querySelector(`[data-record-id="${second.id}"]`);
    assert.match(postCard.querySelector('[data-social-comments]').textContent, /First post comment <script>safe<\/script>/);
    assert.match(secondCard.querySelector('[data-social-comments]').textContent, /Second post comment/);
    assert.doesNotMatch(postCard.textContent, /Second post comment/);
    assert.equal(postCard.querySelector('script'), null);
    const inlineForm = postCard.querySelector('[data-social-comment-form]');
    const inlineText = inlineForm.querySelector('textarea');
    [...postCard.querySelectorAll('button')].find(b => b.textContent === 'ความคิดเห็น').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(w.document.activeElement, inlineText);
    assert(secondCard.isConnected, 'comment button does not replace the feed');
    inlineText.value = 'New inline comment';
    inlineForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert(postCard.isConnected && secondCard.isConnected, 'submitting preserves both post cards');
    assert.match(postCard.querySelector('[data-social-comments]').textContent, /New inline comment/);
    assert.equal(inlineText.value, '');
    assert((await service.read({ user, recordId: item.id })).items.some(x => x.text === 'New inline comment'));
    await w.PanthoriumSocial.open("community", { recordId: item.id });
    assert(w.document.querySelector("[data-social-messages]"));
    assert(w.document.querySelector(`[data-record-id="${item.id}"] [data-social-comments]`), 'direct post link retains the post above its comments');
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
    watchFixture = true;
    const watchRoot = await w.PanthoriumSocial.open("watch");
    [...watchRoot.querySelectorAll('button')].find(b => b.textContent === 'รีเฟรช').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    const watch = w.document.querySelector('[data-record-id="watch-fixture"]');
    assert(watch.querySelector('video[controls][playsinline]'));
    assert(!watch.querySelector('video').autoplay);
    assert(watch.querySelector('img[alt="photo.png"]'));
    assert.equal(watch.querySelector('pre').textContent, '<script>plain text</script>');
    assert.equal(watch.querySelector('script'), null);
    assert(!watch.textContent.includes('เปิดไฟล์ / ดูตัวอย่าง'));
    assert.match(watch.querySelector('[data-social-comments]').textContent, /ความคิดเห็นใต้ Watch/);
    assert.match(watch.querySelector('[data-social-comments]').textContent, /เพื่อน/);
    const report = [...watch.querySelectorAll('button')].find(b => b.textContent === 'รายงาน');
    const reason = watch.querySelector('textarea');
    assert(reason.parentElement.parentElement.hidden);
    report.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(!reason.parentElement.parentElement.hidden);
    assert.equal(w.document.activeElement, reason);
    assert.equal(reportCount, 0, 'opening report form does not send a report');
    reason.value = 'Test report reason';
    [...watch.querySelectorAll('button')].find(b => b.textContent === 'ส่งรายงาน').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(reportCount, 1);
    assert(reason.parentElement.parentElement.hidden);
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
