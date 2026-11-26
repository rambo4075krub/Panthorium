'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {chromium} = require('playwright');
const {PDFDocument} = require('pdf-lib');
const {Resvg} = require('@resvg/resvg-js');
const {withToolAccounts} = require('./online-tools-postgres');
const {createOnlineToolsRouter} = require('../routes/onlineTools');

async function verify({accounts: [owner, collaborator], service, pool}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'panthorium-tools-browser-'));
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'online-tools-local-fixture-only';
  process.env.DATA_FILE = path.join(dir, 'accounts.json');
  process.env.AUDIT_FILE = path.join(dir, 'audit.log');
  process.env.PANTHORIUM_FILES_BUCKET = 'fixture-tools-files';
  process.env.PANTHORIUM_OBJECT_ROOT = dir;
  const sqlite = new (require('node:sqlite').DatabaseSync)(path.join(dir, 'objects.sqlite3'));
  sqlite.exec(
    'CREATE TABLE objects(name TEXT PRIMARY KEY,content_type TEXT,created TEXT,updated TEXT,generation TEXT,sha256 TEXT,metadata TEXT,body BLOB)'
  );
  sqlite.close();
  const real = require('../server');
  await real.authService.init();
  const loginEmail = 'tools-owner@example.test',
    loginPassword = 'local-tools-test-password';
  await real.authService.repository.createUser({
    id: owner,
    username: loginEmail,
    email: loginEmail,
    emailVerifiedAt: new Date().toISOString(),
    passwordHash: await require('bcryptjs').hash(loginPassword, 4),
    roles: ['user'],
    permissions: ['chat']
  });
  const copyEmail = 'tools-team@example.test';
  await real.authService.repository.createUser({
    id: collaborator,
    username: copyEmail,
    email: copyEmail,
    emailVerifiedAt: new Date().toISOString(),
    passwordHash: await require('bcryptjs').hash(loginPassword, 4),
    roles: ['user'],
    permissions: ['chat']
  });
  const filmTest = require('./film-studio-browser');
  const filmFixture = await filmTest.fixture({studio: real.creativeStudio, service, pool, dir});
  const app = express();
  app.use(
    '/api/online-tools',
    express.json({limit: '2mb'}),
    createOnlineToolsRouter(real.authService, service, filmFixture.film)
  );
  app.use(real.app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  let browser, page;
  try {
    browser = await chromium.launch({headless: true});
    const base = 'http://127.0.0.1:' + server.address().port;
    page = await browser.newPage({viewport: {width: 1280, height: 900}, acceptDownloads: true});
    page.setDefaultTimeout(12000);
    const scriptErrors = [];
    page.on('pageerror', (err) => scriptErrors.push(err.message));
    await page.goto(base, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(
      () =>
        typeof OS !== 'undefined' &&
        OS.state.booted &&
        OS.state.user?.roles?.includes('guest') &&
        window.PanthoriumOnlineTools
    );
    assert.equal(await page.locator('[data-app-id="online-tools"]').count(), 0);
    await page.evaluate((cred) => window.PanthoriumAuth.login(...cred), [loginEmail, loginPassword]);
    await page.locator('#start-btn').click();
    const group = page.locator('[data-start-group="creative"]');
    await group.locator('[data-start-group-toggle]').click();
    assert.equal(await page.locator('[data-app-id="online-tools"]').count(), 0);
    assert.deepEqual(
      await group.locator('.sm-app').evaluateAll((nodes) => nodes.map((n) => n.dataset.appId)),
      [
        'studio-image',
        'studio-video',
        'studio-document',
        'studio-spreadsheet',
        'studio-presentation',
        'studio-form',
        'studio-pdf',
        'studio-page',
        'studio-flow'
      ]
    );
    const search=page.locator('#start-search');
    await search.fill('ซีรีส์');
    await group.locator('[data-app-id="studio-video"]:visible').waitFor();
    assert.deepEqual(await group.locator('.sm-app:visible').evaluateAll(nodes=>nodes.map(n=>n.dataset.appId)),['studio-video']);
    await search.fill('เครื่องมือออนไลน์');
    await group.locator('[data-app-id="studio-flow"]:visible').waitFor();
    assert.equal(await group.locator('.sm-app:visible').count(),9);
    await search.fill('');
    await group.locator('[data-app-id="studio-form"]').click();
    const shell = page.locator('.window[data-id="creative-studio"]');
    const hub = shell.locator('[data-online-tools]:visible');
    const btn = (name) => hub.getByRole('button', {name, exact: true});
    const tool = async (k) => {
      const parent = {design: 'image', cutout: 'image', film: 'video'}[k];
      await shell.locator('[data-studio-section="' + (parent || k) + '"]').click();
      if (parent) await shell.locator('[data-studio-mode-id="' + k + '"]').click();
    };
    async function save() {
      await btn('บันทึกงาน').click();
      await hub.getByText('บันทึกแล้ว', {exact: true}).waitFor();
    }
    async function download(b) {
      const [d] = await Promise.all([page.waitForEvent('download'), b.click()]);
      return fs.readFile(await d.path());
    }
    assert.equal(await shell.locator('[data-studio-tabs] button').count(), 9);
    assert.equal(await page.locator('.window[data-id="online-tools"]').count(), 0);
    await tool('form');
    await btn('สร้างใหม่').click();
    await hub.getByLabel('ชื่องาน', {exact: true}).fill('ใบจองสินค้า');
    await tool('pdf');
    await tool('form');
    assert.equal(await hub.getByLabel('ชื่องาน', {exact: true}).inputValue(), 'ใบจองสินค้า');
    await hub.getByLabel('คำถาม', {exact: true}).fill('ชื่อสินค้า');
    await save();
    await hub.getByText('ลิงก์และสิทธิ์', {exact: true}).click();
    await btn('เปิดลิงก์รับคำตอบ').click();
    const publicUrl = await hub.getByLabel('ลิงก์ที่แชร์ได้').inputValue();
    await tool('flow');
    await btn('สร้างใหม่').click();
    await hub.getByLabel('ชื่องาน', {exact: true}).fill('ติดตามใบจอง');
    await hub.getByLabel('เมื่อมีคำตอบเข้าแบบฟอร์ม').selectOption({label: 'ใบจองสินค้า'});
    await hub.getByLabel('ใช้คำตอบใดเป็นชื่อรายการงาน').selectOption({label: 'ชื่อสินค้า'});
    await hub.getByLabel('เปิดใช้งานเมื่อบันทึก').check();
    await save();
    const portable = JSON.parse((await download(btn('ส่งออกแม่แบบ JSON'))).toString());
    assert.deepEqual(portable.actions, ['record', 'notify']);
    assert(!JSON.stringify(portable).includes(owner));
    const mobile = await browser.newPage({
      viewport: {width: 390, height: 844},
      isMobile: true,
      hasTouch: true
    });
    const response = await mobile.goto(publicUrl);
    assert(response.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
    await mobile.getByLabel('ชื่อสินค้า').fill('กระเป๋าผ้า');
    await mobile.getByRole('button', {name: 'ส่งคำตอบ'}).click();
    await mobile.getByText('ส่งคำตอบแล้ว ขอบคุณที่ตอบแบบฟอร์ม').waitFor();
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await hub.getByText('รายการจากเวิร์กโฟลว์', {exact: true}).click();
    await hub.getByText('กระเป๋าผ้า', {exact: true}).waitFor();
    await btn('ทำเครื่องหมายเสร็จ').click();
    await btn('เปิดงานอีกครั้ง').waitFor();
    await tool('form');
    assert.equal(await hub.getByLabel('ชื่องาน', {exact: true}).inputValue(), 'ใบจองสินค้า');
    await hub.getByText('คำตอบและไฟล์ CSV', {exact: true}).click();
    assert((await download(btn('ดาวน์โหลดคำตอบทั้งหมด CSV'))).toString().includes('"กระเป๋าผ้า"'));
    await tool('flow');
    await btn('กลับไปรายการ').click();
    await hub.getByLabel('นำเข้าแม่แบบ JSON').setInputFiles({
      name: 'workflow.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(portable))
    });
    assert.equal(await hub.getByLabel('ชื่องาน', {exact: true}).inputValue(), 'ติดตามใบจอง');
    assert.equal(await hub.getByLabel('เมื่อมีคำตอบเข้าแบบฟอร์ม').inputValue(), '');
    assert.equal(await hub.getByLabel('เปิดใช้งานเมื่อบันทึก').isChecked(), false);
    await tool('design');
    await btn('สร้างใหม่').click();
    await hub.getByLabel('ชื่องาน', {exact: true}).fill('เมนูร้าน');
    await hub.getByLabel('รูปแบบ', {exact: true}).selectOption('menu');
    await hub.getByLabel('หัวเรื่อง', {exact: true}).fill('เมนูวันนี้');
    await hub.getByLabel('รายการและราคา', {exact: false}).fill('ชาไทย 45 บาท\nกาแฟ 50 บาท');
    await save();
    const poster = await download(btn('ดาวน์โหลด PNG'));
    assert.equal(poster.readUInt32BE(16), 1080);
    assert.equal((await PDFDocument.load(await download(btn('ดาวน์โหลด PDF')))).getPageCount(), 1);
    await hub.getByText('ลิงก์และสิทธิ์', {exact: true}).click();
    await btn('เปิดลิงก์แม่แบบสำหรับทำสำเนา').click();
    await mobile.goto(await hub.getByLabel('ลิงก์ที่แชร์ได้').inputValue());
    await mobile.locator('canvas').waitFor();
    assert(
      (await mobile.getByRole('link', {name: 'ทำสำเนาใน Panthorium'}).getAttribute('href')).startsWith(
        '/#online-copy='
      )
    );
    await mobile.getByRole('link', {name: 'ทำสำเนาใน Panthorium'}).click();
    await mobile.locator('[data-login-email]').fill(copyEmail);
    await mobile.locator('[data-login-password]').fill(loginPassword);
    await mobile.locator('[data-login-submit]').click();
    await mobile.getByRole('button', {name: 'สร้างสำเนาในบัญชีของฉัน'}).click();
    await mobile
      .locator('[data-online-tools]')
      .getByRole('button', {name: 'บันทึกงาน', exact: true})
      .waitFor();
    assert.equal((await service.list(collaborator)).filter((x) => x.kind === 'design' && x.owner).length, 1);
    await tool('page');
    await btn('เช็กลิสต์เปิดร้าน').click();
    await save();
    await tool('cutout');
    const png = new Resvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="white"/><rect x="15" y="15" width="30" height="30" fill="red"/></svg>'
    )
      .render()
      .asPng();
    await hub
      .getByLabel('รูปสินค้า', {exact: true})
      .setInputFiles({name: 'product.png', mimeType: 'image/png', buffer: png});
    await hub.locator('canvas').waitFor();
    await btn('ลบพื้นหลังจากขอบภาพ').click();
    const cut = await download(btn('ดาวน์โหลด PNG'));
    const alpha = await page.evaluate(async (b64) => {
      const p = new Image();
      p.src = 'data:image/png;base64,' + b64;
      await p.decode();
      const c = document.createElement('canvas');
      c.width = p.width;
      c.height = p.height;
      const g = c.getContext('2d');
      g.drawImage(p, 0, 0);
      return [g.getImageData(0, 0, 1, 1).data[3], g.getImageData(30, 30, 1, 1).data[3]];
    }, cut.toString('base64'));
    assert.deepEqual(alpha, [0, 255]);
    await btn('บันทึก PNG ในไฟล์ของฉัน').click();
    await hub.getByText('บันทึกในไฟล์ของฉันแล้ว', {exact: true}).waitFor();
    const files = await page.evaluate(
      async () =>
        await (
          await fetch('/api/files', {headers: {Authorization: 'Bearer ' + OS.config.accessToken}})
        ).json()
    );
    assert(files.files.some((f) => f.name === 'product-โปร่งใส.png' && f.contentType === 'image/png'));
    await tool('pdf');
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.addPage([200, 200]);
    await hub.getByLabel('เลือก PDF หรือรูปภาพ').setInputFiles([
      {name: 'source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save())},
      {name: 'photo.png', mimeType: 'image/png', buffer: png}
    ]);
    await hub.getByLabel('หน้าที่เลือก', {exact: false}).fill('2,1');
    await hub.locator('.ot-filelist li').nth(1).getByRole('button', {name: 'ขึ้น', exact: true}).click();
    const merged = await PDFDocument.load(await download(btn('ดาวน์โหลด PDF')));
    assert.deepEqual(
      merged.getPages().map((p) => Math.round(p.getWidth())),
      [595, 200, 100]
    );
    for (const plugin of ['document', 'spreadsheet', 'presentation', 'image', 'video']) {
      await tool(plugin);
      assert.equal(
        await shell.locator('[data-studio-tabs] [aria-selected="true"]').getAttribute('data-plugin-id'),
        plugin
      );
      assert.equal(await shell.locator('[data-workspace-kind="' + plugin + '"]:visible').count(), 1);
      assert.equal(await hub.count(), 0);
    }
    await page.evaluate(() => (location.hash = 'online-tools'));
    await shell.locator('[data-studio-section="image"][aria-selected="true"]').waitFor();
    assert.equal(await page.locator('.window[data-id="online-tools"]').count(), 0);
    const filmContext={page,hub,owner,other:collaborator,fixture:filmFixture,service,pool,dir};
    await filmTest.verify(filmContext);
    await require('./feature-film-browser').verify(filmContext);
    await page.setViewportSize({width: 390, height: 844});
    await tool('design');
    assert(await hub.evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
    await page.evaluate(() => {
      OS.state.user = null;
      window.dispatchEvent(new Event('panthorium:auth-changed'));
    });
    assert.equal(await hub.count(), 0);
    assert.deepEqual(scriptErrors, []);
    console.log(
      'Unified creative Start menu, nine distinct sections, legacy landing, retained drafts, customer form to team task and CSV, reusable workflow and design, transparent PNG, ordered PDF and account cleanup passed in Chromium.'
    );
  } catch (err) {
    if (page)
      console.error((await page.locator('[data-online-tools]').allTextContents()).join(' ').slice(-1200));
    throw err;
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, {recursive: true, force: true});
  }
}
withToolAccounts(verify).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
