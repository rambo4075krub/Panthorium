'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { AuthService } = require('../services/authService');
const { SocialRepository } = require('../services/socialRepository');
const { SocialService } = require('../services/socialService');
const { createSocialRouter } = require('../routes/social');
(async () => {
  const user = { id: randomUUID(), username: 'ผู้สอบถาม', roles: ['user'], permissions: ['chat'] };
  const admin = { ...user, id: randomUUID(), username: 'support-admin', roles: ['administrator'] };
  for (const u of [user, admin]) u.sub = u.id;
  const auth = new AuthService({ config: { jwtSecret: 'contact-browser-test', accessTokenTtl: '1h' }, audit: { record() {} } });
  const social = new SocialService({ repository: new SocialRepository({ allowMemory: true }), files: {}, supportAdminUsername: admin.username, accounts: {
    findUserByUsername: async name => [user, admin].find(u => u.username === name),
    findUserById: async id => [user, admin].find(u => u.id === id),
  }});
  await social.init();
  const app = express(); app.use(express.json()); app.use('/api/social', createSocialRouter(auth, social));
  for (const file of ['social-ui.js', 'contact-ui.js']) app.get('/' + file, (_, res) => res.sendFile(require('node:path').join(__dirname, '..', file)));
  app.get('/api/files', (_, res) => res.json({ ok: true, items: [] }));
  app.get('/', (_, res) => res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="sm-apps"></div><div id="start-menu"></div><script>
    window.createWindow=(id,title,markup,opts)=>{const el=document.createElement('div');el.className='window';el.dataset.id=id;el.style.cssText='position:fixed;inset:0;z-index:10';el.innerHTML=markup;document.body.append(el);OS.windows.set(id,{el,onClose:opts?.onClose});};
    window.focusWindow=id=>{document.querySelectorAll('.window').forEach(el=>el.style.zIndex=el.dataset.id===id?'20':'10');};
    </script><script src="/social-ui.js"></script><script src="/contact-ui.js"></script>`));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const customer = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const staff = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    for (const [page, actor] of [[customer, user], [staff, admin]]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ actor, token }) => { window.OS = { state: { user: actor }, config: { backendUrl: location.origin, accessToken: token }, windows: new Map() }; }, { actor, token: auth.signAccessToken(actor) });
      await page.goto('http://127.0.0.1:' + server.address().port);
    }
    await customer.evaluate(() => PanthoriumContact.open());
    await customer.getByRole('heading', { name: 'ศูนย์ช่วยเหลือ', exact: true }).waitFor();
    assert(await customer.locator('[data-panthorium-contact]').evaluate(el => el.scrollWidth <= el.clientWidth));
    if (process.env.CONTACT_SCREENSHOT) await customer.screenshot({ path: process.env.CONTACT_SCREENSHOT });
    await customer.getByRole('button', { name: 'แชทกับเรา', exact: true }).click();
    await customer.getByRole('heading', { name: 'แอดมิน Panthorium', exact: true }).waitFor();
    await customer.getByLabel('ข้อความ', { exact: true }).fill('ขอความช่วยเหลือ');
    await customer.getByRole('button', { name: 'ส่ง', exact: true }).click();
    await customer.getByText('ขอความช่วยเหลือ', { exact: true }).waitFor();
    await staff.evaluate(() => PanthoriumContact.open());
    await staff.getByRole('button', { name: 'แชทกับเรา', exact: true }).click();
    await staff.getByRole('heading', { name: 'ผู้สอบถาม', exact: true }).waitFor();
    await staff.locator('[data-social="talk"] [data-record-id]').click();
    await staff.getByLabel('ข้อความ', { exact: true }).fill('แอดมินได้รับเรื่องแล้ว');
    await staff.getByRole('button', { name: 'ส่ง', exact: true }).click();
    await customer.getByText('แอดมินได้รับเรื่องแล้ว', { exact: true }).waitFor();
    assert.match(await customer.locator('[data-social-messages] small').last().textContent(), /แอดมิน Panthorium/);
    await customer.locator('[data-delivery="read"]').waitFor();
    // Reopen from contact while Talk already exists; preserve the same conversation.
    await customer.evaluate(() => PanthoriumContact.open());
    await customer.getByRole('button', { name: 'แชทกับเรา', exact: true }).click();
    await customer.getByText('แอดมินได้รับเรื่องแล้ว', { exact: true }).waitFor();
    assert.equal(await customer.locator('[data-social="talk"]').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Contact browser: mobile layout, direct Talk handoff, administrator inbox, two-way replies, read receipt and reopening passed');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
