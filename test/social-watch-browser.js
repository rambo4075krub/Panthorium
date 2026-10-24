"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), express = require("express");
const { randomUUID } = require("node:crypto"), { execFileSync } = require("node:child_process"), { chromium } = require("playwright");
const { AuthService } = require("../services/authService"), { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService"), { createSocialRouter } = require("../routes/social");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 16000; while (Date.now() < end) { if (await fn()) return; await pause(80); } throw Error(label); }
(async () => {
  const users = Array.from({ length: 3 }, () => { const id = randomUUID(); return { id, sub: id, roles: ["user"], permissions: ["chat"] }; });
  const [owner, friend, outsider] = users;
  const auth = new AuthService({ config: { jwtSecret: "watch-browser-test", accessTokenTtl: "1h" }, audit: { record() {} } });
  const repo = new SocialRepository({ allowMemory: true });
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=560x280:rate=3:duration=1", "-f", "gif", "pipe:1"]);
  const gif = { id: randomUUID(), name: "private-original-animation.gif", size: bytes.length, contentType: "image/gif" };
  const videoBytes = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=5:duration=2", "-c:v", "libvpx", "-b:v", "150k", "-f", "webm", "pipe:1"]);
  const video = { id: randomUUID(), name: "private-original-clip.webm", size: videoBytes.length, contentType: "video/webm" };
  const service = new SocialService({ repository: repo, files: {
    findObject: async (uid, id) => { assert.equal(uid, owner.sub); return id === video.id ? video : gif; },
    preview: async (uid, id) => id === video.id ? { ...video, body: videoBytes } : { ...gif, body: bytes },
  } }); await service.init();
  const write = (user, action, input) => service.write({ user, action, input, requestId: randomUUID() });
  for (const [i, user] of users.entries()) await write(user, "profile", { name: ["ปานเทพ", "เพื่อนทดสอบ", "ผู้ชมทดสอบ"][i], discoverable: true });
  const request = (await write(friend, "friend-request", { userId: owner.sub })).record;
  await write(owner, "friend-review", { recordId: request.id, accept: true });
  const post = (await write(owner, "publish", { module: "watch", text: "ภาพเคลื่อนไหวแสดงทันทีใน Watch", fileIds: [gif.id] })).record;
  // Old Community records still live in Watch and must auto-display media too.
  const legacy = { ...post, id: "legacy:" + randomUUID(), kind: "community", text: "GIF จากโพสต์เดิม" }; await repo.put(legacy);
  const textPost = (await write(owner, "publish", { module: "watch", text: "ข้อความ <img src=x onerror=alert(1)> แสดงตามที่เขียน" })).record;
  const short = (await write(owner, "publish", { module: "short", text: "คลิปวิดีโอใน Short", fileIds: [video.id] })).record;
  const listing = (await write(owner, "listing", { title: "สินค้าทดสอบ", text: "รายละเอียดสินค้า", priceSatang: 12900, stock: 3, fileIds: [gif.id] })).record;
  const app = express(); app.use(express.json()); app.use("/api/social", createSocialRouter(auth, service));
  app.get("/api/files", (_, res) => res.json({ ok: true, files: [gif], usedBytes: bytes.length, maxBytes: 1048576 }));
  for (const file of ["social-ui.js", "social-rtc.js"]) app.get("/" + file, (_, res) => res.sendFile(path.join(__dirname, "..", file)));
  app.get("/", (_, res) => res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#070e16;font:14px system-ui,sans-serif"><script>
    window.createWindow=(id,title,markup,opts)=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;el.style.cssText='position:fixed;inset:0;display:flex;flex-direction:column';el.innerHTML='<div style="height:48px;flex:0 0 48px;padding:14px 20px;box-sizing:border-box;background:#101e2c;color:#e4edf5;font-weight:600">PANTHORIUM · '+title+'</div><div class="window-content" style="flex:1;min-height:0">'+markup+'</div>';document.body.append(el);OS.windows.set(id,{id,el,onClose:opts.onClose});};
    window.focusWindow=id=>{const el=OS.windows.get(id)?.el;if(el)el.style.display='flex';};
  </script><script src="/social-rtc.js"></script><script src="/social-ui.js"></script></body></html>`));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve)); let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pages = [await context.newPage(), await context.newPage(), await context.newPage()], [author, reader, guest] = pages, errors = [];
    for (const [i, page] of pages.entries()) {
      page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
      await page.addInitScript(({ user, token }) => { window.OS = { state: { user }, config: { backendUrl: location.origin, accessToken: token }, windows: new Map() }; }, { user: users[i], token: auth.signAccessToken(users[i]) });
      await page.goto("http://127.0.0.1:" + server.address().port); await page.evaluate(() => PanthoriumSocial.open("watch"));
    }
    const watch = author.locator('[data-social="watch"]'), card = id => watch.locator('[data-record-id="' + id + '"]');
    for (const item of [post, legacy]) await until(async () => card(item.id).locator("img").evaluate(img => img.complete && img.naturalWidth > 0), "inline GIF rendered");
    assert.equal(await watch.getByText(gif.name, { exact: true }).count(), 0);
    assert.equal(await watch.getByRole("button", { name: /เปิดไฟล์|ดูตัวอย่าง|ดาวน์โหลดต้นฉบับ/ }).count(), 0);
    assert.equal(await card(textPost.id).locator("img,script").count(), 0, "user text is literal, not HTML");
    assert.equal(await watch.getByText("ยังไม่มีความคิดเห็น", { exact: true }).count(), 0);
    assert.equal(await card(post.id).locator(".social-comments").isVisible(), false);
    const original = card(post.id), toggle = original.getByRole("button", { name: "ความคิดเห็น 0", exact: true });
    await toggle.click();
    const draft = original.getByLabel("เขียนความคิดเห็น", { exact: true });
    await draft.fill("ร่างความคิดเห็นที่ยังไม่ส่ง");
    const imageUrl = await original.locator("img").getAttribute("src");
    await original.getByRole("button", { name: "ถูกใจ 0", exact: true }).click();
    await original.getByRole("button", { name: "ถูกใจ 1", exact: true }).waitFor();
    assert.equal(await draft.inputValue(), "ร่างความคิดเห็นที่ยังไม่ส่ง"); assert.equal(await original.locator("img").getAttribute("src"), imageUrl);
    await toggle.click(); assert(!await draft.isVisible()); await toggle.click(); assert.equal(await draft.inputValue(), "ร่างความคิดเห็นที่ยังไม่ส่ง");
    await original.getByRole("button", { name: "ลบข้อความที่กำลังเขียน", exact: true }).click(); assert.equal(await draft.inputValue(), "");
    await draft.fill("ความคิดเห็น <script>alert(1)</script>"); await original.getByRole("button", { name: "ส่ง", exact: true }).click();
    await original.getByRole("button", { name: "ความคิดเห็น 1", exact: true }).waitFor();
    assert.equal(await original.locator("[data-comment-id] script").count(), 0);
    const ownComment = (await service.read({ user: owner, recordId: post.id })).items[0];
    await reader.evaluate(id => PanthoriumSocial.open("watch", { recordId: id }), post.id);
    const readerCard = reader.locator('[data-record-id="' + post.id + '"]');
    await readerCard.getByRole("button", { name: "ความคิดเห็น 1", exact: true }).click();
    await readerCard.locator("[data-comment-id]").waitFor(); assert.equal(await readerCard.getByRole("button", { name: "ลบความคิดเห็น", exact: true }).count(), 0);
    await assert.rejects(() => write(friend, "delete", { recordId: ownComment.id }), /social_not_found/);
    await draft.fill("ล้างเฉพาะร่าง"); await original.getByRole("button", { name: "ลบข้อความที่กำลังเขียน", exact: true }).click();
    assert.equal((await service.read({ user: owner, recordId: post.id })).items.length, 1);
    await original.getByRole("button", { name: "ลบความคิดเห็น", exact: true }).click();
    await original.getByRole("button", { name: "ความคิดเห็น 0", exact: true }).waitFor(); assert.equal(await original.locator("[data-comment-id]").count(), 0);
    // Owner and viewer menus have different capabilities, all on the same action row.
    const menu = original.getByRole("button", { name: "ตัวเลือกโพสต์", exact: true }); await menu.click();
    assert.deepEqual(await original.locator(".social-post-menu-items button").allTextContents(), ["แก้ไข", "ลบ", "นำไปใช้กับ Sentinel", "คัดลอกลิงก์รายการ", "นำไปวางแผนในปฏิทิน"]);
    await author.keyboard.press("Escape"); assert.equal(await menu.getAttribute("aria-expanded"), "false");
    await menu.press("Enter"); await original.locator("p").first().click(); assert(!await original.locator(".social-post-menu").evaluate(node => node.open));
    await readerCard.getByRole("button", { name: "ตัวเลือกโพสต์", exact: true }).click();
    assert.deepEqual(await readerCard.locator(".social-post-menu-items button").allTextContents(), ["ขอสนทนากับเจ้าของ", "บล็อกเจ้าของ", "รายงาน", "นำไปใช้กับ Sentinel", "คัดลอกลิงก์รายการ", "นำไปวางแผนในปฏิทิน"]);
    await readerCard.getByRole("button", { name: "รายงาน", exact: true }).click();
    await readerCard.getByLabel("เหตุผลที่รายงาน", { exact: true }).fill("เหตุผลทดสอบ");
    await readerCard.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    assert(!await readerCard.getByLabel("เหตุผลที่รายงาน", { exact: true }).isVisible());
    // Create/cancel and real friends-only publishing through the form.
    const before = (await service.read({ user: owner, module: "watch" })).items.length;
    await watch.getByRole("button", { name: "สร้างโพสต์", exact: true }).click();
    assert.equal(await watch.getByLabel("ชื่อเรื่อง", { exact: true }).count(), 0);
    const audience = watch.getByLabel("ผู้ที่ดูได้", { exact: true }); assert(await audience.isEnabled());
    assert.deepEqual(await audience.locator("option").evaluateAll(nodes => nodes.map(node => [node.value, node.textContent])), [["public", "สาธารณะ"], ["friends", "เพื่อน"]]);
    const publishBox = await watch.getByRole("button", { name: "เผยแพร่", exact: true }).boundingBox(), cancelBox = await watch.getByRole("button", { name: "ยกเลิก", exact: true }).boundingBox();
    assert(Math.abs(publishBox.y - cancelBox.y) < 2 && cancelBox.x > publishBox.x + publishBox.width);
    await watch.getByLabel("รายละเอียด", { exact: true }).fill("ต้องไม่ถูกเผยแพร่"); await watch.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    assert.equal((await service.read({ user: owner, module: "watch" })).items.length, before);
    await watch.getByRole("button", { name: "สร้างโพสต์", exact: true }).click(); await watch.getByLabel("รายละเอียด", { exact: true }).fill("โพสต์สำหรับเพื่อนเท่านั้น");
    await watch.getByLabel("ผู้ที่ดูได้", { exact: true }).selectOption("friends"); await watch.locator("form details>summary").click();
    await watch.getByRole("checkbox", { name: gif.name, exact: true }).check();
    await watch.getByRole("button", { name: "เผยแพร่", exact: true }).click();
    let friendsPost;
    await until(async () => { friendsPost = (await service.read({ user: owner, module: "watch" })).items.find(item => item.text === "โพสต์สำหรับเพื่อนเท่านั้น"); return !!friendsPost; }, "friends post published");
    assert.equal(friendsPost.title, ""); assert.equal(friendsPost.audience, "friends");
    await reader.evaluate(id => PanthoriumSocial.open("watch", { recordId: id }), friendsPost.id);
    await reader.locator('[data-record-id="' + friendsPost.id + '"] img').waitFor();
    await guest.locator('[data-social-tab="watch"]').click(); await guest.getByRole("button", { name: "Refresh", exact: true }).click();
    assert.equal(await guest.locator('[data-record-id="' + friendsPost.id + '"]').count(), 0);
    const denied = await guest.evaluate(async ({ id, file }) => {
      const headers = { Authorization: "Bearer " + OS.config.accessToken };
      return Promise.all(["/api/social/records/" + id, "/api/social/records/" + id + "/files/" + file].map(async url => (await fetch(url, { headers })).status));
    }, { id: friendsPost.id, file: gif.id }); assert.deepEqual(denied, [404, 404]);
    await card(friendsPost.id).getByRole("button", { name: "ตัวเลือกโพสต์", exact: true }).click(); await card(friendsPost.id).getByRole("button", { name: "แก้ไข", exact: true }).click();
    assert.equal(await watch.getByLabel("ชื่อเรื่อง", { exact: true }).count(), 0);
    await watch.getByLabel("ผู้ที่ดูได้", { exact: true }).selectOption("public"); await watch.getByRole("button", { name: "บันทึก", exact: true }).click();
    await until(async () => (await service.read({ user: outsider, module: "watch" })).items.some(item => item.id === friendsPost.id), "public edit restores access");
    await author.evaluate(id => PanthoriumSocial.open("watch", { recordId: id }), post.id);
    await card(post.id).getByRole("button", { name: "ความคิดเห็น 0", exact: true }).click(); await card(post.id).getByLabel("เขียนความคิดเห็น", { exact: true }).fill("แสดงความคิดเห็นที่นี่");
    for (const width of [1280, 390, 320]) {
      await author.setViewportSize({ width, height: 900 });
      const row = card(post.id).locator(".social-post-actions"), button = row.getByRole("button", { name: "ตัวเลือกโพสต์", exact: true });
      let geometry;
      // Measure one frame: independent protocol calls can straddle responsive
      // media layout after a viewport change and mix unrelated row positions.
      try {
        await until(async () => {
          geometry = await row.evaluate(node => {
            const controls = [node, node.querySelector('[aria-label="ถูกใจ 1"]'), node.querySelector('[data-comment-toggle]'), node.querySelector('[aria-label="ตัวเลือกโพสต์"]')];
            if (controls.some(control => !control) || controls[2].textContent !== 'ความคิดเห็น 0') return null;
            return { width: innerWidth, boxes: controls.map(control => control.getBoundingClientRect().toJSON()) };
          });
          if (!geometry || geometry.width !== width || geometry.boxes.some(box => !box.width || !box.height)) return false;
          const [rowBox, likeBox, commentBox, moreBox] = geometry.boxes;
          return Math.abs(likeBox.y - commentBox.y) < 3 && Math.abs(likeBox.y - moreBox.y) < 5 && Math.abs(rowBox.x + rowBox.width - moreBox.x - moreBox.width) < 3;
        }, `actions share one row and menu stays at far right at ${width}px`);
      } catch (error) {
        throw new Error(`${error.message}; last geometry: ${JSON.stringify(geometry)}`);
      }
      await button.click(); const box = await card(post.id).locator(".social-post-menu-items").boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width, "dropdown stays inside viewport");
      assert(await watch.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "no mobile content overflow");
      if (process.env.SOCIAL_WATCH_SCREENSHOT) await author.screenshot({ path: process.env.SOCIAL_WATCH_SCREENSHOT + "-" + width + ".png" });
      await author.keyboard.press("Escape");
    }
    for (const module of ["watch", "profile"]) assert.equal(await author.locator('[data-social-tab="' + module + '"] [data-social-module-count]').textContent(), "1");
    // The same card controls in Short and Market preserve video playback and ordering.
    await author.setViewportSize({ width: 1280, height: 900 });
    for (const [module, item] of [["short", short], ["market", listing]]) {
      await author.evaluate(module => PanthoriumSocial.open(module), module);
      const pane = author.locator('[data-social="' + module + '"]'), entry = pane.locator('[data-record-id="' + item.id + '"]');
      assert.equal(await entry.getByRole("button", { name: /เปิดไฟล์|ดูตัวอย่าง|ดาวน์โหลดต้นฉบับ/ }).count(), 0);
      assert(!await entry.locator(".social-comments").isVisible());
      await entry.getByRole("button", { name: "ความคิดเห็น 0", exact: true }).click();
      await entry.getByLabel("เขียนความคิดเห็น", { exact: true }).fill("ความคิดเห็นใน " + module);
      await entry.getByRole("button", { name: "ส่ง", exact: true }).click(); await entry.getByRole("button", { name: "ความคิดเห็น 1", exact: true }).waitFor();
      await entry.getByRole("button", { name: "ลบความคิดเห็น", exact: true }).click(); await entry.getByRole("button", { name: "ความคิดเห็น 0", exact: true }).waitFor();
      if (module === "short") {
        const clip = entry.locator("video"); await clip.evaluate(async node => { node.muted = true; await node.play(); });
        await entry.getByLabel("เขียนความคิดเห็น", { exact: true }).fill("ร่างระหว่างดูคลิป"); const src = await clip.getAttribute("src");
        await entry.getByRole("button", { name: "ถูกใจ 0", exact: true }).click(); await entry.getByRole("button", { name: "ถูกใจ 1", exact: true }).waitFor();
        assert.equal(await clip.getAttribute("src"), src); assert.equal(await entry.getByLabel("เขียนความคิดเห็น", { exact: true }).inputValue(), "ร่างระหว่างดูคลิป");
        await entry.getByRole("button", { name: "ตัวเลือกโพสต์", exact: true }).click(); assert(await entry.getByRole("button", { name: "เพิ่มลงเพลย์ลิสต์", exact: true }).isVisible()); await author.keyboard.press("Escape");
      } else {
        await reader.evaluate(() => PanthoriumSocial.open("market"));
        const product = reader.locator('[data-record-id="' + item.id + '"]'); await product.getByLabel("จำนวน", { exact: true }).fill("1");
        await product.getByRole("button", { name: "ส่งคำขอสั่งซื้อ", exact: true }).click();
        await until(async () => (await service.inbox({ user: friend })).orders.length === 1, "order remains functional");
      }
      for (const width of [390, 320]) {
        await author.setViewportSize({ width, height: 900 }); await entry.getByRole("button", { name: "ตัวเลือกโพสต์", exact: true }).click();
        assert(await pane.evaluate(node => node.scrollWidth <= node.clientWidth + 1), module + " mobile layout");
        if (process.env.SOCIAL_WATCH_SCREENSHOT) await author.screenshot({ path: process.env.SOCIAL_WATCH_SCREENSHOT + "-" + module + "-" + width + ".png" }); await author.keyboard.press("Escape");
      }
      await pane.locator(".social-toolbar").getByRole("button", { name: module === "short" ? "โพสต์วิดีโอ" : "ลงสินค้า", exact: true }).click();
      assert.equal(await pane.getByLabel("ชื่อเรื่อง", { exact: true }).count(), 0);
      if (module === "market") assert(await pane.getByLabel("ชื่อสินค้า", { exact: true }).isVisible());
      await pane.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    }
    // Live reuses live-chat; joining remains explicit and owner cameras start only then.
    await author.evaluate(() => PanthoriumSocial.open("live"));
    const livePane = author.locator('[data-social="live"]'); await livePane.getByRole("button", { name: "เริ่มไลฟ์", exact: true }).click();
    await livePane.getByLabel("ชื่อไลฟ์", { exact: true }).fill("ไลฟ์ที่ยกเลิก"); await livePane.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    assert.equal((await service.read({ user: owner, module: "live" })).items.length, 0);
    await livePane.getByRole("button", { name: "เริ่มไลฟ์", exact: true }).click(); await livePane.getByLabel("ชื่อไลฟ์", { exact: true }).fill("ไลฟ์ทดสอบหน้าตาใหม่");
    await livePane.getByRole("button", { name: "เริ่มถ่ายทอดสด", exact: true }).click();
    let live; await until(async () => { live = (await service.read({ user: owner, module: "live" })).items[0]; return !!live; }, "live created");
    await livePane.locator("[data-social-rtc] video").waitFor();
    await reader.evaluate(() => PanthoriumSocial.open("live")); const liveCard = reader.locator('[data-record-id="' + live.id + '"]');
    await liveCard.getByRole("button", { name: "ความคิดเห็น 0", exact: true }).click(); await liveCard.getByText("เข้าชมไลฟ์เพื่อแสดงความคิดเห็น", { exact: true }).waitFor();
    assert(!await liveCard.getByLabel("เขียนความคิดเห็น", { exact: true }).isVisible());
    await liveCard.getByRole("button", { name: "เข้าชมไลฟ์", exact: true }).click();
    await until(async () => (await repo.get(live.id)).members.includes(friend.sub), "viewer joined");
    await liveCard.getByRole("button", { name: "ความคิดเห็น 0", exact: true }).click(); await liveCard.getByLabel("เขียนความคิดเห็น", { exact: true }).fill("แชตสดจากผู้ชม");
    await liveCard.getByRole("button", { name: "ส่ง", exact: true }).click(); await liveCard.getByRole("button", { name: "ความคิดเห็น 1", exact: true }).waitFor();
    const ownLive = livePane.locator('[data-record-id="' + live.id + '"]'); await ownLive.getByRole("button", { name: /^ความคิดเห็น / }).click();
    await ownLive.getByText("แชตสดจากผู้ชม", { exact: true }).waitFor(); await ownLive.getByLabel("เขียนความคิดเห็น", { exact: true }).fill("ร่างเจ้าของไลฟ์");
    await liveCard.getByRole("button", { name: "ลบความคิดเห็น", exact: true }).click(); await ownLive.getByRole("button", { name: "ความคิดเห็น 0", exact: true }).waitFor();
    assert.equal(await ownLive.getByLabel("เขียนความคิดเห็น", { exact: true }).inputValue(), "ร่างเจ้าของไลฟ์");
    await ownLive.getByRole("button", { name: "ถูกใจ 0", exact: true }).click(); await ownLive.getByRole("button", { name: "ถูกใจ 1", exact: true }).waitFor();
    await ownLive.getByRole("button", { name: "ตัวเลือกโพสต์", exact: true }).click();
    assert(await livePane.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    if (process.env.SOCIAL_WATCH_SCREENSHOT) await author.screenshot({ path: process.env.SOCIAL_WATCH_SCREENSHOT + "-live-320.png" });
    await ownLive.getByRole("button", { name: "จบไลฟ์", exact: true }).click(); await until(async () => (await repo.get(live.id)).status === "ended", "owner ends live from menu");
    assert.deepEqual(errors, []);
    console.log("Social feeds browser: inline Watch/GIF/Short/Market media, shared menus and counted comments, friends-only publishing, drafts/playback, order flow, real Live UI join/chat/delete/end and desktop/320/390 layouts passed");
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
