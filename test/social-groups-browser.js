"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const express = require("express");
const { chromium } = require("playwright");
const { AuthService } = require("../services/authService");
const { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService");
const { CloudFilesService } = require("../services/cloudFilesService");
const { createSocialRouter } = require("../routes/social");
const { createFilesRouter } = require("../routes/files");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const end = Date.now() + 16000; while (Date.now() < end) { if (await check()) return; await pause(100); } throw Error(label); }
(async () => {
  const auth = new AuthService({ config: { jwtSecret: "group-browser-fixture", accessTokenTtl: "1h" }, audit: { record() {} } });
  const users = Array.from({ length: 3 }, () => { const id = randomUUID(); return { id, sub: id, roles: ["user"], permissions: ["chat"] }; });
  const [owner, member, outsider] = users, stored = [], charges = [];
  const files = new CloudFilesService({ bucket: "group-test-files", entitlements: {
    locked: async (uid, fn) => fn({}), stateIn: async () => ({ remaining: { storageBytes: 1024 * 1024 } }),
    state: async () => ({ remaining: { downloadBytes: 1024 * 1024 } }), consume: async (uid, usage) => charges.push({ uid, usage }),
  } });
  files.listAll = async uid => stored.filter(f => f.owner === uid);
  files.findObject = async (uid, id) => { const file = stored.find(f => f.owner === uid && f.id === id); if (!file) throw Error("file_not_found"); return file; };
  files.request = async options => {
    if (options.method === "POST") {
      const [uid, , id, name] = options.params.name.split("/").slice(1);
      stored.push({ owner: uid, id, name, size: options.data.length, contentType: options.headers["Content-Type"], body: options.data, objectName: options.params.name }); return {};
    }
    const objectName = decodeURIComponent(options.url.split("/o/")[1]);
    const file = stored.find(f => f.objectName === objectName); if (!file) throw Error("file_not_found"); return file.body;
  };
  const repo = new SocialRepository({ allowMemory: true }), social = new SocialService({ repository: repo, files }); await social.init();
  const write = (user, action, input) => social.write({ user, action, input, requestId: randomUUID() });
  for (const [i, user] of users.entries()) await write(user, "profile", { name: ["ผู้สร้าง", "เพื่อน <img src=x onerror=alert(1)>", "ผู้เยี่ยมชม"][i], discoverable: true });
  const app = express(); app.use(express.json()); app.use("/api/social", createSocialRouter(auth, social)); app.use("/api/files", createFilesRouter(auth, files));
  app.get("/social-ui.js", (_, res) => res.sendFile(path.join(__dirname, "../social-ui.js")));
  app.get("/", (_, res) => res.type("html").send(`<!doctype html><html><body style="margin:0"><div id="sm-apps"></div><div id="start-menu"></div><script>
    window.createWindow=(id,title,markup,opts)=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;el.style.cssText='position:fixed;inset:0;width:min(940px,100vw);height:100dvh;z-index:10';el.innerHTML=markup;document.body.append(el);OS.windows.set(id,{el,onClose:opts.onClose});};window.focusWindow=()=>{};
  </script><script src="/social-ui.js"></script></body></html>`));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const pages = await Promise.all(users.map(() => context.newPage()));
    const [creator, reader, visitor] = pages, errors = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]; page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ user, token }) => { window.OS = { state: { user }, config: { backendUrl: location.origin, accessToken: token }, windows: new Map() }; }, { user: users[i], token: auth.signAccessToken(users[i]) });
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.evaluate(() => PanthoriumSocial.open("community"));
    }
    await creator.bringToFront(); await creator.locator("[data-social-toolbar]").getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
    await creator.getByLabel("ชื่อ", { exact: true }).fill("ทีมทดสอบกลุ่มปิด");
    await creator.getByLabel("ประเภทกลุ่ม").selectOption("closed");
    await creator.getByLabel("คำอธิบายกลุ่ม").fill("แชตและแชร์ไฟล์สำหรับสมาชิก");
    await creator.locator("#social-community-panel form").getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
    await creator.locator("[data-group-composer]").waitFor();
    const group = (await social.collections({ user: owner, kind: "group" })).items[0];
    const readerToolbar = reader.locator("[data-social-toolbar]");
    assert.equal(await readerToolbar.getByRole("button", { name: "กลุ่มของฉัน", exact: true }).getAttribute("aria-expanded"), "true");
    assert.equal(await reader.locator("[data-group-id]").count(), 0);
    await readerToolbar.getByRole("button", { name: "กลุ่มทั้งหมด", exact: true }).click();
    await reader.locator('[data-group-id="'+group.id+'"]').waitFor();
    assert.equal(await reader.locator(".window").count(), 1);
    await readerToolbar.getByRole("button", { name: "กลุ่มของฉัน", exact: true }).click();
    await reader.getByText("คุณยังไม่ได้เข้าร่วมกลุ่ม เลือกกลุ่มทั้งหมดเพื่อค้นหากลุ่ม หรือสร้างกลุ่มของคุณ", { exact: true }).waitFor();
    for (const page of [reader, visitor]) await page.evaluate(id => PanthoriumSocial.open("community", { recordId: id }), group.id);
    assert.equal(await reader.locator("[data-group-composer]").count(), 0);
    await reader.getByRole("button", { name: "ขอเข้าร่วมกลุ่ม", exact: true }).click();
    await reader.getByText("ส่งคำขอแล้ว รอผู้สร้างกลุ่มอนุมัติ", { exact: true }).waitFor();
    await reader.evaluate(() => { document.querySelector(".window").style.display = "none"; });
    const request = creator.locator("[data-group-request]");
    await request.waitFor(); assert.match(await request.textContent(), /เพื่อน <img/); assert.equal(await request.locator("img").count(), 0);
    await request.getByRole("button", { name: "อนุมัติ", exact: true }).click();
    await until(async () => await reader.locator("[data-group-composer]").count() === 1, "approval refreshes the waiting member automatically");
    assert.equal(await visitor.locator("[data-group-composer]").count(), 0);
    creator.on("dialog", dialog => dialog.accept());
    const composer = creator.locator("[data-group-composer]");
    await composer.getByLabel("ข้อความในกลุ่ม", { exact: true }).fill("ข้อความพร้อมรูป วิดีโอ และเอกสาร");
    await composer.locator("summary").click();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yZ8AAAAASUVORK5CYII=", "base64");
    const video = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.4:r=5", "-c:v", "libvpx", "-f", "webm", "pipe:1"]);
    for (const file of [{ name: "photo.png", mimeType: "image/png", buffer: png }, { name: "clip.webm", mimeType: "video/webm", buffer: video }, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("group document") }]) {
      await composer.locator('input[type="file"]').setInputFiles(file);
      await composer.getByRole("button", { name: file.name + " ×", exact: true }).waitFor();
    }
    assert.equal(stored.length, 3);
    await composer.getByRole("button", { name: "ส่ง", exact: true }).click();
    await creator.getByText("ข้อความพร้อมรูป วิดีโอ และเอกสาร", { exact: true }).waitFor();
    const sent = (await social.read({ user: owner, recordId: group.id })).items[0];
    assert.equal(sent.files.length, 3); assert.equal(sent.readCount, 0);
    assert.equal(await composer.locator('input[type="checkbox"]:checked').count(), 0, "sending clears selected attachments");
    assert.equal(stored.length, 3, "sharing references Cloud Files without duplicating storage");
    await reader.bringToFront(); await reader.evaluate(() => { document.querySelector(".window").style.display = ""; window.dispatchEvent(new Event("focus")); });
    const node = reader.locator('[data-message-id="' + sent.id + '"]'); await node.waitFor();
    await node.evaluate(el => el.scrollIntoView({ block: "start" }));
    await until(async () => await node.locator("img").evaluate(el => el.complete && el.naturalWidth > 0), "image renders inline");
    await until(async () => await node.locator("video").evaluate(el => el.readyState >= 1), "shared video loads metadata");
    await node.locator("video").evaluate(el => { window.groupVideo = el; });
    await until(async () => !!(await repo.get(sent.id)).readBy?.[member.sub], "visible message gets member receipt");
    await until(async () => await creator.locator('[data-delivery="read"]').getAttribute("aria-label") === "อ่านแล้ว 1 คน", "sender receives per-member double tick");
    await write(owner, "group-message", { recordId: group.id, text: "อัปเดตระหว่างดูวิดีโอ" });
    await reader.getByText("อัปเดตระหว่างดูวิดีโอ", { exact: true }).waitFor();
    assert(await node.locator("video").evaluate(el => el === window.groupVideo), "polling preserves the video player");
    const doc = node.locator(".social-media").filter({ hasText: "notes.txt" });
    const downloaded = reader.waitForEvent("download"); await doc.getByRole("button", { name: "ดาวน์โหลดต้นฉบับ", exact: true }).click();
    assert.equal((await downloaded).suggestedFilename(), "notes.txt"); assert(charges.some(x => x.uid === member.sub && x.usage.downloadBytes));
    for (const width of [320, 390]) {
      await reader.setViewportSize({ width, height: 800 });
      assert(await reader.locator("[data-social=community]").evaluate(el => el.scrollWidth <= el.clientWidth + 1), "group fits mobile viewport");
    }
    await reader.getByRole("button", { name: "ออกจากกลุ่ม", exact: true }).click();
    await reader.getByRole("button", { name: "ขอเข้าร่วมกลุ่ม", exact: true }).waitFor();
    assert.equal(await reader.locator("[data-message-id]").count(), 0);
    const denied = await reader.evaluate(async ({ id, fileId }) => {
      const res = await fetch("/api/social/records/" + id + "/files/" + fileId, { headers: { Authorization: "Bearer " + OS.config.accessToken } }); return res.status;
    }, { id: sent.id, fileId: sent.files[0].id });
    assert.equal(denied, 404, "leaving revokes file access over HTTP");
    await creator.locator("[data-social-toolbar]").getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
    await creator.getByLabel("ชื่อ", { exact: true }).fill("ทีมเปิด");
    await creator.locator("#social-community-panel form").getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
    await creator.getByRole("heading", { name: "ทีมเปิด", exact: true }).waitFor();
    const open = (await social.collections({ user: owner, kind: "group" })).items.find(x => x.title === "ทีมเปิด");
    await visitor.evaluate(id => PanthoriumSocial.open("community", { recordId: id }), open.id);
    await visitor.getByRole("button", { name: "เข้าร่วมกลุ่ม", exact: true }).click();
    await visitor.locator("[data-group-composer]").waitFor();
    assert.equal((await social.read({ user: outsider, recordId: open.id })).record.membership, "member");
    const template = await repo.get(sent.id);
    for (let i = 0; i < 101; i++) await repo.put({ ...template, id: String(Date.now() - 10000 + i).padStart(16, "0") + "-" + randomUUID(), parentId: open.id, text: "ประวัติ " + i, files: [], readBy: {} });
    await visitor.evaluate(id => PanthoriumSocial.open("community", { recordId: id }), open.id);
    await visitor.getByRole("button", { name: "โหลดข้อความก่อนหน้า", exact: true }).click();
    await visitor.getByText("ประวัติ 0", { exact: true }).waitFor();
    await visitor.getByRole("textbox", { name: "ข้อความในกลุ่ม", exact: true }).fill("ร่างที่ยังไม่ส่ง");
    await write(owner, "group-message", { recordId: open.id, text: "ข้อความระหว่างพิมพ์" });
    await visitor.getByText("ข้อความระหว่างพิมพ์", { exact: true }).waitFor();
    assert.equal(await visitor.getByRole("textbox", { name: "ข้อความในกลุ่ม", exact: true }).inputValue(), "ร่างที่ยังไม่ส่ง", "polling preserves drafts");
    await visitor.getByText("ประวัติ 0", { exact: true }).waitFor();
    await visitor.reload(); await visitor.evaluate(() => PanthoriumSocial.open("community"));
    await visitor.locator('[data-group-id="'+open.id+'"]').waitFor();
    assert.equal(await visitor.locator('[data-group-id="'+group.id+'"]').count(), 0, "default shows joined groups only");
    await visitor.locator('[data-group-id="'+open.id+'"]').getByRole("button", { name: "เปิด", exact: true }).click();
    await visitor.locator("[data-group-composer]").waitFor();
    assert.deepEqual(errors, []);
    console.log("Community group browser: open/closed creation, approval, named applicants, chat/image/video/file upload+download, quota reuse, receipts, leave, mobile layout, history and drafts passed");
  } finally {
    if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
