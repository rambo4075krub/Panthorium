'use strict';
// Load the actual shell and all its observers, not an isolated menu fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-guest-menu-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'local-guest-menu-browser-test-only';
process.env.DATA_FILE = path.join(temporary, 'data.json');
process.env.AUDIT_FILE = path.join(temporary, 'audit.log');
const { app } = require('../server');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// A renderer stuck in a mutation loop must also fail on the Node side.
const deadline = setTimeout(() => { console.error('Guest shell stopped responding'); process.exit(1); }, 90000);
(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const mode of ['web', 'desktop', 'android']) {
      const context = await browser.newContext({
        viewport: mode === 'android' ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        ...(mode === 'android' ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' } : {})
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.addInitScript(mode => {
        if (mode === 'desktop') window.panthoriumDesktop = {
          isElectron: true,
          getAppInfo: async () => ({ version: '15.1.100', edition: 'user', platform: 'win32' }),
          getUpdateStatus: async () => ({ ok: true, available: false, current: '15.1.100', remote: '15.1.100' })
        };
        // Count without changing or disconnecting any production observer.
        window.menuMutations = 0;
        document.addEventListener('DOMContentLoaded', () => {
          new MutationObserver(records => { window.menuMutations += records.length; })
            .observe(document.getElementById('sm-apps'), { childList: true, subtree: true });
        });
      }, mode);
      await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof OS !== 'undefined' && OS.state.booted && OS.state.user?.roles?.includes('guest'));
      async function settled() {
        await pause(500);
        const before = await page.evaluate(() => window.menuMutations);
        await pause(500);
        assert.equal(await page.evaluate(() => window.menuMutations), before, mode + ': menu observers settle while idle');
      }
      await settled();
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.locator('#start-btn').click();
        assert(await page.locator('#start-menu').evaluate(el => el.classList.contains('open')));
        await settled();
        await page.locator('#start-search').fill('เข้าสู่ระบบ');
        assert(await page.locator('#sm-apps [data-app-id="account-login"]').isVisible());
        await page.locator('#start-search').press('Escape');
        assert.equal(await page.locator('#start-menu').evaluate(el => el.classList.contains('open')), false);
      }
      await page.locator('#start-btn').click();
      await page.locator('#start-search').fill('');
      await page.locator('#sm-apps [data-app-id="account-login"]').click();
      await page.locator('[data-login-email]').fill('guest-menu-test@example.invalid');
      await page.locator('[data-login-password]').fill('local-ui-test-only');
      assert.equal(await page.locator('[data-login-email]').inputValue(), 'guest-menu-test@example.invalid');
      assert(await page.locator('[data-login-submit]').isEnabled());
      await page.locator('[data-forgot]').click();
      await page.locator('[data-back-login]').click();
      await settled();
      console.log('Guest full shell ' + mode + ': idle observers, repeated Start, search, login inputs and password recovery navigation passed');
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
    clearTimeout(deadline);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
