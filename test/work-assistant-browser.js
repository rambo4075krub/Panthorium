'use strict';
// Chromium -> actual authenticated routers -> source parser -> native Office bytes.
// Fixtures never send email or call a paid model.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { fixture, pdfFixture } = require('./work-assistant');
const { createWorkAssistantRouter } = require('../routes/workAssistant');
const { createCreativeStudioRouter } = require('../routes/creativeStudio');
const { createFilesRouter } = require('../routes/files');
const { extractOfficeText } = require('../services/officeArtifactService');
(async () => {
  const f = fixture(), app = express(), errors = [];
  f.authService.verifyAccessToken = token => token === 'fixture' ? f.user : { ...f.other, roles: ['guest'], permissions: ['chat'] };
  f.files.list = async owner => ({ files: [...f.objects.values()].filter(file => file.owner === owner).map(({ body, owner, ...file }) => file) });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/work', createWorkAssistantRouter(f.authService, f.service));
  app.use('/api/studio', createCreativeStudioRouter(f.authService, f.studio));
  app.use('/api/files', createFilesRouter(f.authService, f.files));
  const scripts = ['voice-window-catalog.js', 'office-suite-core.js', 'office-suite-ui.js', 'studio-editor-ui.js', 'work-assistant-ui.js'];
  for (const script of scripts) app.get('/' + script, (req, res) => res.sendFile(path.join(__dirname, '..', script)));
  app.get('/', (req, res) => res.type('html').send(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0d121b}.window{height:100vh;width:100%;overflow:hidden}</style><body><div id="sm-apps"></div><script>
    window.OS={state:{user:${JSON.stringify(f.user)}},config:{accessToken:'fixture'}};
    window.windows=new Map();window.createWindow=(id,title,html,options)=>{const root=document.createElement('div');root.className='window';root.dataset.id=id;root.innerHTML=html;document.body.append(root);windows.set(id,{root,...options});};
    window.closeWindow=id=>{const item=windows.get(id);if(item){item.onClose?.();item.root.remove();windows.delete(id);}};
    window.PanthoriumCreativeStudio={showJob:job=>{window.savedJob=job;}};
    </script>${scripts.map(script => '<script src="/' + script + '"></script>').join('')}</body></html>`));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.PANTHORIUM_TEST_BROWSER_PATH ? { executablePath: process.env.PANTHORIUM_TEST_BROWSER_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } }); page.on('pageerror', failure => errors.push(failure.message));
    const base = 'http://127.0.0.1:' + server.address().port; await page.goto(base);
    await page.getByRole('button', { name: 'ผู้ช่วยงาน', exact: true }).click(); await page.locator('[data-work-editor]').waitFor({ state: 'visible' });
    await page.locator('[data-work-title]').fill('ข้อเสนองานลูกค้า');
    await page.locator('[data-work-upload]').setInputFiles({ name: 'customer-brief.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
    await page.waitForFunction(() => document.querySelector('[data-work-files] input:checked'));
    await page.locator('[data-work-instruction]').fill('สรุปยอดเงินและกำหนดส่งตามเอกสาร');
    await page.getByRole('button', { name: 'สรุปไฟล์', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-work-status]').textContent.includes('ประมวลผลแล้ว'));
    assert.match(await page.locator('[data-work-draft]').inputValue(), /1200/);
    await page.locator('[data-work-evidence] > details > summary').click(); assert.match(await page.locator('[data-work-evidence]').textContent(), /หน้า 1/);
    await page.getByRole('button', { name: 'สร้าง Word', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-work-status]').textContent.includes('สร้างไฟล์แล้ว'));
    const nativeRow = page.locator('[data-work-outputs] .wa-actions').filter({ hasText: '.docx' }).first();
    const downloadPromise = page.waitForEvent('download'); await nativeRow.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click();
    const download = await downloadPromise, bytes = await fs.readFile(await download.path()); assert.match(extractOfficeText(bytes), /1200/);
    await nativeRow.getByRole('button', { name: 'เปิดแก้ไข', exact: true }).click(); await page.locator('[data-studio-editor]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-studio-editor]')?.textContent.includes('1200'));
    assert.match(await page.locator('[data-studio-editor]').textContent(), /1200/); await page.evaluate(() => window.PanthoriumStudioEditor.close());
    await page.getByRole('button', { name: 'เพิ่มรายการงาน', exact: true }).click();
    await page.getByLabel('ชื่องาน', { exact: true }).fill('ส่งข้อเสนอให้ลูกค้า');
    const localDay = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await page.locator('[data-work-dialog] input[type="datetime-local"]').fill(localDay + 'T17:00');
    await page.getByLabel('การเตือน', { exact: true }).selectOption('30');
    await page.getByLabel('ยืนยันให้ส่งการเตือนถึงอีเมลที่ยืนยันแล้วของบัญชีฉัน', { exact: true }).check();
    await page.getByRole('button', { name: 'ยืนยันและบันทึก', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-work-dialog]').open);
    assert.match(await page.locator('[data-work-tasks]').textContent(), /เตือนทางอีเมลก่อน 30 นาที/);
    const tasks = (await f.service.list({ user: f.user })).projects[0].tasks; assert.equal(tasks.length, 1);
    assert.equal((await f.memory.repository.get(f.user.sub, tasks[0].id)).title, 'ส่งข้อเสนอให้ลูกค้า');
    const screenshotDir = process.env.WORK_ASSISTANT_SCREENSHOT_DIR;
    if (screenshotDir) { await fs.mkdir(screenshotDir, { recursive: true }); await page.locator('[data-work]').evaluate(root => { root.scrollTop = 0; }); await page.screenshot({ path: path.join(screenshotDir, 'work-assistant-desktop.png'), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.locator('[data-work-title]').isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Phone layout must not overflow horizontally');
    await page.locator('[data-work-draft]').scrollIntoViewIfNeeded();
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'work-assistant-mobile.png') });
    const unauth = await fetch(base + '/api/work'); assert.equal(unauth.status, 401);
    const guest = await fetch(base + '/api/work', { headers: { Authorization: 'Bearer guest' } }); assert.equal(guest.status, 403);
    await page.evaluate(() => { OS.state.user = { sub: 'guest:test', roles: ['guest'], permissions: ['chat'] }; dispatchEvent(new Event('panthorium:auth-changed')); });
    assert.equal(await page.locator('[data-work]').count(), 0); assert.deepEqual(errors, []);
    console.log('PASS real Chromium work assistant: authenticated upload, PDF citations, native Word download and editor, linked deadline/reminder, desktop/mobile layout, guest rejection and logout cleanup');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(failure => { console.error(failure); process.exitCode = 1; });
