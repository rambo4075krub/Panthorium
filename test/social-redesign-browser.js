"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), express = require("express");
const { randomUUID } = require("node:crypto"), { chromium } = require("playwright");
const { AuthService } = require("../services/authService");
const { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService");
const { createSocialRouter } = require("../routes/social");
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+16000;while(Date.now()<end){if(await fn())return;await pause(100);}throw Error(label);}
(async()=>{
  const users=Array.from({length:2},()=>{const id=randomUUID();return {id,sub:id,roles:["user"],permissions:["chat"]};}),[a,b]=users;
  const auth=new AuthService({config:{jwtSecret:"redesign-browser-test",accessTokenTtl:"1h"},audit:{record(){}}});
  const repo=new SocialRepository({allowMemory:true}), image={id:randomUUID(),name:"profile.png",size:68,contentType:"image/png"};
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yZ8AAAAASUVORK5CYII=","base64");
  const social=new SocialService({repository:repo,files:{findObject:async()=>image,preview:async()=>({...image,body:png})}});await social.init();
  const write=(user,action,input)=>social.write({user,action,input,requestId:randomUUID()});
  await write(a,"profile",{name:"ปานเทพ",bio:"ข้อมูลส่วนตัวของฉัน",discoverable:true,fileIds:[image.id]});
  await write(b,"profile",{name:"เพื่อนทดสอบ",bio:"ไม่เผยแพร่",discoverable:true});
  const post=(await write(a,"publish",{module:"feed",title:"ยินดีต้อนรับสู่ Watch",text:"พื้นที่แชร์ภาพและข้อความ",fileIds:[image.id]})).record;
  const app=express();app.use(express.json());app.use("/api/social",createSocialRouter(auth,social));
  app.get("/api/files",(_,res)=>res.json({ok:true,files:[image],usedBytes:68,maxBytes:1048576}));
  for(const file of ["social-ui.js","start-menu-ui.js","voice-window-catalog.js","voice-command-client.js"])app.get("/"+file,(_,res)=>res.sendFile(path.join(__dirname,"..",file)));
  app.get("/",(_,res)=>res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#070e16;font:14px system-ui,sans-serif"><div id="sm-apps" hidden></div><div id="start-menu"></div><script>
    window.createWindow=(id,title,markup,opts)=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;el.style.cssText='position:fixed;inset:0;display:flex;flex-direction:column;z-index:10';el.innerHTML='<div style="height:48px;flex:0 0 48px;padding:14px 20px;box-sizing:border-box;background:#101e2c;color:#e4edf5;font-weight:600">PANTHORIUM · '+title+'</div><div class="window-content" style="flex:1;min-height:0">'+markup+'</div>';document.body.append(el);OS.windows.set(id,{id,el,onClose:opts.onClose});};
    window.focusWindow=id=>{const el=OS.windows.get(id)?.el;if(el)el.style.display='flex';};
  </script><script src="/start-menu-ui.js"></script><script src="/voice-window-catalog.js"></script><script src="/voice-command-client.js"></script><script src="/social-ui.js"></script></body></html>`));
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));let browser;
  try{
    browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1280,height:850}}),pages=[await ctx.newPage(),await ctx.newPage()],[sender,reader]=pages,errors=[];
    for(const [i,page]of pages.entries()){
      page.on("pageerror",e=>errors.push(e.message));
      await page.addInitScript(({user,token})=>{window.OS={state:{user},config:{backendUrl:location.origin,accessToken:token},windows:new Map()};},{user:users[i],token:auth.signAccessToken(users[i])});
      await page.goto("http://127.0.0.1:"+server.address().port);
      await page.evaluate(()=>PanthoriumSocial.open("feed"));
    }
    const order=["Feed","Short","Watch","Live","TV","Market","Community","Chat","Connect","Profile","Friends","↻"];
    assert.deepEqual(await sender.locator(".social-tabs>button").evaluateAll(nodes=>nodes.map(n=>n.firstChild.textContent)),order);
    assert.equal(await sender.locator(".social-shell h1,.social-shell h2,#social-notification-bell,[data-social-open-notifications]").count(),0);
    await sender.bringToFront();
    const watch=sender.locator('[data-social="feed"]');
    await watch.getByRole("button",{name:"สร้างโพสต์",exact:true}).click();
    await watch.getByLabel("รายละเอียด",{exact:true}).fill("ร่างที่ยังไม่ได้เผยแพร่");
    for(const id of ["short","live","market","community","talk","connect","profile","friends"]){
      await sender.locator('[data-social-tab="'+id+'"]').click();
      await sender.locator('[data-social="'+id+'"]:not([hidden])').waitFor();
      assert.equal(await sender.locator(".window").count(),1);
      assert.equal(await sender.locator("[data-social]:visible").count(),1);
    }
    for (const id of ["feed", "short", "market"]) {
      const bar = sender.locator('[data-social="'+id+'"] .social-toolbar');
      assert.equal(await bar.getByText("เครื่องมือที่เชื่อมงาน", { exact: true }).count(), 0);
      assert.equal(await bar.getByRole("button", { name: "รายการทั้งหมด", exact: true, includeHidden: true }).count(), id === "market" ? 1 : 0);
    }
    const community = sender.locator('[data-social="community"]');
    assert.equal(await community.locator('[data-group-menu="mine"]').getAttribute("aria-expanded"), "true");
    assert.deepEqual(await community.locator(".social-toolbar button").allTextContents(), ["กลุ่มของฉัน", "กลุ่มทั้งหมด", "สร้างกลุ่ม"]);
    await sender.evaluate(()=>PanthoriumSocial.open("profile"));
    const profile = sender.locator('[data-social="profile"]');
    await profile.getByRole("button", { name: "บัญชีที่บล็อก", exact: true }).click();
    await profile.getByRole("heading", { name: "บัญชีที่บล็อก", exact: true }).waitFor();
    const blocked = await profile.getByRole("button", { name: "บัญชีที่บล็อก", exact: true }).boundingBox(), profileBack = await profile.getByRole("button", { name: "กลับ", exact: true }).boundingBox();
    assert(Math.abs(blocked.y-profileBack.y)<2 && profileBack.x>blocked.x);
    await profile.getByRole("button", { name: "กลับ", exact: true }).click();
    await profile.getByLabel("ชื่อที่แสดง", { exact: true }).waitFor();
    assert.equal(await profile.getByRole("button", { name: "กลับ", exact: true }).isVisible(), false);
    assert.deepEqual(await sender.locator('[data-social="friends"] .social-toolbar button').allTextContents(), ["ค้นหาเพื่อน", "บัญชีที่บล็อก"]);
    await sender.locator('[data-social-tab="feed"]').click();
    assert.equal(await watch.getByLabel("รายละเอียด",{exact:true}).inputValue(),"ร่างที่ยังไม่ได้เผยแพร่");
    // The shared window catalog must select the requested tab, including via voice navigation.
    const voice=await sender.evaluate(()=>PanthoriumVoiceCommands.windowAction("open_social_short"));assert.equal(voice.ok,true);
    assert.equal(await sender.locator('.window').getAttribute('data-social-active'),'short');
    assert.equal(await sender.locator('[data-social="short"] .social-toolbar').getByRole("button",{name:"เพลย์ลิสต์",exact:true}).count(),1);
    assert.equal(await watch.locator('.social-toolbar').getByRole("button",{name:"เพลย์ลิสต์",exact:true}).count(),0);
    await sender.evaluate(()=>PanthoriumSocial.open("friends"));
    const friends=sender.locator('[data-social="friends"]');
    await friends.getByLabel("ชื่อที่แสดงอย่างน้อย 2 ตัวอักษร").fill("เพื่อน");
    await friends.locator('form').getByRole("button",{name:"ค้นหาเพื่อน",exact:true}).click();
    await friends.getByRole("button",{name:"เพิ่มเพื่อน",exact:true}).click();
    await until(async()=> (await social.friends({user:b})).items.length===1,"friend request saved");
    await reader.evaluate(()=>PanthoriumSocial.refreshNotifications());
    await reader.locator('[data-social-tab="friends"] [data-social-module-count]').getByText("1",{exact:true}).waitFor();
    await reader.locator('[data-social-tab="friends"]').click();
    const rf=reader.locator('[data-social="friends"]');
    assert(!await rf.getByText("ข้อมูลส่วนตัวของฉัน",{exact:true}).count());
    await rf.getByRole("button",{name:"รับคำขอเป็นเพื่อน",exact:true}).click();
    await until(async()=> (await social.friends({user:a})).items[0].status==="accepted","friend accepted");
    await sender.evaluate(()=>PanthoriumSocial.refreshNotifications());
    await sender.locator('[data-social-tab="friends"] [data-social-module-count]').getByText("1",{exact:true}).waitFor();
    await sender.locator('[data-social-friends]').getByRole("button",{name:"ส่งข้อความ",exact:true}).click();
    const talk=sender.locator('[data-social="talk"]');await talk.getByLabel("ข้อความ",{exact:true}).fill("ข้อความจากเพื่อน");
    await talk.getByRole("button",{name:"ส่ง",exact:true}).click();
    const thread=(await social.read({user:a,module:"talk"})).items[0];
    await until(async()=> (await social.read({user:b,recordId:thread.id})).items.length===1,"message persisted");
    await reader.bringToFront();await reader.evaluate(id=>PanthoriumSocial.open("talk",{recordId:id}),thread.id);
    await reader.locator('[data-social="talk"] [data-message-id]').evaluate(node=>node.scrollIntoView({block:"center"}));
    const first=(await social.read({user:b,recordId:thread.id})).items[0];
    await until(async()=>!!(await repo.get(first.id)).readAt,"visible message read");
    await reader.locator('[data-social-tab="feed"]').click();
    const hidden=(await write(a,"message",{recordId:thread.id,text:"ยังไม่ได้อ่านในแท็บที่ซ่อน"})).record;
    await reader.evaluate(()=>PanthoriumSocial.refreshNotifications());await pause(4500);
    assert.equal((await repo.get(hidden.id)).readAt,undefined,"hidden tab never reads messages");
    assert.equal(await reader.locator('[data-social-tab="talk"] [data-social-module-count]').textContent(),"1");
    await write(b,"comment",{recordId:post.id,text:"ความคิดเห็นใหม่"});
    await sender.bringToFront();
    await sender.evaluate(()=>PanthoriumSocial.refreshNotifications());await sender.evaluate(()=>PanthoriumSocial.open("feed"));
    await sender.evaluate(()=>PanthoriumSocial.showNotifications());
    const activities=watch.locator('[data-activity-items]');
    await activities.getByText("เพื่อนทดสอบ • แสดงความคิดเห็นในโพสต์ของคุณ",{exact:true}).waitFor();
    assert(!await activities.getByText(/ตอบรับคำขอเป็นเพื่อน/).count());
    await until(async()=> ((await social.notifications.list(a.sub,undefined,"feed")).counts.feed || 0)===0,"Watch activity acknowledged on server");
    await sender.evaluate(()=>PanthoriumSocial.refreshNotifications());
    for (const module of ["feed", "profile"]) {
      const badge=sender.locator('[data-social-tab="'+module+'"] [data-social-module-count]');
      assert.equal(await badge.textContent(),"0","read activity has no remaining badge");
      assert(!await badge.isVisible());
    }
    assert.equal(await sender.locator('[data-social-tab="friends"] [data-social-module-count]').textContent(),"1");
    await sender.evaluate(()=>PanthoriumSocial.open("connect"));
    const connect=sender.locator('[data-social="connect"]');await connect.getByRole("button",{name:"ตั้งค่า Connect",exact:true}).click();
    const saveBox = await connect.getByRole("button", { name: "บันทึก", exact: true }).boundingBox(), backBox = await connect.getByRole("button", { name: "กลับ", exact: true }).boundingBox();
    assert(Math.abs(saveBox.y-backBox.y)<2 && backBox.x>saveBox.x);
    await connect.getByRole("button", { name: "กลับ", exact: true }).click();
    await connect.getByRole("button", { name: "ตั้งค่า Connect 18+", exact: true }).waitFor();
    await connect.getByRole("button", { name: "ตั้งค่า Connect", exact: true }).click();
    await connect.getByLabel("เพศของฉัน",{exact:true}).selectOption("male");await connect.getByLabel("สนใจทำความรู้จัก",{exact:true}).selectOption("male");
    const sync=connect.getByLabel("ใช้ชื่อ รูป และคำแนะนำจากโปรไฟล์ของฉันใน Connect",{exact:true});assert(await sync.isChecked());
    assert(await connect.getByLabel("ชื่อใน Connect",{exact:true}).isDisabled());
    await connect.getByLabel("ฉันอายุ 18 ปีขึ้นไป และยินยอมแสดงโปรไฟล์นี้ต่อผู้เปิดใช้ Connect",{exact:true}).check();
    await connect.getByRole("button",{name:"บันทึก",exact:true}).click();
    await until(async()=>!!(await repo.get("connect:"+a.sub))?.enabled,"Connect opt-in");assert.equal((await repo.get("connect:"+a.sub)).name,"ปานเทพ");
    for(const width of [390,320]){
      await sender.setViewportSize({width,height:800});
      for(const id of ["feed","short","live","market","community","talk","connect","profile","friends"]){
        await sender.evaluate(id=>PanthoriumSocial.open(id),id);
        assert(await sender.locator('[data-social="'+id+'"]').evaluate(n=>n.scrollWidth<=n.clientWidth+1),"no content overflow "+id+" "+width);
      }
      assert(await sender.locator('.social-tabs').evaluate(n=>n.scrollWidth>n.clientWidth&&getComputedStyle(n).overflowX==='auto'),"horizontal tab scrolling");
      await sender.locator('.social-tabs button').last().scrollIntoViewIfNeeded();assert(await sender.getByRole('button',{name:'Refresh',exact:true}).isVisible());
    }
    await sender.evaluate(()=>PanthoriumSocial.open("feed"));await sender.getByRole("button",{name:"Refresh",exact:true}).click();
    await watch.locator('[data-record-id="'+post.id+'"] img').waitFor();
    if(process.env.SOCIAL_REDESIGN_SCREENSHOT){await sender.screenshot({path:process.env.SOCIAL_REDESIGN_SCREENSHOT+"-mobile.png"});await sender.setViewportSize({width:1280,height:850});await sender.screenshot({path:process.env.SOCIAL_REDESIGN_SCREENSHOT+"-desktop.png"});}
    await sender.evaluate(()=>{OS.state.user={sub:'guest:test',roles:['guest'],permissions:[]};window.dispatchEvent(new Event('panthorium:auth-changed'));});
    assert.equal(await sender.locator('.social-shell').count(),0);assert.equal(await sender.evaluate(()=>OS.windows.size),0);
    assert.deepEqual(errors,[]);
    console.log("Social redesign browser: eleven tabs/one window, ordered scrolling nav, preserved drafts, voice switching, friend request/acceptance/chat, hidden unread receipts, scoped notices, consented profile sync, mobile layouts and logout cleanup passed");
  }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
