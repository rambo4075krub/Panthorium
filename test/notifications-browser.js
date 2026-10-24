"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const express = require("express");
const { chromium } = require("playwright");
const { AuthService } = require("../services/authService");
const { NotificationRepository } = require("../services/notificationRepository");
const { NotificationService } = require("../services/notificationService");
const { createNotificationRouter } = require("../routes/notifications");
const { ReminderRepository } = require("../services/reminderRepository");
const { ReminderService } = require("../services/reminderService");
const { createReminderRouter } = require("../routes/reminders");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(50);
  }
  throw Error(message);
}

(async () => {
  const users = Array.from({ length: 2 }, () => {
    const id = randomUUID();
    return { id, sub: id, roles: ["user"], permissions: ["chat"] };
  });
  const [a, b] = users;
  const auth = new AuthService({ config: { jwtSecret: "system-notifications-browser-test", accessTokenTtl: "1h" }, audit: { record() {} } });
  const notifications = new NotificationService({ repository: new NotificationRepository({ allowMemory: true }) });
  await notifications.init();
  const reminders = new ReminderService({ repository: new ReminderRepository(), authService: auth });
  await reminders.init();
  const unsafeTitle = 'เสร็จแล้ว <img src=x onerror="window.notificationXss=true">';
  const initial = await notifications.publish({ userId: a.sub, category: "operations", type: "test.complete", title: unsafeTitle, body: "รายละเอียดบัญชีแรก", sourceId: "initial" });
  const other = await notifications.publish({ userId: b.sub, category: "security", type: "test.security", title: "บัญชีที่สองเท่านั้น", body: "ข้อมูลของบัญชีที่สอง", sourceId: "other" });
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", createNotificationRouter(auth, notifications));
  app.use("/api/reminders", createReminderRouter(auth, reminders));
  for (const file of ["notifications-ui.js", "reminders-ui.js"]) app.get("/" + file, (_, res) => res.sendFile(path.join(__dirname, "..", file)));
  app.get("/", (_, res) => res.type("html").send(`<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{--text:#e8eef5;--text-dim:#98abc0;--bg:#0a1220;}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}.window{position:fixed;inset:0 0 42px;display:flex;flex-direction:column}.window-content{flex:1;min-height:0;overflow:hidden}#taskbar{position:fixed;inset:auto 0 0;height:42px;display:flex;align-items:center}
  </style></head><body><div id="taskbar"><div id="system-controls-left"></div></div><script>
    window.toasts=[];window.toast=text=>toasts.push(text);
    window.authorizedFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+OS.config.accessToken}});
    window.createWindow=(id,title,markup,options={})=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;const heading=document.createElement('div');heading.style.cssText='padding:10px 16px;flex:none;background:#142034';heading.textContent=title;const content=document.createElement('div');content.className='window-content';content.innerHTML=markup;el.append(heading,content);document.body.append(el);OS.windows.set(id,{id,el,onClose:options.onClose});};
    window.focusWindow=id=>{const el=OS.windows.get(id)?.el;if(el)el.style.display='flex';};
    window.closeWindow=id=>{const win=OS.windows.get(id);win?.onClose?.();win?.el.remove();OS.windows.delete(id);};
  </script><script src="/notifications-ui.js"></script><script src="/reminders-ui.js"></script></body></html>`));
  app.use((error, _, res, __) => res.status(error.status || 500).json({ ok: false, error: error.code || error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ user, token }) => {
      window.OS = { state: { user }, config: { backendUrl: location.origin, accessToken: token }, windows: new Map() };
    }, { user: a, token: auth.signAccessToken(a) });
    await page.goto(base);
    await page.evaluate(() => PanthoriumReminders.open());

    await page.waitForFunction(() => window.PanthoriumNotifications?.getState()?.settings);
    const root = page.locator("[data-notifications-root]");
    const center = root.getByRole("region", { name: "ศูนย์แจ้งเตือน" });
    const setting = key => root.locator('[data-notification-setting="' + key + '"]');
    const row = id => center.locator('[data-notification-id="' + id + '"]');
    const checked = async (key, value) => {
      const control = setting(key);
      await until(async () => await control.getAttribute("aria-checked") === String(value) && !await control.isDisabled(), "setting persisted: " + key);
    };
    const toggle = async (key, value) => {
      if (await setting(key).getAttribute("aria-checked") !== String(value)) await setting(key).click();
      await checked(key, value);
    };
    const refresh = () => page.evaluate(() => PanthoriumNotifications.refresh());
    const clearToast = () => page.evaluate(() => document.querySelector("[data-notification-toast]")?.remove());
    const publish = async (sourceId, category = "system", body = "เนื้อหาทดสอบส่วนตัว") => {
      const result = await notifications.publish({ userId: a.sub, category, type: "test.notice", title: "รายการ " + sourceId, body, sourceId });
      await refresh(); return result;
    };

    await row(initial.id).getByText(unsafeTitle, { exact: true }).waitFor();
    assert.equal(await row(initial.id).locator("img,script").count(), 0, "notification content is rendered as inert text");
    assert.equal(await page.evaluate(() => window.notificationXss), undefined);
    assert.equal(await row(other.id).count(), 0, "another account's notification is absent");
    assert.equal(await page.locator("[data-notification-toast]").count(), 0, "opening an account does not replay historical alerts");
    assert.equal(await page.locator("#panthorium-notification-bell [data-notification-count]").textContent(), "1");
    await checked("enabled", true);
    await checked("channels.voice", false);
    await checked("channels.sound", false);
    await checked("channels.browser", false);
    assert.equal(await page.locator("[data-reminders-consent]").isChecked(), false, "notification controls never grant email consent");

    await toggle("categories.operations", false);
    assert.equal((await notifications.settings({ user: a })).settings.categories.operations, false);
    assert.equal((await notifications.settings({ user: b })).settings.categories.operations, true);
    await page.reload();
    await page.evaluate(() => PanthoriumReminders.open());
    await checked("categories.operations", false);

    await row(initial.id).getByRole("button", { name: "อ่านแล้ว", exact: true }).click();
    await until(async () => (await notifications.list({ user: a })).unreadCount === 0, "read is persisted on the server");
    await until(async () => await row(initial.id).getAttribute("data-unread") === "false", "read state is rendered");
    await row(initial.id).getByRole("button", { name: "ลบการแจ้งเตือน " + unsafeTitle, exact: true }).click();
    await until(async () => await row(initial.id).count() === 0, "deleted notification removed");
    await notifications.publish({ userId: a.sub, category: "operations", type: "test.complete", title: unsafeTitle, body: "รายละเอียดบัญชีแรก", sourceId: "initial" });
    await refresh();
    assert.equal(await row(initial.id).count(), 0, "event replay does not resurrect a deleted notification");

    // Real Chromium permission is granted only before an explicit switch click.
    await context.grantPermissions(["notifications"], { origin: base });
    await toggle("channels.browser", true);
    assert.equal((await notifications.settings({ user: a })).settings.channels.browser, true);
    await toggle("channels.browser", false);
    await toggle("channels.voice", true);
    assert.equal((await notifications.settings({ user: a })).settings.channels.voice, true);
    await toggle("channels.voice", false);

    await toggle("enabled", false);
    const muted = await publish("master-muted");
    await row(muted.id).waitFor();
    assert.equal(await page.locator("[data-notification-toast]").count(), 0, "master switch suppresses delivery while retaining history");
    await toggle("enabled", true);
    await publish("category-muted", "operations");
    assert.equal(await page.locator("[data-notification-toast]").count(), 0, "category switch suppresses delivery");

    await root.getByLabel("เริ่ม", { exact: true }).fill("00:00");
    await root.getByLabel("สิ้นสุด", { exact: true }).fill("00:00");
    await root.getByLabel("เขตเวลา", { exact: true }).fill("Asia/Bangkok");
    await root.getByRole("button", { name: "บันทึกช่วงเวลา", exact: true }).click();
    await until(async () => (await notifications.settings({ user: a })).settings.quietHours.end === "00:00", "quiet-hours range persisted");
    await toggle("quietHours.enabled", true);
    await publish("quiet-hours-muted");
    assert.equal(await page.locator("[data-notification-toast]").count(), 0, "all-day quiet hours suppress alerts");
    await toggle("quietHours.enabled", false);

    await publish("private-preview", "system", "ข้อความส่วนตัวไม่ควรอยู่ในป๊อปอัป");
    await page.locator("[data-notification-toast]").waitFor();
    assert.doesNotMatch(await page.locator("[data-notification-toast]").textContent(), /private-preview|ข้อความส่วนตัว/);
    await clearToast();
    await toggle("privacyPreview", true);
    const detailed = await publish("detailed-preview", "system", "แสดงรายละเอียดที่ยินยอมแล้ว");
    await page.locator("[data-notification-toast]").getByText(/แสดงรายละเอียดที่ยินยอมแล้ว/).waitFor();
    await clearToast();
    await row(detailed.id).waitFor();

    let releaseSettingsResponse, signalSettingsCaptured;
    const settingsHeld = new Promise(resolve => { releaseSettingsResponse = resolve; });
    const settingsCaptured = new Promise(resolve => { signalSettingsCaptured = resolve; });
    let captureSettings = true;
    const delayedSettings = async route => {
      if (!captureSettings) return route.continue();
      captureSettings = false;
      const response = await route.fetch();
      signalSettingsCaptured(); await settingsHeld;
      await route.fulfill({ response }).catch(() => {});
    };
    await page.route("**/api/notifications?limit=50", delayedSettings);
    const oldSettingsPoll = refresh();
    await settingsCaptured;
    await toggle("privacyPreview", false);
    releaseSettingsResponse(); await oldSettingsPoll;
    await checked("privacyPreview", false);
    assert.equal(await page.evaluate(() => PanthoriumNotifications.getState().settings.privacyPreview), false, "a stale poll cannot undo a successful privacy preference save");
    await page.unroute("**/api/notifications?limit=50", delayedSettings);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      assert(await root.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "notification settings fit mobile width " + width);
      assert(await center.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "notification history fits mobile width " + width);
      const box = await root.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width + 1, "notification panel remains inside viewport " + width);
    }
    if (process.env.NOTIFICATIONS_SCREENSHOT) await page.screenshot({ path: process.env.NOTIFICATIONS_SCREENSHOT, fullPage: true });

    for (let index = 0; index < 55; index++) await notifications.publish({
      userId: a.sub, category: "system", type: "test.page", title: "ประวัติรายการ " + index,
      body: "ทดสอบการอ่านประวัติมากกว่าหนึ่งหน้า", sourceId: "page-" + index
    });
    await refresh(); await clearToast();
    assert.equal(await row(muted.id).count(), 0, "old entries are outside the first 50-item page");
    await center.getByRole("button", { name: "โหลดรายการก่อนหน้า", exact: true }).click();
    await row(muted.id).waitFor();
    await refresh();
    assert.equal(await row(muted.id).count(), 1, "polling retains the older history a user loaded");
    assert.equal(await center.locator("[data-notification-id]").count(), 60, "history pages are joined without duplicates");
    await center.getByRole("button", { name: "กลับรายการล่าสุด", exact: true }).click();
    assert.equal(await center.locator("[data-notification-id]").count(), 50);

    // Delay an actual old-account response while a new account connects.
    let releaseResponse, signalCaptured;
    const held = new Promise(resolve => { releaseResponse = resolve; });
    const captured = new Promise(resolve => { signalCaptured = resolve; });
    let intercept = true;
    await page.route("**/api/notifications?limit=50", async route => {
      if (!intercept) return route.continue();
      intercept = false;
      const response = await route.fetch();
      signalCaptured(); await held;
      await route.fulfill({ response }).catch(() => {});
    });
    const stale = page.evaluate(() => PanthoriumNotifications.refresh());
    await captured;
    await page.evaluate(({ user, token }) => {
      OS.state.user = user; OS.config.accessToken = token;
      window.dispatchEvent(new Event("panthorium:auth-changed"));
    }, { user: b, token: auth.signAccessToken(b) });
    await row(other.id).waitFor();
    releaseResponse(); await stale;
    assert.equal(await row(detailed.id).count(), 0, "late old-account response cannot restore private content");
    assert.doesNotMatch(await center.textContent(), /รายละเอียดบัญชีแรก|แสดงรายละเอียดที่ยินยอมแล้ว|master-muted/);
    await checked("categories.operations", true);
    await checked("privacyPreview", false);
    assert.equal(await page.locator("[data-notification-toast]").count(), 0, "account switch does not replay another account's speech or previews");

    await page.evaluate(() => {
      OS.state.user = { sub: "guest:notifications-browser", roles: ["guest"], permissions: ["chat"] };
      OS.config.accessToken = "";
      window.dispatchEvent(new Event("panthorium:auth-changed"));
    });
    assert.equal(await page.locator("[data-notification-id]").count(), 0);
    assert.equal(await page.locator("#panthorium-notification-bell").count(), 0);
    assert.doesNotMatch(await page.locator("body").textContent(), /ข้อมูลของบัญชีที่สอง|รายละเอียดบัญชีแรก/);

    assert.deepEqual(errors, []);
    console.log("Notifications browser: integrated settings, real route persistence, independent accounts, switches and permission, quiet hours, privacy previews, history reads/deletes, no replay/XSS, mobile layout and stale-session isolation passed");
  } finally {
    await browser?.close();
    await notifications.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
