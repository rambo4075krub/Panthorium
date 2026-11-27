'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { createCommandSpeechRouter } = require('../routes/commandSpeech');
async function speechRoute() {
  const wav = Buffer.alloc(32044);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(16000,24); wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
  let verified = false, calls = 0, lastTurn;
  const app = express();
  app.use('/input', createCommandSpeechRouter({
    authService:{verifyAccessToken:() => ({sub:'reader', permissions:['chat']})},
    biometrics:{gateEnabled:true, list:async () => ['enrolled'], verify:async () => ({matched:verified})},
    speech:{available:() => true, transcribe:async (_audio, lang, _signal, purpose, hasSuggestion) => {
      calls++; lastTurn = [lang, purpose, hasSuggestion]; return 'เปิดหน้าค้นหา';
    }}
  }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const post = (route, body, token) => fetch('http://127.0.0.1:' + server.address().port + '/input/' + route,
    {method:'POST', headers:{'Content-Type':'audio/wav', ...(token ? {Authorization:'Bearer test'} : {})}, body});
  try {
    assert.equal((await post('commands',wav)).status,401);
    assert.equal((await post('search',Buffer.alloc(32044))).status,400);
    assert.equal((await post('search',Buffer.alloc(384046))).status,413);
    assert.equal(calls,0);
    assert.equal((await (await post('search',wav)).json()).commands,false);
    assert.deepEqual(lastTurn,['th','search',false]);
    for (const purpose of ['reader','results','unknown']) {
      assert.equal((await (await post('search?purpose='+purpose,wav)).json()).commands,false);
      assert.equal(lastTurn[1],purpose==='unknown' ? 'search' : purpose);
    }
    assert.equal((await (await post('search?purpose=command&lang=en&spelling=1',wav)).json()).commands,false);
    assert.deepEqual(lastTurn,['en','command',true]);
    assert.equal((await (await post('commands',wav,true)).json()).commands,false);
    assert.deepEqual(lastTurn,['th','command',false]);
    verified = true;
    assert.equal((await (await post('commands',wav,true)).json()).commands,true);
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
}
module.exports = async function systemVoice(browser, origin) {
  await speechRoute();
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}, isMobile:true, locale:'th-TH'});
  const page = await context.newPage(), sockets = [], queries = [], requests = [];
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => console.error('Shell script:', error.message));
  page.on('websocket',ws=>sockets.push(ws.url()));
  page.on('request',req=>requests.push(new URL(req.url()).pathname));
  await page.addInitScript(() => {
    window.webkitSpeechRecognition = window.SpeechRecognition = class {
      start() { window.testRecognition = this; }
      abort() { if(window.testRecognition === this) window.testRecognition = null; }
      stop() { this.onend?.(); }
    };
  });
  await page.route('**/api/search', route => {
    const query = route.request().postDataJSON().query; queries.push(query);
    const results = [{title:'Mozilla',url:'https://www.mozilla.org/',source:'Mwmbl'}];
    if (query === 'Mozilla') results.push({title:'Firefox',url:'https://www.firefox.com/',source:'Purili'});
    return route.fulfill({json:{selected:[],results,status:'ok'}});
  });
  await page.route('**/api/search/read', route => route.fulfill({json:{title:'Mozilla',url:'https://www.mozilla.org/',content:'Website text'}}));
  await page.route('**/api/hybrid/status', route=>route.fulfill({json:{geminiAllowed:false,local:{enabled:false,ready:false}}}));
  const frame = page.frameLocator('[data-browser-search]');
  const ready = () => page.waitForFunction(()=>typeof OS !== 'undefined' && OS.state.booted && OS.state.user && window.PanthoriumLiveVoice);
  const say = async (utterance, control='#desktop-voice') => {
    await page.locator(control).click();
    await page.waitForFunction(()=>!!window.testRecognition);
    await page.evaluate(text=>window.testRecognition.onresult({resultIndex:0,results:[[{transcript:text}]]}),utterance);
    await page.waitForFunction(()=>!window.PanthoriumSystemVoice.active());
  };
  try {
    await page.goto(origin); await ready();
    await page.locator('#start-btn').click();
    await page.locator('#sm-apps [data-app-id="browser"]').click();
    await frame.locator('#query').waitFor();
    assert(!await page.locator('[data-browser-address]').isVisible());
    assert.equal(await page.locator('#desktop-icons [data-search-launcher]').count(),0);
    assert.equal(new URL(page.url()).pathname,'/');
    await page.locator('#panthorium-browser-dashboard .win-btn.close').click();
    await say('เปิดหน้าเสิร์ช');
    await frame.locator('#query').waitFor();
    await say('คนเว็บ รุงแรม ริมแน้น้ำเจ้าพยา');
    await frame.locator('#spelling-query').waitFor();
    await say('ใช้คำที่แนะนำ');
    await frame.locator('#spelling').waitFor({state:'hidden'});
    assert.equal(await frame.locator('#query').inputValue(),'โรงแรมริมแม่น้ำเจ้าพระยา');
    await page.locator('#panthorium-browser-dashboard .win-btn.close').click();
    await page.goto(origin+'/search?q=Mozilla'); await ready();
    await frame.locator('.item-title').first().waitFor();
    const before = queries.length;
    await say('เปิดผลที่สอง');
    await frame.getByText('Website text',{exact:true}).waitFor();
    assert.equal(await frame.locator('#reader-source').getAttribute('href'),'https://www.firefox.com/');
    await say('กลับไปผลค้นหา');
    await frame.locator('#reader').waitFor({state:'hidden'});
    assert.equal(queries.length,before);
    assert.equal(await frame.locator('#query').inputValue(),'Mozilla');
    await say('ขอเว็บกรมสรรพากร');
    await frame.locator('.item-title').first().waitFor();
    assert(queries.includes('ขอเว็บกรมสรรพากร'));
    await frame.locator('.item-title').first().click();
    await frame.getByText('Website text',{exact:true}).waitFor();
    assert.equal(context.pages().length,1);
    await page.locator('#panthorium-browser-dashboard .win-btn.close').click();
    await page.evaluate(()=>{
      OS.state.user={sub:'voice-mock-user',id:'voice-mock-user',roles:['user'],permissions:['chat']};
      OS.config.accessToken='fixture-test-token';
      window.PanthoriumAuth.ensureSession=async()=>true;
      window.dispatchEvent(new Event('panthorium:auth-changed'));
    });
    await say('ค้นเว็บ โรงแรมริมเจ้าพระยา');
    await frame.locator('.item-title').first().waitFor();
    assert.equal(await frame.locator('#query').inputValue(),'โรงแรมริมเจ้าพระยา');
    assert(queries.includes('โรงแรมริมเจ้าพระยา'));
    assert(!sockets.some(url=>url.includes('/api/live')));
    await say('คนเว็บ รุงแรม ริมแน้น้ำเจ้าพยา');
    await frame.locator('#spelling-query').waitFor();
    await frame.getByRole('link',{name:'Mozilla',exact:true}).waitFor();
    assert.equal(await frame.locator('#query').inputValue(),'รุงแรม ริมแน้น้ำเจ้าพยา');
    await say('กดปุ่ม โรงแรมริมแม่น้ำเจ้าพระยา');
    assert(await page.evaluate(()=>PanthoriumScreenVoice.hasPending()));
    await say('ยืนยัน');
    await frame.locator('#spelling').waitFor({state:'hidden'});
    assert.equal(await frame.locator('#query').inputValue(),'โรงแรมริมแม่น้ำเจ้าพระยา');
    await page.locator('#panthorium-browser-dashboard .win-btn.close').click();
    await page.evaluate(()=>{
      const app=document.createElement('button'); app.type='button'; app.className='sm-app';
      app.dataset.appId='voice-test-app'; app.textContent='ห้องทดลองใหม่'; app.dataset.voiceAliases='แล็บใหม่';
      app.onclick=()=>{
        createWindow('voice-test-app','ห้องทดลองใหม่','<button data-save>บันทึกภาพรวม</button>');
        document.querySelector('[data-id="voice-test-app"] [data-save]').onclick=()=>{window.testSaved=(window.testSaved||0)+1;};
      };
      document.getElementById('sm-apps').append(app);
    });
    await say('เปิดแล็บใหม่');
    await page.locator('.window[data-id="voice-test-app"]').waitFor();
    await say('กดปุ่ม บันทึกภาพรวม');
    assert.equal(await page.evaluate(()=>PanthoriumScreenVoice.hasPending()),true,
      await page.evaluate(async()=>JSON.stringify({status:document.getElementById('desktop-voice').title,apps:PanthoriumSystemVoice.launchers().map(a=>a.id),snap:await PanthoriumScreenVoice.snapshot(),role:OS.state.user.roles})));
    assert.equal(await page.evaluate(()=>window.testSaved||0),0);
    await say('ยืนยัน');
    assert.equal(await page.evaluate(()=>window.testSaved),1);
    assert(!requests.some(path=>/^\/api\/(local\/chat|chat|agent\/execute)/.test(path)));
    assert.equal(await page.evaluate(()=>PanthoriumSystemVoice.resolveLocal('อย่าเปิดแล็บใหม่')),null);
    assert.equal(await page.evaluate(()=>PanthoriumSystemVoice.searchIntent('ค้นหาไฟล์ของฉัน')),null);
    console.log('In-system search and voice: Guest, exhausted account, internal reader, new app, native controls and confirmation passed');
  } finally { await context.close(); }
};
