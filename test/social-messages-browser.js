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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await check()) return; await pause(100); }
  throw Error(label);
}
(async () => {
  const auth = new AuthService({ config: { jwtSecret: "test-chat-receipts-only", accessTokenTtl: "1h" }, audit: { record() {} } });
  const a = { id: randomUUID(), roles: ["user"], permissions: ["chat"] }, b = { ...a, id: randomUUID() };
  a.sub = a.id; b.sub = b.id;
  const repository = new SocialRepository({ allowMemory: true });
  const social = new SocialService({ repository, files: {} });
  await social.init();
  const write = (user, action, input) => social.write({ user, action, input, requestId: randomUUID() });
  await write(a, "profile", { name: "ปานเทพ", discoverable: true });
  await write(b, "profile", { name: "โจ้ <img src=x onerror=alert(1)>", discoverable: true });
  const thread = (await write(a, "thread", { userId: b.id })).record;
  await write(b, "accept-thread", { recordId: thread.id, accept: true });
  const app = express();
  app.use(express.json());
  app.use("/api/social", createSocialRouter(auth, social));
  app.get("/social-ui.js", (_, res) => res.sendFile(path.join(__dirname, "../social-ui.js")));
  app.get("/", (_, res) => res.type("html").send(`<!doctype html><html><body style="margin:0"><div id="sm-apps"></div><div id="start-menu"></div><script>
    window.createWindow=(id,title,markup,opts)=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;el.style.cssText='position:fixed;left:0;top:0;width:min(760px,100vw);height:600px;z-index:10';el.innerHTML=markup;document.body.append(el);OS.windows.set(id,{el,onClose:opts.onClose});if(window.hideNewWindows)el.style.display='none';};
    window.focusWindow=()=>{};
    </script><script src="/social-ui.js"></script></body></html>`));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    const sender = await context.newPage(), reader = await context.newPage();
    const errors = [];
    for (const [page, user] of [[sender, a], [reader, b]]) {
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ user, token }) => {
        window.OS = { state: { user }, config: { backendUrl: location.origin, accessToken: token }, windows: new Map() };
      }, { user, token: auth.signAccessToken(user) });
      await page.goto(base);
    }
    await sender.bringToFront();
    await sender.evaluate(id => PanthoriumSocial.open("talk", { recordId: id }), thread.id);
    await sender.getByLabel("ข้อความ", { exact: true }).fill("สวัสดีจากแชท");
    await sender.getByRole("button", { name: "ส่ง", exact: true }).click();
    await sender.getByText("สวัสดีจากแชท", { exact: true }).waitFor();
    assert.equal(await sender.locator('[data-delivery="sent"]').textContent(), "✓");
    assert.equal(await sender.getByRole("button", { name: "บันทึก", exact: true }).count(), 0);
    const first = (await social.read({ user: b, recordId: thread.id })).items[0];
    assert.equal(first.readAt, undefined);
    await reader.evaluate(() => { window.hideNewWindows = true; });
    await reader.evaluate(id => PanthoriumSocial.open("talk", { recordId: id }), thread.id);
    await pause(600);
    assert.equal((await repository.get(first.id)).readAt, undefined, "minimized conversation is not read");
    await reader.bringToFront();
    // Headless Chromium keeps tabs visible; emulate the browser visibility signal.
    await reader.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
    await reader.evaluate(() => { document.querySelector('.window').style.display=''; window.dispatchEvent(new Event('focus')); });
    await reader.locator('[data-message-id="' + first.id + '"]').scrollIntoViewIfNeeded();
    await pause(600);
    assert.equal((await repository.get(first.id)).readAt, undefined, "hidden tab does not acknowledge visible layout");
    await reader.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await until(async () => !!(await repository.get(first.id)).readAt, "visible incoming message becomes read");
    await until(async () => await sender.locator('[data-delivery="read"]').count() === 1, "sender polling updates to double tick");
    assert.equal(await sender.locator('[data-delivery="read"]').textContent(), "✓✓");
    assert.equal(await sender.locator('[data-delivery="read"]').getAttribute("aria-label"), "อ่านแล้ว");

    const reply = (await write(b, "message", { recordId: thread.id, text: "ตอบกลับ" })).record;
    await sender.bringToFront();
    await until(async () => await sender.getByText("ตอบกลับ", { exact: true }).count() === 1, "reply appears");
    const replyNode = sender.locator('[data-message-id="' + reply.id + '"]');
    assert.match(await replyNode.locator("small").textContent(), /โจ้ <img src=x onerror=alert\(1\)> • /);
    assert.equal(await replyNode.locator("img").count(), 0, "names are safe text");
    assert.equal(await replyNode.locator("small").textContent(), "โจ้ <img src=x onerror=alert(1)> • " + await sender.evaluate(date => new Date(date).toLocaleString("th-TH"), reply.createdAt));
    assert.equal(await sender.getByRole("button", { name: "ลบข้อความ", exact: true }).count(), 0);
    for (const width of [1000, 390, 320]) {
      await sender.setViewportSize({ width, height: 760 });
      const layout = await sender.locator(".social-thread-log").evaluate(log => {
        const box = log.getBoundingClientRect(), incoming = log.querySelector('[data-direction="incoming"]').getBoundingClientRect(), outgoing = log.querySelector('[data-direction="outgoing"]').getBoundingClientRect();
        return { left: Math.abs(incoming.left-box.left), right: Math.abs(outgoing.right-box.right), overflow: log.scrollWidth > log.clientWidth+1 };
      });
      assert(layout.left < 2 && layout.right < 2 && !layout.overflow, "incoming left / outgoing right at " + width);
      const send = await sender.getByRole("button", { name: "ส่ง", exact: true }).boundingBox(), back = await sender.getByRole("button", { name: "กลับ", exact: true }).boundingBox();
      assert(Math.abs(send.y-back.y) < 2 && back.x > send.x, "Back shares Send row at right");
      if (process.env.SOCIAL_NAVIGATION_SCREENSHOT) await sender.screenshot({ path: process.env.SOCIAL_NAVIGATION_SCREENSHOT + "-" + width + ".png" });
    }
    await sender.setViewportSize({ width: 1000, height: 760 });
    await sender.getByRole("button", { name: "กลับ", exact: true }).click();
    const conversation = sender.locator('[data-social="talk"] [data-record-id="'+thread.id+'"]');
    await conversation.waitFor(); assert.equal(await conversation.locator("h3").textContent(), "โจ้ <img src=x onerror=alert(1)>");
    assert.equal(await conversation.locator(".social-chat-preview").textContent(), "ตอบกลับ");
    assert(!(await conversation.textContent()).includes("accepted"));
    const previewReply = (await write(b, "message", { recordId: thread.id, text: "รายการแชทอัปเดตเอง" })).record;
    await until(async () => await conversation.locator(".social-chat-preview").textContent() === previewReply.text, "chat list updates without opening conversation");
    assert.equal((await repository.get(previewReply.id)).readAt, undefined, "preview does not mark a message read");
    await conversation.click();

    // Loading a page of messages is not equivalent to viewing each message.
    for (let i=0;i<18;i++) await write(a, "message", { recordId: thread.id, text: "ข้อความทดสอบ " + i });
    const offscreen = (await write(a, "message", { recordId: thread.id, text: "ยังเลื่อนไม่ถึง" })).record;
    await reader.bringToFront();
    await reader.evaluate(id => PanthoriumSocial.open("talk", { recordId: id }), thread.id);
    await reader.evaluate(() => { document.querySelector('[data-social="talk"]').scrollTop=0; });
    await pause(700);
    assert.equal((await repository.get(offscreen.id)).readAt, undefined, "offscreen message remains unread");
    await reader.locator('[data-message-id="' + offscreen.id + '"]').scrollIntoViewIfNeeded();
    await until(async () => !!(await repository.get(offscreen.id)).readAt, "scrolling to a message marks that message read");

    await reader.evaluate(() => { const cover=document.createElement('div'); cover.id='cover'; cover.style.cssText='position:fixed;inset:0;background:white;z-index:100'; document.body.append(cover); });
    const covered = (await write(a, "message", { recordId: thread.id, text: "หน้าต่างถูกบัง" })).record;
    await until(async () => await reader.getByText("หน้าต่างถูกบัง", { exact: true }).count() === 1, "covered message fetched");
    await reader.locator('[data-message-id="' + covered.id + '"]').scrollIntoViewIfNeeded();
    await pause(600);
    assert.equal((await repository.get(covered.id)).readAt, undefined, "covered message remains unread");
    await reader.evaluate(() => { document.querySelector('#cover').remove(); window.dispatchEvent(new Event('focus')); });
    await until(async () => !!(await repository.get(covered.id)).readAt, "uncovered message becomes read");
    await reader.getByLabel("ข้อความ", { exact: true }).fill("ร่างที่ยังไม่ส่ง");
    const old = await repository.get(covered.id); old.createdAt = new Date(Date.now()-3*24*60*60*1000-1000).toISOString(); await repository.put(old);
    await until(async () => await reader.locator('[data-message-id="'+covered.id+'"]').count() === 0, "expired message disappears on polling");
    assert.equal(await reader.getByLabel("ข้อความ", { exact: true }).inputValue(), "ร่างที่ยังไม่ส่ง");
    assert.deepEqual(errors, []);
    if (process.env.SOCIAL_MESSAGE_SCREENSHOT) await sender.screenshot({ path: process.env.SOCIAL_MESSAGE_SCREENSHOT });
    console.log("Talk browser: peer names/latest preview, live list updates, mobile left/right bubbles, Send/Back, no delete, 72-hour expiry, draft preservation and visible-only single/double ticks passed");
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
