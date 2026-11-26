'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { createWebSearchRouter } = require('../routes/webSearch');
const directory = require('../search/directory');
const { createPublicAssetMiddleware } = require('../middleware/publicAssets');

async function main() {
  const calls = [], app = express();
  let releaseSlow, startSlow;
  const slowStarted = new Promise(resolve => { startSlow = resolve; });
  app.use(createWebSearchRouter({ async execute(tool, args) {
    assert.equal(tool, 'web.search'); calls.push(args.query);
    if (args.query === 'slow') { startSlow(); await new Promise(resolve => { releaseSlow = resolve; }); }
    if (args.query === 'busy') return {available:false, error:'web_rate_limited'};
    if (args.query === 'absent') return {available:false, error:'web_no_results'};
    return {available:true, results:[{title:'Source ' + args.query, url:'https://www.mozilla.org/', excerpt:'Public source', source:'Mwmbl'}], issues:[]};
  } }));
  app.use(createPublicAssetMiddleware(require('node:path').join(__dirname, '..')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    const post = (body, type = 'application/json') => fetch(origin + '/api/search', { method:'POST', headers:{'Content-Type':type}, body:JSON.stringify(body) });
    assert.equal((await post({query:'  '})).status, 400);
    assert.equal((await post({query:'z'.repeat(301)})).status, 400);
    assert.equal((await post({query:'q'.repeat(5000)})).status, 413);
    assert.equal((await post({query:'Mozilla'}, 'text/plain')).status, 415);
    assert.equal((await (await post({query:'Bangkok riverside hotels',scope:'selected'})).json()).selected.length, 3);
    assert.deepEqual(calls, []);
    assert.deepEqual(directory.match('hotels in London'), []);
    browser = await chromium.launch({ headless:true, executablePath:process.env.PANTHORIUM_TEST_BROWSER_PATH || undefined });
    const page = await browser.newPage({viewport:{width:1280,height:820}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/browser-download.html');
    assert.equal(await page.getByRole('link', {name:'เปิด Panthorium Search'}).getAttribute('href'), '/#search');
    await page.goto(origin + '/search');
    await page.locator('.artwork img').waitFor();
    for (const width of [1280, 768, 360]) {
      await page.setViewportSize({width, height:820});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.getByRole('link', {name:/โรงแรมริมเจ้าพระยา/}).click();
    await page.waitForFunction(() => document.querySelectorAll('.result-item').length === 4);
    for (const button of (await page.locator('[data-pick]').all()).slice(0,3)) await button.click();
    assert(await page.locator('[data-pick]').last().isDisabled());
    await page.locator('#open-compare').click();
    assert.equal(await page.locator('.compare-card').count(),3);
    assert(await page.locator('#comparison').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.getByRole('button', {name:/นำ Capella Bangkok ออก/}).click();
    assert.equal(await page.locator('.compare-card').count(),2);
    await page.keyboard.press('Escape');
    await page.reload();
    assert.equal(await page.locator('#count').textContent(),'2');
    await page.getByRole('button', {name:'เฉพาะเว็บคัดสรร'}).click();
    await page.waitForFunction(() => document.querySelectorAll('.result-item').length === 3);
    const previous = calls.length;
    const submit = async value => { await page.locator('#query').fill(value); await page.locator('#query').press('Enter'); };
    await submit('MOCA');
    await page.getByRole('link',{name:'MOCA Bangkok',exact:true}).waitFor();
    assert.equal(calls.length, previous);
    await page.getByRole('button',{name:'ทุกแหล่ง'}).click();
    await page.getByRole('link',{name:'Source MOCA'}).waitFor();
    await submit('slow');
    await slowStarted;
    await submit('busy');
    await page.waitForFunction(() => document.getElementById('search-status').textContent.includes('ขีดจำกัด'));
    releaseSlow?.();
    await submit('absent');
    await page.waitForFunction(() => document.getElementById('search-status').textContent.includes('ยังไม่พบ'));
    await page.goto(origin + '/search?q=Mozilla');
    await page.getByRole('link',{name:'Source Mozilla'}).waitFor();
    assert.equal(new URL(page.url()).search,'');
    await submit('Le Du'); await page.getByRole('link',{name:'Le Du · ฤดู',exact:true}).waitFor();
    await page.goBack(); await page.getByRole('link',{name:'Source Mozilla'}).waitFor();
    await page.locator('#open-compare').click(); await page.locator('#clear').click();
    assert.equal(await page.locator('#count').textContent(),'0');
    assert.deepEqual(errors,[]);
    console.log('Public search: guest entry, input limits, responsive layout, source filters, comparison, stale replies, quota and navigation passed');
  } finally {
    releaseSlow?.();
    await browser?.close(); server.closeAllConnections(); server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
