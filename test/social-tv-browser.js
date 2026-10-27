"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), os = require("node:os"), express = require("express");
const { randomUUID } = require("node:crypto"), { execFileSync } = require("node:child_process"), { chromium } = require("playwright");
const { AuthService } = require("../services/authService"), { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService"), { createSocialRouter } = require("../routes/social");
const { OFFICIAL_CHANNELS } = require("../services/socialTv");
async function until(fn, label) { const end = Date.now() + 15000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); } throw Error(label); }
(async () => {
  const users = Array.from({ length: 3 }, () => { const id = randomUUID(); return { id, sub: id, roles: ["user"], permissions: ["chat"] }; });
  users[1].roles = ["administrator"]; users[1].permissions.push("settings");
  const auth = new AuthService({ config: { jwtSecret: "tv-browser-test-only", accessTokenTtl: "1h" }, audit: { record() {} } });
  const social = new SocialService({ repository: new SocialRepository({ allowMemory: true }), files: {} }); await social.init();
  await social.write({ user: users[0], action: "profile", input: { name: "ผู้ให้บริการทดสอบ", discoverable: true } });
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "panthorium-tv-test-"));
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15:duration=4", "-c:v", "libvpx-vp9", "-b:v", "200k", "-g", "15", "-hls_segment_type", "fmp4", "-hls_time", "1", "-hls_list_size", "0", path.join(mediaDir, "live.m3u8")]);
  const video = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=5:duration=3", "-c:v", "libvpx", "-f", "webm", "pipe:1"]);
  const app = express(); app.use(express.json()); app.use("/api/social", createSocialRouter(auth, social));
  app.get("/api/files", (_, res) => res.json({ files: [], usedBytes: 0, maxBytes: 20000000 }));
  for (const file of ["social-ui.js", "social-media-source.js", "social-player.html", "social-player.js", "voice-window-catalog.js", "voice-command-client.js"]) app.get("/" + file, (_, res) => res.sendFile(path.join(__dirname, "..", file)));
  app.get("/vendor/hls.min.js", (_, res) => res.sendFile(require.resolve("hls.js/dist/hls.min.js")));
  app.get("/", (_, res) => res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080f18;font:14px system-ui"><script>
    window.createWindow=(id,title,markup,opts)=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;el.style.cssText='position:fixed;inset:0;display:flex;flex-direction:column';el.innerHTML='<div style="height:48px;flex:0 0 48px;padding:14px 20px;box-sizing:border-box;background:#101e2c;color:#e4edf5;font-weight:600">PANTHORIUM · '+title+'</div><div class="window-content" style="flex:1;min-height:0">'+markup+'</div>';document.body.append(el);OS.windows.set(id,{id,el,onClose:opts.onClose});}; window.focusWindow=()=>{};
  </script><script src="/voice-window-catalog.js"></script><script src="/voice-command-client.js"></script><script src="/social-ui.js"></script></body></html>`));
  const server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r)); let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.route("https://tv.trueid.net/th-th/embed/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Provider player fixture</title><p>Free TV player</p>" }));
    const pages = await Promise.all(users.map(() => context.newPage())), [provider, admin, viewer] = pages, errors = [];
    await context.route("https://media.example.org/**", async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      const body = name === "long.webm" ? video : fs.readFileSync(path.join(mediaDir, name));
      await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: name.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : name.endsWith("ts") ? "video/mp2t" : "video/webm", body });
    });
    for (const [i, page] of pages.entries()) {
      page.on("pageerror", e => errors.push(e.message));
      if (process.env.DEBUG_VIDEO) { page.on("console", m => console.log(m.type(), m.text())); page.on("requestfailed", r => console.log("requestfailed", r.url(), r.failure())); } page.on("dialog", d => d.accept());
      await page.addInitScript(({ user, token }) => { window.OS = { state: { user }, config: { accessToken: token }, windows: new Map() }; }, { user: users[i], token: auth.signAccessToken(users[i]) });
      await page.goto("http://127.0.0.1:" + server.address().port); await page.evaluate(() => PanthoriumSocial.open("tv"));
    }
    const tv = provider.locator('[data-social="tv"]');
    assert.equal(await tv.locator("[data-tv-channel]").count(), OFFICIAL_CHANNELS.length);
    assert.deepEqual(await provider.locator("[data-social-tab]").evaluateAll(nodes => nodes.map(n => n.firstChild.textContent)), ["Feed", "Short", "Watch", "Live", "TV", "Market", "Community", "Chat", "Connect", "Profile", "Friends", "🔔 การแจ้งเตือนรวม"]);
    assert.equal(await provider.getByRole("button", { name: "Refresh", exact: true }).textContent(), "↻");
    assert.equal(await tv.getByRole("button", { name: "ตรวจสอบช่อง", exact: true }).count(), 0);
    assert.equal(await tv.getByRole("link", { name: "เปิดเว็บไซต์ต้นทาง", exact: true }).first().getAttribute("target"), "_blank");
    const readyChannel = tv.locator('[data-tv-channel="tv:thaipbs"]');
    await readyChannel.scrollIntoViewIfNeeded();
    assert.equal(await readyChannel.getByRole("button", { name: "▶ เล่นใน Panthorium", exact: true }).count(),0);
    const embedded = readyChannel.frameLocator("iframe").locator('iframe[title="TrueID Free TV player"]');
    await embedded.waitFor();
    assert.equal(await embedded.getAttribute("src"), "https://tv.trueid.net/th-th/embed/thaipbs?autoplay=1&muted=1");
    assert((await embedded.getAttribute("allow")).includes("autoplay"));
    await provider.locator('[data-social-tab="feed"]').click();
    assert.equal(await readyChannel.locator("iframe").count(), 0, "free TV stops when switching tabs");
    await provider.locator('[data-social-tab="tv"]').click();
    await tv.getByRole("button", { name: "เพิ่มช่อง TV", exact: true }).click();
    await tv.getByLabel("ชื่อช่อง", { exact: true }).fill("ช่องทดสอบสด");
    await tv.getByLabel("ผู้ให้บริการ / สถานี", { exact: true }).fill("สถานีทดสอบ");
    await tv.getByLabel("เว็บไซต์ทางการ / หน้าชมสด", { exact: true }).fill("https://station.example.org/live");
    await tv.getByLabel("รูปแบบการรับชม", { exact: true }).selectOption("hls");
    await tv.getByLabel("ลิงก์สัญญาณ / วิดีโอ", { exact: true }).fill("https://media.example.org/live.m3u8");
    await tv.getByLabel("ช่องทางติดต่อผู้ให้บริการ (เฉพาะผู้ดูแลเห็น)", { exact: true }).fill("private@example.org");
    await tv.getByLabel("ฉันเป็นผู้ให้บริการหรือได้รับอนุญาตให้เผยแพร่ช่องและใช้สัญญาณนี้", { exact: true }).check();
    await tv.getByRole("button", { name: "ส่งช่องให้ตรวจสอบ", exact: true }).click();
    await tv.getByText("สถานะ: รอตรวจสอบ", { exact: true }).waitFor();
    const channel = (await social.read({ user: users[0], module: "tv", mode: "mine" })).items[0];
    assert(!(await social.read({ user: users[2], module: "tv" })).items.some(c => c.id === channel.id));
    const atv = admin.locator('[data-social="tv"]');
    await atv.getByRole("button", { name: "ตรวจสอบช่อง", exact: true }).click();
    await atv.getByText("ติดต่อ: private@example.org", { exact: true }).waitFor();
    await atv.getByRole("button", { name: "อนุมัติช่อง", exact: true }).click();
    await until(async () => (await social.repo.get(channel.id)).status === "approved", "channel approved");
    await viewer.getByRole("button", { name: "Refresh", exact: true }).click();
    const shown = viewer.locator('[data-tv-channel="' + channel.id + '"]'); await shown.waitFor();
    assert(!(await shown.textContent()).includes("private@example.org"));
    await shown.scrollIntoViewIfNeeded();
    const stream = shown.frameLocator("iframe").locator("video");
    await until(async () => stream.evaluate(v => v.readyState >= 2), "HLS stream decodes in Chromium").catch(async e => { console.error(await stream.evaluate(v => ({ readyState: v.readyState, networkState: v.networkState, error: v.error?.message, status: document.getElementById("status").textContent, hls: Hls.isSupported(), codec: MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"') }))); throw e; });
    await stream.evaluate(v => v.play());
    await until(async () => stream.evaluate(v => v.currentTime > 0.2), "HLS plays");
    await viewer.locator('[data-social-tab="feed"]').click();
    assert.equal(await shown.locator("iframe").count(), 0, "switching tabs releases external player and stream");
    await viewer.locator('[data-social-tab="tv"]').click();
    await shown.getByRole("button", { name: "☆ เพิ่มช่องโปรด", exact: true }).click();
    await viewer.locator('[data-social="tv"]').getByRole("button", { name: "ช่องโปรด", exact: true }).click(); await shown.waitFor();
    await viewer.reload(); await viewer.evaluate(() => PanthoriumSocial.open("tv"));
    await viewer.locator('[data-social="tv"]').getByRole("button", { name: "ช่องโปรด", exact: true }).click(); await shown.waitFor();
    assert.equal(await viewer.locator("[data-tv-channel]").count(), 1, "favorites persist on reload");
    await provider.evaluate(() => PanthoriumSocial.openWatch());
    const watch = provider.locator('[data-social="watch"]');
    await watch.getByRole("button", { name: "โพสต์วิดีโอ", exact: true }).click();
    await watch.getByLabel("ชื่อเรื่อง", { exact: true }).fill("วิดีโอยาวทดสอบ");
    await watch.getByLabel("แหล่งวิดีโอ", { exact: true }).selectOption("video");
    await watch.getByLabel("ลิงก์วิดีโอ (ไม่ต้องกรอกหากแนบไฟล์)", { exact: true }).fill("https://media.example.org/long.webm");
    await watch.getByRole("button", { name: "เผยแพร่", exact: true }).click();
    await watch.getByRole("heading", { name: "วิดีโอยาวทดสอบ", exact: true }).waitFor();
    await watch.locator("[data-social-player]").scrollIntoViewIfNeeded();
    await until(async () => watch.frameLocator("iframe").locator("video").evaluate(v => v.readyState >= 2), "Watch video loads");
    const ids = ["feed", "short", "watch", "live", "tv", "market", "community", "talk", "connect", "profile", "friends"];
    for (const width of [390, 320]) {
      await provider.setViewportSize({ width, height: 800 });
      for (const id of ids) {
        await provider.evaluate(id => PanthoriumSocial.open(id), id);
        assert(await provider.locator('[data-social="' + id + '"]').evaluate(n => n.scrollWidth <= n.clientWidth + 1), id + " overflow at " + width);
      }
    }
    await provider.evaluate(() => PanthoriumVoiceCommands.windowAction("open_social_tv"));
    assert.equal(await provider.locator(".window").getAttribute("data-social-active"), "tv");
    if (process.env.SOCIAL_TV_SCREENSHOT) {
      await provider.locator('[data-social="tv"]').getByRole("button", { name: "ช่องทั้งหมด", exact: true }).click();
      await provider.locator('[data-tv-channel="tv:thaipbs"]').waitFor();
      await provider.screenshot({ path: process.env.SOCIAL_TV_SCREENSHOT + "-mobile.png" });
      await provider.setViewportSize({ width: 1280, height: 850 }); await provider.screenshot({ path: process.env.SOCIAL_TV_SCREENSHOT + "-desktop.png" });
    }
    assert.deepEqual(errors, []);
    console.log("TV browser: provider submission/review, private contacts, durable favorites, real HLS + Watch video playback, player teardown, ordered tabs/voice and 320/390 layouts passed");
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(mediaDir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
