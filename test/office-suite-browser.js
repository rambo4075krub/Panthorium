'use strict';
// Actual Chromium -> HTTP -> native Office save, using disposable in-memory files.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const express=require('express');
const {chromium}=require('playwright');
const {CreativeStudioService}=require('../services/creativeStudioService');
const {MemoryCreativeStudioRepository}=require('../services/creativeStudioRepository');
const {createCreativeStudioRouter}=require('../routes/creativeStudio');
const {OfficeArtifactService,_internals}=require('../services/officeArtifactService');
(async()=>{
  const user={sub:randomUUID(),roles:['user'],permissions:['chat']},store=new Map();
  const files={ensureConfigured(){},async upload(owner,name,contentType,body){const file={id:randomUUID(),name,contentType,size:body.length};store.set(file.id,{...file,owner,body});return file;},async findObject(owner,id){const f=store.get(id);if(!f||f.owner!==owner)throw Error('file_not_found');return {id:f.id,name:f.name,contentType:f.contentType};},async readOwned(owner,id){return {...await this.findObject(owner,id),body:store.get(id).body};}};
  const studio=new CreativeStudioService({files,office:new OfficeArtifactService({files}),repository:new MemoryCreativeStudioRepository(),resolveUser:async u=>u});await studio.init();
  const sheet=await files.upload(user.sub,'data.xlsx','application/octet-stream',_internals.spreadsheetBuffer({title:'Data',sheets:[{name:'Data',rows:[['Name','Amount'],['A',100],['B',200]]}]}));
  const doc=await files.upload(user.sub,'report.docx','application/octet-stream',_internals.documentBuffer({title:'Report',sections:[{paragraphs:['Original text']}]},[]));
  const deck=await files.upload(user.sub,'slides.pptx','application/octet-stream',_internals.presentationBuffer({title:'Slides',slides:[{title:'First slide',bullets:['Text']} ]},[]));
  const app=express();app.use(express.json());app.use('/api/studio',createCreativeStudioRouter({verifyAccessToken:()=>user,validateAccountPrincipal:async u=>u},studio));
  for(const name of ['voice-window-catalog.js','office-suite-core.js','office-suite-ui.js','studio-editor-ui.js'])app.get('/'+name,(req,res)=>res.sendFile(path.join(__dirname,'..',name)));
  app.get('/',(req,res)=>res.type('html').send('<!doctype html><html><meta charset="utf-8"><body><script>window.OS={state:{user:'+JSON.stringify(user)+'},config:{accessToken:"test"}};window.windows=new Map();window.createWindow=(id,title,html,options)=>{const n=document.createElement("div");n.className="window";n.dataset.id=id;n.innerHTML=html;document.body.append(n);windows.set(id,{n,...options});};window.closeWindow=id=>{const item=windows.get(id);if(item){item.onClose?.();item.n.remove();windows.delete(id);}};window.PanthoriumCreativeStudio={showJob:job=>{window.savedJob=job;}};</script><script src="/voice-window-catalog.js"></script><script src="/office-suite-core.js"></script><script src="/office-suite-ui.js"></script><script src="/studio-editor-ui.js"></script></body></html>'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
    const open=async id=>{await page.evaluate(async id=>{window.PanthoriumStudioEditor.close();window.savedJob=null;await window.PanthoriumStudioEditor.open(id);},id);};
    const save=async()=>{await page.locator('[data-save]').click();await page.waitForFunction(()=>window.savedJob?.status==='completed');const id=await page.evaluate(()=>window.savedJob.files[0].id);return studio.editor.read(user,id);};
    await open(sheet.id);await page.locator('[data-cell="B2"]').fill('150');await page.locator('[data-cell="B2"]').press('Tab');
    await page.getByLabel('ตำแหน่งเซลล์',{exact:true}).fill('B4');await page.getByLabel('ค่าหรือสูตร',{exact:true}).fill('=SUM(B2:B3)');await page.getByRole('button',{name:'ใช้ค่า / สูตร',exact:true}).click();assert.equal(await page.locator('[data-cell="B4"]').inputValue(),'350');
    await page.waitForFunction(()=>document.querySelector('[data-draft-status]')?.textContent.includes('เก็บฉบับร่างบนบัญชีแล้ว'));
    await open(sheet.id);await page.getByRole('button',{name:'กู้คืนฉบับร่าง',exact:true}).click();const savedSheet=await save();assert.equal(savedSheet.sheets[0].cells.find(c=>c.cell==='B4').value,350);
    await open(doc.id);await page.locator('[data-text-index="0"]').fill('หัวเรื่องใหม่');await page.getByLabel('ขนาดตัวอักษร',{exact:true}).fill('32');await page.getByLabel('ขนาดตัวอักษร',{exact:true}).press('Tab');const savedDoc=await save();assert.equal(savedDoc.blocks[0].text,'หัวเรื่องใหม่');assert.equal(savedDoc.blocks[0].style.fontSize,32);
    await open(deck.id);await page.getByLabel('ซ้าย %',{exact:true}).fill('15');await page.getByLabel('บน %',{exact:true}).fill('10');await page.getByLabel('กว้าง %',{exact:true}).fill('70');await page.getByLabel('สูง %',{exact:true}).fill('20');await page.getByRole('button',{name:'ใช้ตำแหน่ง / ขนาด',exact:true}).click();
    page.once('dialog',d=>d.accept('สไลด์ใหม่'));await page.getByRole('button',{name:'＋ สไลด์',exact:true}).click();const savedDeck=await save();assert.equal(savedDeck.pageCount,2);assert.equal(savedDeck.blocks[0].geometry.x,15);
    await page.setViewportSize({width:390,height:844});await open(doc.id);assert(await page.locator('.po-paper').isVisible());
    await page.evaluate(()=>{OS.state.user={sub:'new-account',roles:['user'],permissions:['chat']};window.dispatchEvent(new Event('panthorium:auth-changed'));});assert.equal(await page.locator('[data-studio-editor]').count(),0);assert.deepEqual(errors,[]);
    console.log('PASS real Chromium Office: cell/formula, recoverable draft, editable document, style, slide geometry/new page, native save, narrow viewport and account cleanup');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
