'use strict';
// Real shared window shell + editor APIs: catch clipped workspaces and theme collisions.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { chromium } = require('playwright');
const { Resvg } = require('@resvg/resvg-js');
const { CreativeStudioService } = require('../services/creativeStudioService');
const { MemoryCreativeStudioRepository } = require('../services/creativeStudioRepository');
const { createCreativeStudioRouter } = require('../routes/creativeStudio');
const { OfficeArtifactService } = require('../services/officeArtifactService');
(async () => {
  const user = { sub: randomUUID(), roles: ['user'], permissions: ['chat'] }, store = new Map();
  const files = { bucket: 'ui-test', ensureConfigured() {}, async upload(owner, name, contentType, body) { const file = { id: randomUUID(), name, contentType, size: body.length }; store.set(file.id, { ...file, owner, body }); return file; }, async findObject(owner, id) { const file = store.get(id); if (!file || file.owner !== owner) throw Error('file_not_found'); return { id, name: file.name, contentType: file.contentType }; }, async readOwned(owner, id) { return { ...await this.findObject(owner, id), body: store.get(id).body }; } };
  files.download=files.readOwned;
  const studio = new CreativeStudioService({ files, office: new OfficeArtifactService({ files }), repository: new MemoryCreativeStudioRepository(), resolveUser: async u => u }); await studio.init();
  const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e2ecea"/><rect x="200" y="120" width="400" height="360" rx="40" fill="#30665f"/><circle cx="400" cy="300" r="90" fill="#b8d9c3"/></svg>').render().asPng();
  const picture = await files.upload(user.sub, 'ตัวอย่างสินค้า.png', 'image/png', png);
  const app = express(); app.use(express.json());
  app.post('/api/files',express.raw({type:'application/octet-stream',limit:'20mb'}),async(req,res)=>res.json({ok:true,file:await files.upload(user.sub,decodeURIComponent(req.get('x-file-name')),req.get('x-file-content-type'),req.body)}));
  app.get('/api/files', (req, res) => res.json({ ok: true, files: [...store.values()].map(({ body, owner, ...file }) => file) }));
  app.get('/api/files/:id/preview', (req, res) => { const file = store.get(req.params.id); res.type(file.contentType).send(file.body); });
  app.get('/api/files/:id', (req,res)=>{const file=store.get(req.params.id);if(!file)return res.sendStatus(404);res.type(file.contentType).send(file.body);});
  app.use('/api/studio', createCreativeStudioRouter({ verifyAccessToken: () => user, validateAccountPrincipal: async u => u }, studio));
  const {createApiRouter}=require('../routes/api');
  const {ToolRegistry}=require('../services/toolRegistry');const {AgentService}=require('../services/agentService');
  const registry=new ToolRegistry({sentinel:{}}),agent=new AgentService({tools:registry});
  app.use('/api',createApiRouter({}, {verifyAccessToken:()=>user}, {record(){}},{},agent,{}, {},{},{}));
  const scripts = ['voice-window-catalog.js', 'creative-voice-catalog.js', 'creative-voice-ui.js', 'voice-command-client.js', 'panthorium-window-base.js', 'window-theme-ui.js', 'workspace-ui.js', 'start-menu-ui.js', 'office-suite-core.js', 'office-suite-ui.js', 'studio-editor-ui.js', 'creative-editors-ui.js', 'creative-studio-ui.js'];
  for (const name of [...scripts, 'panthorium-window-base.css', 'workspace-ui.css', 'panthorium-logo.svg']) app.get('/' + name, (req, res) => res.sendFile(path.join(__dirname, '..', name)));
  app.get('/', (req, res) => res.type('html').send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/panthorium-window-base.css"><link rel="stylesheet" href="/workspace-ui.css"><style>html,body{margin:0;height:100%;background:#030912;font-family:system-ui}#windows{height:100%;position:relative}</style><body><div id="windows"></div><script>window.OS={state:{user:${JSON.stringify(user)}},config:{accessToken:'test'}};window.authorizedFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer test'}});window.PanthoriumAuth={ensureSession:async()=>true};</script>${scripts.map(s => '<script src="/' + s + '"></script>').join('')}<script>window.createWindow=(id,title,content,options)=>{const w=PanthoriumWindow.create({id,title,content,...options});PanthoriumWorkspace.apply(w);return w};window.closeWindow=id=>PanthoriumWindow.close(id);window.PanthoriumWindowManager={restore:id=>PanthoriumWindow.focus(id)};</script></body></html>`));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.PANTHORIUM_TEST_BROWSER_PATH,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);await page.goto('http://127.0.0.1:'+server.address().port);
    const say=async text=>{const r=await page.evaluate(t=>PanthoriumVoiceCommands.execute(t),text);assert.equal(r.ok,true,text+': '+JSON.stringify(r));return r;};
    const edit=async text=>{const r=await page.evaluate(t=>PanthoriumCreativeStudio.command(t),text);assert.equal(r.ok,true,text+': '+JSON.stringify(r));return r;};
    const open=async id=>{await page.evaluate(id=>PanthoriumCreativeStudio.editFile(id),id);await page.waitForFunction(()=>!document.querySelector('[data-workspace-kind]:not([hidden]) [data-body]')?.inert);};
    const host=kind=>page.locator('[data-workspace-kind="'+kind+'"]');
    await say('เปิดรูปภาพ');await page.waitForFunction(()=>document.querySelector('[data-editor-files]')?.options.length>1);await open(picture.id);
    const img=host('image');await say('เพิ่มข้อความ งานจากเสียง');
    await edit('เปิดรูปภาพ');await say('ปิดผลลัพธ์');await page.evaluate(()=>PanthoriumWindow.setMode('creative-studio','maximized'));
    const checkToolbars=()=>page.evaluate(()=>{
      const problems=[];
      for(const selector of ['.cs-open-file','.cs-workspace:not([hidden]) .ce-top']){
        const bar=document.querySelector(selector),bounds=bar.getBoundingClientRect();
        const controls=[...bar.querySelectorAll('button,input:not([type=file]),select')].filter(n=>n.getClientRects().length);
        for(const n of controls){const r=n.getBoundingClientRect(),label=n.getAttribute('aria-label')||n.textContent;
          if(r.left<bounds.left-1||r.right>bounds.right+1)problems.push(label+' outside toolbar');
          if(n.tagName==='BUTTON'&&n.scrollWidth>n.clientWidth+1)problems.push(label+' text overflow');
          if(!n.disabled&&!n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))problems.push(label+' covered');
        }
        for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
          const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)problems.push('overlapping controls');
        }
      }
      return problems;
    });
    for(const width of [320,360,390,412,709,850,1500]){
      await page.setViewportSize({width,height:width<600?844:950});
      if(process.env.PANTHORIUM_QA_DIR){fs.mkdirSync(process.env.PANTHORIUM_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PANTHORIUM_QA_DIR,'creative-'+width+'.png')});}
      assert.deepEqual(await checkToolbars(),[],'toolbar controls remain readable and tappable at '+width);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert((await img.locator('.ce-work').boundingBox()).height>160,'canvas remains usable at '+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{
      const state=window.voiceFixture={active:false,starts:0,stops:0,denied:false};
      window.PanthoriumLiveVoice={isActive:()=>state.active,isBusy:()=>false,async toggle(owner){state.starts++;state.owner=owner;if(!state.denied)state.active=true;window.dispatchEvent(new CustomEvent('panthorium:live-state'));},stop(){state.stops++;state.active=false;window.dispatchEvent(new CustomEvent('panthorium:live-state'));},sendText(){}};
    });
    const mic=page.locator('[data-studio-voice]');
    await mic.click();assert.equal(await mic.getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>voiceFixture.starts),1,'one tap starts the shared microphone');
    assert.equal(await page.evaluate(()=>voiceFixture.owner),'creative-editor');assert(!(await page.locator('[data-creative-voice-help]').isVisible()));
    await mic.click();assert.equal(await mic.getAttribute('aria-pressed'),'false');assert.equal(await page.evaluate(()=>voiceFixture.stops),1);
    await page.evaluate(()=>{voiceFixture.denied=true;});await mic.click();assert.equal(await mic.getAttribute('aria-pressed'),'false');assert.match(await page.locator('[data-studio-status]').textContent(),/ยังเปิดไมโครโฟนไม่สำเร็จ/);
    await page.evaluate(()=>{voiceFixture.denied=false;voiceFixture.active=true;window.dispatchEvent(new CustomEvent('panthorium:live-state'));});assert.equal(await mic.getAttribute('aria-pressed'),'true','shared microphone changes update the studio button');await mic.click();
    await edit('เปิดเลเยอร์');assert(await img.locator('.ce-inspector').isVisible());await edit('เปิดเลเยอร์');assert(await img.locator('.ce-inspector').isVisible(),'open panel is idempotent');
    await edit('ปิดเลเยอร์');assert(!(await img.locator('.ce-inspector').isVisible()));await edit('ปิดเลเยอร์');assert(!(await img.locator('.ce-inspector').isVisible()));
    await say('เพิ่มสี่เหลี่ยม');await say('เปลี่ยนสีเป็น แดง');assert.equal(await img.getByLabel('สี',{exact:true}).inputValue(),'#ff0000');
    await say('ย้ายเลเยอร์ไปทางขวา 50 พิกเซล');assert.equal(await img.getByLabel('ซ้าย',{exact:true}).inputValue(),'150');
    await say('ปรับความกว้าง 300 พิกเซล');assert.equal(await img.getByLabel('กว้าง',{exact:true}).inputValue(),'300');
    const chosen=await img.locator('[data-layer-id][aria-selected=true]').getAttribute('data-layer-id');
    await edit('เลื่อนเลเยอร์ลง');assert.equal(await img.locator('[data-layer-id]').nth(1).getAttribute('data-layer-id'),chosen);
    await edit('เลื่อนเลเยอร์ขึ้น');assert.equal(await img.locator('[data-layer-id]').first().getAttribute('data-layer-id'),chosen);
    await edit('ซ่อนเลเยอร์ที่เลือก');await edit('ซ่อนเลเยอร์ที่เลือก');assert.equal(await img.locator('.ce-layer').first().locator('button[aria-pressed]').getAttribute('aria-pressed'),'false');
    await edit('แสดงเลเยอร์ที่เลือก');assert.equal(await img.locator('.ce-layer').first().locator('button[aria-pressed]').getAttribute('aria-pressed'),'true');
    await say('ครอปภาพ ซ้าย 10 บน 20 กว้าง 300 สูง 200');assert.equal(await img.locator('canvas').first().getAttribute('width'),'300');assert.equal(await img.locator('canvas').first().getAttribute('height'),'200');
    assert.equal((await page.evaluate(()=>PanthoriumCreativeStudio.command('ครอปภาพ ซ้าย 299 บน 0 กว้าง 100 สูง 100'))).ok,false,'out-of-bounds crop is refused');
    await edit('ย้อนกลับ');assert.equal(await img.locator('canvas').first().getAttribute('width'),'800');await edit('ซูมพอดี');
    await edit('ตั้งชื่อ mobile-voice');const beforeMobileSave=store.size;assert((await say('บันทึกภาพ')).confirmationRequired);assert.equal(store.size,beforeMobileSave);
    await say('ยกเลิก');assert.equal(store.size,beforeMobileSave);await say('บันทึกภาพ');await say('ยืนยัน');
    await page.waitForFunction(()=>document.querySelector('[data-media-editor="image"] [role=status]').textContent.includes('บันทึก mobile-voice.png แล้ว'));assert.equal(store.size,beforeMobileSave+1,'spoken image save writes only after confirmation');
    await page.locator('[data-editor-files]').selectOption(picture.id);await say('เปิดไฟล์ที่เลือก');
    await page.waitForFunction(()=>document.querySelector('[data-studio-status]').textContent==='เปิดไฟล์ที่เลือกแล้ว');
    await page.getByRole('button',{name:'ดูตัวอย่างคำสั่งเสียง',exact:true}).click();assert(await page.locator('[data-creative-voice-help]').isVisible());await edit('ปิดตัวอย่างคำสั่งเสียง');
    await edit('คำสั่งเสียงสร้างสรรค์');
    const help=page.locator('[data-creative-voice-help]');assert(await help.isVisible());assert((await help.boundingBox()).width<=390);await help.getByRole('button',{name:'ปิดตัวอย่าง',exact:true}).click();
    await page.setViewportSize({width:1500,height:950});
    await edit('เพิ่มข้อความ ร่างใหม่ที่ยังไม่บันทึก');await edit('บันทึก');const beforeAccount=store.size;
    await page.evaluate(()=>{OS.state.user={sub:crypto.randomUUID(),roles:['user'],permissions:['chat']};window.dispatchEvent(new Event('panthorium:auth-changed'));});
    assert.equal((await page.evaluate(()=>PanthoriumCreativeStudio.command('ยืนยัน'))).ok,false);assert.equal(store.size,beforeAccount);assert.equal(await page.locator('[data-studio]').count(),0);
    await page.evaluate(()=>{OS.state.user={sub:'guest:test',roles:['guest'],permissions:['chat']};});assert.equal((await page.evaluate(()=>PanthoriumCreativeStudio.command('เปิดรูปภาพ'))).ok,false);
    assert.deepEqual(errors,[]);
    console.log('PASS creative mobile voice: readable/tappable controls at 320–1500px, one-tap shared microphone with denied-access recovery, image geometry/color/layers/crop/undo, exact save confirmation, selected-file opening and account cleanup; speech recognition is a fixture');
  }finally{await browser?.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
