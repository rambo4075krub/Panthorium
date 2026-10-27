"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),express=require("express"),{randomUUID}=require("node:crypto"),{execFileSync}=require("node:child_process"),{chromium}=require("playwright");
const {AuthService}=require("../services/authService"),{SocialRepository}=require("../services/socialRepository"),{SocialService}=require("../services/socialService"),{createSocialRouter}=require("../routes/social");
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await pause(80);}throw Error(label);}
(async()=>{
 const [owner,reader]=Array.from({length:2},()=>{const id=randomUUID();return{id,sub:id,roles:["user"],permissions:["chat"]};});
 const auth=new AuthService({config:{jwtSecret:"experience-browser-only",accessTokenTtl:"1h"},audit:{record(){}}});
 const repo=new SocialRepository({allowMemory:true});
 const bytes=execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=size=180x320:rate=10:duration=8","-f","lavfi","-i","sine=frequency=440:duration=8","-c:v","libvpx","-b:v","120k","-c:a","libvorbis","-f","webm","pipe:1"]);
 const file={id:randomUUID(),name:"short.webm",contentType:"video/webm",size:bytes.length};
 const service=new SocialService({repository:repo,files:{findObject:async()=>file,preview:async()=>({...file,body:bytes}),download:async()=>({...file,body:bytes})}});await service.init();
 const write=(user,action,input)=>service.write({user,action,input,requestId:randomUUID()});
 await write(owner,"profile",{name:"ผู้โพสต์ <script>safe</script>",discoverable:true});await write(reader,"profile",{name:"ผู้ชม",discoverable:true});await write(reader,"follow",{userId:owner.sub});
 const videos=[];for(let i=0;i<3;i++)videos.push((await write(owner,"publish",{module:"short",text:"รายละเอียดวิดีโอ "+i+"\nบรรทัดสอง\nบรรทัดสาม",fileIds:[file.id]})).record);
 const post=(await write(reader,"publish",{module:"feed",text:"โพสต์ของฉัน"})).record;
 await write(owner,"comment",{recordId:post.id,text:"ความเห็นใหม่"});await write(owner,"like",{recordId:post.id});await write(owner,"share",{recordId:post.id});
 const app=express();app.use(express.json());app.use("/api/social",createSocialRouter(auth,service));let uploads=0;
 app.get("/api/files",(_,res)=>res.json({files:[file],usedBytes:bytes.length,maxBytes:20000000}));
 app.post("/api/files",express.raw({type:"application/octet-stream",limit:"20mb"}),(_,res)=>{uploads++;res.json({file});});
 for(const name of ["social-ui.js","social-rtc.js"])app.get("/"+name,(_,res)=>res.sendFile(path.join(__dirname,"..",name)));
 app.get("/",(_,res)=>res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font:14px system-ui"><div id="sm-apps" hidden></div><script>window.createWindow=(id,title,markup,opts)=>{let n=document.createElement('div');n.className='window';n.dataset.id=id;n.style.cssText='position:fixed;inset:0;z-index:1';n.innerHTML=markup;document.body.append(n);OS.windows.set(id,{el:n,onClose:opts.onClose});};window.focusWindow=()=>{};</script><script src="/social-rtc.js"></script><script src="/social-ui.js"></script></body></html>`));
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));let browser;
 try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(({user,token})=>{window.OS={state:{user},config:{backendUrl:location.origin,accessToken:token},windows:new Map()};},{user:reader,token:auth.signAccessToken(reader)});
  await page.goto("http://127.0.0.1:"+server.address().port);await page.bringToFront();await page.evaluate(()=>PanthoriumSocial.open("short"));
  const root=page.locator('[data-social="short"]');assert.equal(await page.locator(".social-activity").count(),0);
  await until(async()=>(await root.locator("video").count())===3,"all videos loaded");
  const top=root.locator("video").first();await top.scrollIntoViewIfNeeded();
  await until(()=>top.evaluate(v=>!v.paused&&v.muted&&v.currentTime>0),"visible video autoplays muted");
  const second=root.locator("video").nth(1);await second.scrollIntoViewIfNeeded();await until(()=>second.evaluate(v=>!v.paused&&v.muted),"scroll starts next muted");assert(await top.evaluate(v=>v.paused));
  await second.click();const modal=page.locator(".social-viewer");await modal.waitFor();
  await until(()=>modal.locator("video").evaluate(v=>!v.paused&&!v.muted&&v.currentTime>0),"fullscreen has audio");assert.equal(await modal.locator("video[controls]").count(),0);
  if(process.env.SOCIAL_EXPERIENCE_SCREENSHOT)await page.screenshot({path:process.env.SOCIAL_EXPERIENCE_SCREENSHOT+"-video.png"});
  const currentId=await modal.locator('[data-like-record]').getAttribute('data-like-record');
  await modal.locator(".social-video-surface").dblclick({position:{x:170,y:300},delay:70});await until(async()=>(await repo.get(currentId)).likeCount===1,"double tap likes");
  await modal.locator(".social-video-surface").dblclick({position:{x:170,y:300},delay:70});assert.equal((await repo.get(currentId)).likeCount,1,"double tapping again never unlikes");
  await page.mouse.move(180,400);await page.mouse.wheel(0,500);await until(async()=>await modal.locator('[data-like-record]').getAttribute('data-like-record')!==currentId,"wheel advances");
  await pause(700);await page.mouse.wheel(0,-500);await until(async()=>await modal.locator('[data-like-record]').getAttribute('data-like-record')===currentId,"wheel returns to previous");
  await modal.locator(".social-video-surface").click({position:{x:170,y:300}});await pause(350);assert(await modal.locator('.social-video-hud').isHidden());
  await modal.locator(".social-video-surface").click({position:{x:170,y:300}});await pause(350);assert(await modal.locator('.social-video-hud').isVisible());
  await modal.getByRole("button",{name:"ดูรายละเอียดวิดีโอ",exact:true}).click();assert(await modal.locator('.social-video-drawer').isVisible());await modal.getByRole("button",{name:"ปิดรายละเอียด",exact:true}).click();
  await modal.getByRole("button",{name:"กลับ",exact:true}).click();assert.equal(await page.locator('.social-viewer').count(),0);
  for(const module of ["feed","short","watch","live","tv","market","community","talk","connect","profile","friends"]){
   await page.evaluate(m=>PanthoriumSocial.open(m),module);const section=page.locator('[data-social="'+module+'"]');
   assert(await section.getByRole("search").isHidden());await section.getByRole("button",{name:"ค้นหา",exact:true}).first().click();assert(await section.getByRole("search").isVisible());
   const sizes=await section.getByRole("search").evaluate(n=>({input:n.querySelector('input').getBoundingClientRect().toJSON(),button:n.querySelector('button').getBoundingClientRect().toJSON()}));assert(sizes.button.x>=sizes.input.x&&sizes.button.x+sizes.button.width<=sizes.input.x+sizes.input.width);
   await section.getByLabel("ค้นหารายการ").press("Escape");assert(await section.getByRole("search").isHidden());
  }
  const profile=page.locator('[data-social="profile"]');await page.evaluate(()=>PanthoriumSocial.open("profile"));assert.equal(await profile.locator('[data-record-id]').count(),1);assert.equal(await profile.getByLabel('ชื่อที่แสดง',{exact:true}).count(),0);
  await profile.getByRole('button',{name:'ตั้งค่าโปรไฟล์',exact:true}).click();await profile.getByLabel('ชื่อที่แสดง',{exact:true}).waitFor();
  await page.evaluate(()=>PanthoriumSocial.refreshNotifications());assert.equal((await service.notifications.list(reader.sub)).counts.notifications,3);
  await page.evaluate(()=>PanthoriumSocial.open("notifications"));await until(async()=>((await service.notifications.list(reader.sub)).counts.notifications||0)===0,"bell read persisted");assert.equal(await page.locator('[data-social="notifications"] [data-notification-id]').count(),3);
  await page.locator('[data-social="notifications"] [data-notification-id]').first().click();await page.locator('[data-social="feed"] [data-record-id="'+post.id+'"]').waitFor();
  await page.reload();await page.evaluate(()=>PanthoriumSocial.open("notifications"));assert.equal((await service.notifications.list(reader.sub)).counts.notifications||0,0);
  await page.evaluate(()=>PanthoriumSocial.open("feed"));const feed=page.locator('[data-social="feed"]');await feed.getByRole('button',{name:'สร้างโพสต์',exact:true}).click();await feed.getByRole('button',{name:'แนบไฟล์',exact:true}).click();assert.equal(await feed.getByRole('checkbox').count(),0);
  await feed.getByRole('button',{name:'แนบไฟล์จากคลาวด์',exact:true}).click();await feed.getByRole('checkbox',{name:file.name,exact:true}).check();await feed.getByRole('button',{name:'เสร็จสิ้น',exact:true}).click();
  let prompt='';page.once('dialog',d=>{prompt=d.message();d.dismiss();});await feed.locator('input[type=file]').setInputFiles({name:'image.png',mimeType:'image/png',buffer:Buffer.from('fixture')});await until(async()=>!!prompt,'upload confirmation');assert.equal(prompt,'ต้องการอัพโหลดไฟล์หรือไม่');assert.equal(uploads,0);
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert(await feed.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'no overflow '+width);}
  if(process.env.SOCIAL_EXPERIENCE_SCREENSHOT)await page.screenshot({path:process.env.SOCIAL_EXPERIENCE_SCREENSHOT});
  assert.deepEqual(errors,[]);await page.evaluate(()=>{OS.state.user={sub:'guest',roles:['guest'],permissions:[]};window.dispatchEvent(new Event('panthorium:auth-changed'));});assert.equal(await page.locator('.social-shell').count(),0);
  console.log('Social experience browser: muted viewport playback, audio fullscreen, wheel history, idempotent double tap, controls/details, 11 compact searches, own profile, durable bell/deep links, cloud picker and cancelled upload passed');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
