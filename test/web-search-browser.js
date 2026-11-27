'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { createWebSearchRouter } = require('../routes/webSearch');
const directory = require('../search/directory');
const { PublicWebService } = require('../services/publicWebService');
const { createPublicAssetMiddleware } = require('../middleware/publicAssets');

async function main() {
  const calls = [], reads = [], app = express();
  const direct = new PublicWebService({http:{get:() => { throw Error('Unexpected network request for direct navigation'); }}});
  let releaseSlow, startSlow, moreCalls = 0;
  const slowStarted = new Promise(resolve => { startSlow = resolve; });
  app.use(createWebSearchRouter({ async execute(tool, args) {
    if (tool === 'web.read') {
      reads.push(args.url);
      if (args.url === 'https://publisher-3.org/') return {available:false,error:'web_robots_denied',message:'ต้นทางจำกัดการอ่าน'};
      return {available:true,url:args.url,title:'บทความจากต้นทาง',content:'ข้อความจากต้นทาง '.repeat(50)};
    }
    assert.equal(tool, 'web.search'); calls.push(args.query);
    if (args.query === 'ขอเว็บกรุงสันภาคอน') return {available:false,error:'web_no_results',broaderQuery:'กรุงสันภาคอน'};
    if (args.query === 'ขอเว็บกรมสรรพากร') return {available:true,broaderQuery:'กรมสรรพากร',results:[{
      title:'กรมสรรพากร',url:'https://www.rd.go.th/',kind:'official',source:'Wikipedia'
    }]};
    if (args.query === 'เว็บไซต์ทางการของ PRN') return {available:true,broaderQuery:'PRN',results:[{
      title:'PRN',url:'https://prn.example.org/',source:'Wikidata',kind:'official',recordUrl:'https://www.wikidata.org/wiki/Q123'
    }]};
    if (/^https?:\/\//u.test(args.query)) return direct.execute(tool,args,'fixture');
    if (args.query === 'open web collection' && args.page === 2) {
      if (++moreCalls === 1) return {available:false,error:'web_rate_limited'};
      return {available:true,results:[26,27].map(i => ({title:'Publisher ' + i,url:'https://publisher-' + i + '.org/',source:'Purili'}))};
    }
    if (args.query === 'open web collection') return {available:true,nextPage:2,results:Array.from({length:26},(_,i)=>({
      title:'Publisher ' + (i + 1),url:'https://publisher-' + (i + 1) + '.org/',source:'Purili'
    })),issues:[]};
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
    for (const page of [0,2.5,'2',1001]) assert.equal((await post({query:'example',page})).status,400);
    assert.equal((await post({query:'example.org',page:2})).status,400);
    assert.equal((await post({query:'  '})).status, 400);
    assert.equal((await post({query:'z'.repeat(301)})).status, 400);
    assert.equal((await post({query:'q'.repeat(5000)})).status, 413);
    assert.equal((await post({query:'Mozilla'}, 'text/plain')).status, 415);
    assert.equal((await (await post({query:'Bangkok riverside hotels',scope:'selected'})).json()).selected.length, 3);
    assert.deepEqual(calls, []);
    assert.deepEqual(directory.match('hotels in London'), []);
    assert.equal(directory.suggest('เชียงแม่'),'เชียงใหม่');
    assert.equal(directory.suggest('ร้านหนังสือ เชียงแม่'),'ร้านหนังสือ เชียงใหม่');
    assert.equal(directory.suggest('จังหวัดเชียงแม่'),'จังหวัดเชียงใหม่');
    assert.equal(directory.suggest('เชียงราย'),'');
    assert.equal(directory.suggest('ร้านหนังสือ เชียงใหม่'),'');
    assert.equal(directory.suggest('https://example.org/เชียงแม่'),'');
    assert.equal(directory.match('นิทรรศการ ศิลปะ กรุงเทพ').length, 3);
    assert.equal(directory.suggest('พิภิธภัณศิลปะ ไทย ร้องสมัย'), 'พิพิธภัณฑ์ศิลปะไทยร่วมสมัย');
    for (const exactOrUnrelated of ['โรงแรมริมแม่น้ำเจ้าพระยา','โรงแรมริมแม่น้ำเจ้าพระยาราคาถูก','โรงแรมริมแม่น้ำเชียงราย','นิทรรศการศิลปะกรุงโซล','ไฟน์ไดนิ่งในกรุงธนบุรี','โรงแรม Kyoto','ตารางรถไฟไปขอนแก่น','อย่าเปิดไฟล์']) {
      assert.equal(directory.suggest(exactOrUnrelated), '');
    }
    browser = await chromium.launch({ headless:true, executablePath:process.env.PANTHORIUM_TEST_BROWSER_PATH || undefined });
    const page = await browser.newPage({viewport:{width:1280,height:820}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.qaSpoken = [];
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
        speak(utterance) { window.qaSpoken.push(utterance.text); window.qaUtterance=utterance; }, cancel() {}
      }});
      window.SpeechRecognition = class {
        start() { window.testRecognizer = this; }
        abort() { window.testRecognizer = null; }
        stop() { this.onend?.(); }
      };
    });
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
    assert((await page.locator('#result-list .item-title').first().innerText()).startsWith('Source '));
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
    await page.keyboard.press('Escape');
    const dictate = async (text, language, control = '#mic') => {
      await page.locator(control).click();
      await page.waitForFunction(() => !!window.testRecognizer);
      assert.equal(await page.evaluate(() => window.testRecognizer.lang), language);
      assert(await page.locator('#voice-language').isDisabled());
      await page.evaluate(transcript => window.testRecognizer.onresult({resultIndex:0,results:[[{transcript}]]}),text);
    };
    const original = 'รุงแรม ริมแน้น้ำเจ้าพยา', corrected = 'โรงแรมริมแม่น้ำเจ้าพระยา';
    const start = calls.length;
    await dictate('ค้นเว็บ ' + original, 'th-TH');
    await page.getByRole('link',{name:'Source ' + original,exact:true}).waitFor();
    assert.equal(await page.locator('#query').inputValue(),original);
    assert.deepEqual(calls.slice(start),[original]);
    await dictate('ใช้คำที่แนะนำ', 'th-TH');
    await page.getByRole('link',{name:'Source ' + corrected,exact:true}).waitFor();
    assert.deepEqual(calls.slice(start),[original,corrected]);
    assert(await page.locator('#spelling').isHidden());
    await page.goBack();
    await page.locator('#spelling-query').waitFor();
    await page.getByRole('button',{name:'เฉพาะเว็บคัดสรร'}).click();
    await page.waitForFunction(() => document.getElementById('spelling-query').hash.includes('scope=selected'));
    const beforeSelected = calls.length;
    await page.locator('#spelling-query').click();
    await page.getByRole('link',{name:'Capella Bangkok',exact:true}).waitFor();
    assert.equal(calls.length,beforeSelected);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button',{name:'ทุกแหล่ง'}).click();
    await page.locator('#voice-language').selectOption('en-US');
    await page.reload();
    assert.equal(await page.locator('#voice-language').inputValue(),'en-US');
    await dictate('search the web for Kyoto hotels','en-US');
    await page.getByRole('link',{name:'Source Kyoto hotels',exact:true}).waitFor();
    assert(await page.locator('#spelling').isHidden());
    await page.locator('#mic').click();
    await page.waitForFunction(() => !!window.testRecognizer);
    await page.locator('#query').fill('คำค้นที่แก้เอง');
    assert.equal(await page.evaluate(() => window.testRecognizer),null);
    assert.equal(await page.locator('#voice-language').isEnabled(),true);
    assert.equal(await page.locator('#query').inputValue(),'คำค้นที่แก้เอง');
    await submit('open web collection');
    await page.locator('#more-results').waitFor();
    assert.equal(await page.locator('.result-item').count(),12);
    const beforeNavigation = calls.length;
    await page.locator('#voice-language').selectOption('th-TH');
    await dictate('เปิดผลลัพธ์ที่ ๒','th-TH');
    await page.locator('#reader[open]').waitFor();
    assert.equal(await page.locator('#reader-source').getAttribute('href'),'https://publisher-2.org/');
    await page.locator('#reader-listen').waitFor();
    await dictate('อ่านหน้านี้ให้ฟัง','th-TH','#reader-mic');
    await page.waitForFunction(()=>window.qaSpoken.length === 1);
    assert.match(await page.evaluate(()=>qaSpoken[0]),/ข้อความจากต้นทาง/u);
    assert((await page.evaluate(()=>qaSpoken[0].length)) <= 160);
    await dictate('กลับไปผลคนหา','th-TH','#reader-mic');
    await page.locator('#reader').waitFor({state:'hidden'});
    await page.evaluate(()=>qaUtterance.onend());
    assert.equal(await page.evaluate(()=>qaSpoken.length),1);
    assert.equal(await page.evaluate(()=>PanthoriumSpeechInput.resultCommand('อานม้าสำหรับเดินทาง')),null);
    await dictate('อานผลที่สามให้ฟัง','th-TH');
    await page.getByText('ต้นทางจำกัดการอ่าน',{exact:true}).waitFor();
    assert(await page.locator('#reader-listen').isHidden());
    assert.equal(await page.evaluate(()=>qaSpoken.length),1);
    await page.locator('#close-reader').click();
    await dictate('เปิดผลที่ 99','th-TH');
    await page.getByText('ตอนนี้มีผลที่แสดง 1 ถึง 12',{exact:true}).waitFor();
    assert.deepEqual(reads,['https://publisher-2.org/','https://publisher-3.org/']);
    assert.equal(calls.length,beforeNavigation);
    const oldContext = await page.evaluate(()=>PanthoriumSearchPage.voiceContext());
    await dictate('แสดงผลเพิ่มเติม','th-TH');
    assert.equal(await page.locator('.result-item').count(),24);
    assert.equal(await page.evaluate(ctx=>PanthoriumSearchPage.runVoiceCommand({action:'open',index:1},ctx).ok,oldContext),false);
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Publisher 13');
    await page.locator('#voice-language').selectOption('en-US');
    await dictate('open the twenty-first result','en-US');
    await page.locator('#reader[open]').waitFor();
    assert.equal(await page.locator('#reader-source').getAttribute('href'),'https://publisher-21.org/');
    await dictate('back to search results','en-US','#reader-mic');
    await page.locator('#reader').waitFor({state:'hidden'});
    await page.locator('#voice-language').selectOption('th-TH');
    await page.locator('#more-results').click();
    assert.equal(await page.locator('.result-item').count(),26);
    await page.locator('#more-results').click();
    await page.waitForFunction(()=>document.getElementById('search-status').textContent.includes('เพื่อลองอีกครั้ง'));
    assert.equal(await page.locator('.result-item').count(),26);
    await page.locator('#more-results').click();
    await page.getByRole('link',{name:'Publisher 27',exact:true}).waitFor();
    assert.equal(await page.locator('.result-item').count(),27);
    assert.equal(moreCalls,2);
    assert(await page.locator('#more-results').isHidden());
    await submit('ขอเว็บกรุงสันภาคอน');
    await page.getByText('ขอเว็บกรมสรรพากร',{exact:true}).waitFor();
    assert.equal(await page.locator('#query').inputValue(),'ขอเว็บกรุงสันภาคอน');
    assert.equal(await page.locator('#result-list li').count(),0);
    assert(!calls.includes('ขอเว็บกรมสรรพากร'));
    assert.equal(directory.suggestOrganization('กรมสรรพากร เชียงราย'),'');
    assert.equal(directory.suggestOrganization('ธนาคารกรุง'),'');
    await page.locator('#voice-language').selectOption('th-TH');
    await dictate('ใช้คำที่แนะนำ','th-TH');
    await page.locator('a.item-title[href="https://www.rd.go.th/"]').waitFor();
    assert.equal(await page.locator('#query').inputValue(),'ขอเว็บกรมสรรพากร');
    assert(await page.locator('#spelling').isHidden());
    await submit('เว็บไซต์ทางการของ PRN');
    await page.locator('a.item-title[href="https://prn.example.org/"]').waitFor();
    await page.locator('#all-web').waitFor();
    assert.equal(await page.locator('#query').inputValue(),'เว็บไซต์ทางการของ PRN');
    assert((await page.locator('#result-list .source').innerText()).includes('Wikidata'));
    await dictate('ค้นจากทุกเว็บไซต์','th-TH');
    await page.getByRole('link',{name:'Source PRN',exact:true}).waitFor();
    assert(await page.locator('#all-web').isHidden());
    const deep = 'https://www.python.org/downloads/?version=' + 'a'.repeat(315) + '#current';
    await submit(deep);
    await page.getByText('ที่อยู่เว็บไซต์ที่คุณระบุ',{exact:true}).waitFor();
    assert.equal(await page.locator('#result-list .item-title').first().getAttribute('href'),deep);
    assert.equal(await page.locator('#query').inputValue(),deep);
    await submit('https://localhost/private');
    await page.waitForFunction(()=>document.getElementById('search-status').textContent.includes('HTTPS สาธารณะ'));
    assert.equal(await page.locator('.result-item').count(),0);
    assert.deepEqual(errors,[]);
    console.log('Public search passed, including Thai and English voice selection, opt-in spelling, original queries, history and attribution');
  } finally {
    releaseSlow?.();
    await browser?.close(); server.closeAllConnections(); server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
