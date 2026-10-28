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
    const thread = (await write(a, "thread", { userId: b.id })).record;
    await until(async () => (await count(reader).textContent()) === "1", "request visible before opening Social");
    assert.equal(await reader.locator("[data-social]").count(), 0);
    assert.equal(await reader.locator('[data-app-id="social-talk"] [data-social-module-count]').textContent(), "1");
    await reader.bringToFront(); await reader.evaluate(() => PanthoriumSocial.open("talk"));
    const row=reader.locator('[data-record-id="'+thread.id+'"]');
    assert.equal(await row.locator('img').count(),0,"name stays safe text");
    assert.equal(await row.getByRole('button',{name:'เปิดบทสนทนา',exact:true}).count(),0);
    assert.equal(await row.locator('[data-social-record-count]').textContent(),'1');
    await row.click(); await reader.getByRole('button',{name:'รับคำขอ',exact:true}).click();
    await until(async()=>(await repo.get(thread.id)).status==='accepted','request accepted from row');
    await sender.bringToFront(); await sender.evaluate(id=>PanthoriumSocial.open('talk',{recordId:id}),thread.id);
    await reader.evaluate(()=>{const win=OS.windows.get('social-media');win.onClose();win.el.remove();OS.windows.delete('social-media');});
    await sender.getByLabel('ข้อความ',{exact:true}).fill('ทดสอบข้อความใหม่');await sender.getByRole('button',{name:'ส่ง',exact:true}).click();
    const message=(await service.read({user:a,recordId:thread.id})).items[0];
    await until(async()=>(await count(reader).textContent())==='1','closed Chat gets unread');assert.equal((await repo.get(message.id)).readAt,undefined);
    const post=(await write(b,'publish',{module:'feed',text:'โพสต์ทดสอบ'})).record;
    await write(a,'comment',{recordId:post.id,text:'ความคิดเห็นใหม่'});await reader.evaluate(()=>PanthoriumSocial.refreshNotifications());
    assert.equal(await count(reader).textContent(),'2');assert.equal(await reader.locator('[data-app-id="social-notifications"] [data-social-module-count]').textContent(),'1');
    assert.equal(await reader.locator('[data-app-id="social-feed"] [data-social-module-count]').textContent(),'0');
    await reader.locator('[data-start-group-toggle="social"]').click();
    for(const width of [390,320]){await reader.setViewportSize({width,height:760});const box=await reader.locator('[data-app-id="social-notifications"] [data-social-module-count]').boundingBox();assert(box&&box.width<50&&box.x+box.width<=width);}
    await reader.bringToFront(); await reader.evaluate(()=>PanthoriumSocial.showNotifications());
    assert.equal(await reader.locator('.social-activity').count(),0);
    const panel=reader.locator('[data-social="notifications"] [data-social-content]');await panel.getByText('ปานเทพ <img src=x onerror=alert(1)> • แสดงความคิดเห็นในโพสต์ของคุณ',{exact:true}).waitFor();
    assert.equal(await panel.locator('img').count(),0);
    await until(async()=>(await count(reader).textContent())==='1','bell read leaves Chat unread');assert.equal((await repo.get(message.id)).readAt,undefined);
    await panel.locator('[data-notification-id]').click();await reader.locator('[data-social="feed"] [data-record-id="'+post.id+'"]').waitFor();
    await reader.evaluate(()=>PanthoriumSocial.open('talk'));await reader.locator('[data-record-id="'+thread.id+'"]').click();
    await reader.locator('[data-message-id="'+message.id+'"]').evaluate(n=>n.scrollIntoView({block:'center'}));await until(async()=>!!(await repo.get(message.id)).readAt,'visible chat sends receipt');
    await reader.reload();await reader.evaluate(()=>PanthoriumSocial.refreshNotifications());await until(async()=>(await count(reader).textContent())==='0','durable reads survive reload');
    await reader.evaluate(()=>PanthoriumSocial.showNotifications());
    for(const width of [390,320]){await reader.setViewportSize({width,height:700});const box=await panel.boundingBox();assert(box.x>=0&&box.x+box.width<=width);}
    if(process.env.SOCIAL_NOTIFICATION_SCREENSHOT)await reader.screenshot({path:process.env.SOCIAL_NOTIFICATION_SCREENSHOT});
    await reader.evaluate(()=>{OS.state.user={sub:'guest:test',roles:['guest'],permissions:[]};window.dispatchEvent(new Event('panthorium:auth-changed'));});
    assert.equal(await panel.count(),0);assert.doesNotMatch(await reader.locator('body').textContent(),/ทดสอบข้อความใหม่|ปานเทพ/);
    assert.deepEqual(errors, []);
    console.log("Social notifications browser: central Social bell and per-chat unread, request/acceptance navigation, Start badges, closed Talk, durable reads, safe names, mobile panel and logout cleanup passed");
  } finally {
    if (browser) await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
