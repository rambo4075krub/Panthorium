"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { AuthService } = require("../services/authService");
const { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService");
const { createSocialRouter } = require("../routes/social");
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(check, message) { const end = Date.now() + 16000; while (Date.now() < end) { if (await check()) return; await pause(100); } throw Error(message); }
(async () => {
  const auth = new AuthService({ config: { jwtSecret: "notification-browser-fixture", accessTokenTtl: "1h" }, audit: { record() {} } });
  const a = { id: randomUUID(), roles: ["user"], permissions: ["chat"] }, b = { ...a, id: randomUUID() };
  a.sub = a.id; b.sub = b.id;
  const repo = new SocialRepository({ allowMemory: true });
  const service = new SocialService({ repository: repo, files: {} }); await service.init();
  const write = (user, action, input) => service.write({ user, action, input, requestId: randomUUID() });
  await write(a, "profile", { name: "ปานเทพ <img src=x onerror=alert(1)>", discoverable: true });
  await write(b, "profile", { name: "เพื่อน", discoverable: true });
  const app = express(); app.use(express.json()); app.use("/api/social", createSocialRouter(auth, service));
  for (const file of ["social-ui.js", "start-menu-ui.js"]) app.get("/" + file, (_, res) => res.sendFile(path.join(__dirname, "..", file)));
  app.get("/", (_, res) => res.type("html").send(`<!doctype html><html><body style="margin:0;background:#080f18;color:white"><div id="sm-apps" style="width:300px"></div><div id="start-menu"></div><script>
    window.toasts=[];window.toast=text=>toasts.push(text);
    window.createWindow=(id,title,markup,opts)=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;el.style.cssText='position:fixed;left:0;top:0;width:min(760px,100vw);height:600px;z-index:10';el.innerHTML=markup;document.body.append(el);OS.windows.set(id,{el,onClose:opts.onClose});};
    window.focusWindow=id=>{const el=OS.windows.get(id)?.el;if(el)el.style.display='';};
  </script><script src="/start-menu-ui.js"></script><script src="/social-ui.js"></script></body></html>`));
  const server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    const sender = await context.newPage(), reader = await context.newPage(), errors = [];
    for (const [page, user] of [[sender, a], [reader, b]]) {
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ user, token }) => { window.OS = { state: { user }, config: { backendUrl: location.origin, accessToken: token }, windows: new Map() }; }, { user, token: auth.signAccessToken(user) });
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.evaluate(() => PanthoriumSocial.refreshNotifications());
    }
    const count = page => page.locator('[data-start-group="social"] .sm-group-label [data-social-notification-count]');
    const openAlerts = async page => {
      await page.evaluate(() => PanthoriumSocial.open("talk"));
      await page.evaluate(() => PanthoriumSocial.showNotifications());
      assert.equal(await page.locator('[data-social="talk"] .social-activity').count(), 1);
      assert.equal(await page.locator('#social-notification-bell,[data-social-open-notifications],#social-notification-center').count(), 0, "no global notification button or panel");
      const badge = page.locator('[data-social-tab="talk"] [data-social-module-count]');
      assert.equal(Number(await badge.textContent()) + 2, Number(await count(page).textContent()));
    };
    assert.equal(await reader.locator('#social-notification-bell').count(), 0);
    const thread = (await write(a, "thread", { userId: b.id })).record;
    await until(async () => (await count(reader).textContent()) === "3", "request visible without opening any Social app");
    assert.equal(await reader.locator("[data-social]").count(), 0);
    assert.equal(await reader.locator('[data-app-id="social-talk"] [data-social-module-count]').textContent(), "1");
    assert.equal(await reader.locator('[data-start-group="social"] .sm-group-label [data-social-notification-count]').textContent(), "3");
    for (const module of ["watch", "profile"]) {
      const marker = reader.locator('[data-app-id="social-' + module + '"] [data-social-module-count]');
      assert.equal(await marker.textContent(), "1");
      assert.equal(await marker.getAttribute("hidden"), null);
    }
    await openAlerts(reader);
    const panel = reader.locator('[data-social="talk"] [data-activity-items]');
    await panel.getByText("ปานเทพ <img src=x onerror=alert(1)> • ส่งคำขอสนทนาถึงคุณ", { exact: true }).waitFor();
    assert.equal(await panel.locator("img").count(), 0, "sender name is safe text");
    assert.equal((await repo.get(thread.id)).status, "pending");
    await panel.getByRole("button", { name: "เปิดรายการ", exact: true }).click();
    await reader.getByRole("button", { name: "รับคำขอ", exact: true }).click();
    await until(async () => (await repo.get(thread.id)).status === "accepted", "request accepted from notification");
    await until(async () => (await count(sender).textContent()) === "3", "sender notified of acceptance");
    await sender.bringToFront(); await openAlerts(sender);
    await sender.getByText("เพื่อน • ตอบรับคำขอสนทนาของคุณแล้ว", { exact: true }).waitFor();
    await sender.locator('[data-social="talk"] [data-activity-items]').getByRole("button", { name: "เปิดรายการ", exact: true }).click();
    await reader.evaluate(() => { const win=OS.windows.get('social-media');win.onClose();win.el.remove();OS.windows.delete('social-media'); });
    await sender.getByLabel("ข้อความ", { exact: true }).fill("ทดสอบข้อความใหม่");
    await sender.getByRole("button", { name: "ส่ง", exact: true }).click();
    const message = (await service.read({ user: a, recordId: thread.id })).items[0];
    await until(async () => (await count(reader).textContent()) === "3", "new message alerts when Talk is closed");
    assert.equal((await repo.get(message.id)).readAt, undefined);
    await openAlerts(reader);
    await panel.getByRole("button", { name: "อ่านทั้งหมดในหน้านี้", exact: true }).click();
    await until(async () => (await count(reader).textContent()) === "2", "reading alerts leaves only the two pinned markers");
    assert.equal((await repo.get(message.id)).readAt, undefined, "notification read is separate from chat read");
    await reader.reload(); await reader.evaluate(() => PanthoriumSocial.refreshNotifications());
    assert((await count(reader).textContent()) === "2", "read state and pinned markers survive reload");
    await reader.bringToFront(); await openAlerts(reader);
    const messageRow = panel.locator("article").filter({ hasText: "ส่งข้อความใหม่ถึงคุณ" });
    await messageRow.getByRole("button", { name: "เปิดรายการ", exact: true }).click();
    await reader.locator('[data-message-id="' + message.id + '"]').evaluate(node => node.scrollIntoView({ block: "center" }));
    await until(async () => !!(await repo.get(message.id)).readAt, "opening and viewing chat sets read receipt");
    await openAlerts(reader);
    for (const width of [390, 320]) {
      await reader.setViewportSize({ width, height: 700 });
      const box = await panel.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width, "notification panel fits mobile width " + width);
    }
    if (process.env.SOCIAL_NOTIFICATION_SCREENSHOT) await reader.screenshot({ path: process.env.SOCIAL_NOTIFICATION_SCREENSHOT });
    await reader.locator('[data-social="talk"] .social-activity summary').click();
    assert.equal(await panel.isVisible(), false);
    await openAlerts(reader);
    await reader.evaluate(() => { OS.state.user={sub:'guest:test',roles:['guest'],permissions:[]}; window.dispatchEvent(new Event('panthorium:auth-changed')); });
    assert.equal(await reader.locator("#social-notification-bell").count(), 0);
    assert.equal(await panel.count(), 0);
    assert.doesNotMatch(await reader.locator("body").textContent(), /ทดสอบข้อความใหม่|ปานเทพ/);
    assert.deepEqual(errors, []);
    console.log("Social notifications browser: per-menu activity without a global bell or overlay, request/acceptance navigation, Start badges, closed Talk, durable reads, safe names, mobile panel and logout cleanup passed");
  } finally {
    if (browser) await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
