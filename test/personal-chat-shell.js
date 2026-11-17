'use strict';
// Actual shell/theme/auth/stream wrappers, with only paid inference replaced.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'panthorium-personal-shell-'));
process.env.NODE_ENV='test';
process.env.JWT_SECRET='personal-full-shell-test-fixture-only';
process.env.DATA_FILE=path.join(temporary,'users.json');
process.env.AUDIT_FILE=path.join(temporary,'audit.log');
const {app,authService,sentinel}=require('../server');
sentinel.gateway.complete=async()=>({ok:true,text:'บันทึกแชทจากหน้าจอจริงแล้ว',provider:'fixture',usage:{totalTokens:0}});
(async()=>{
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser;
  try{
    await authService.init();
    const user=await authService.createManagedUser({username:'personal-shell-fixture',password:'fixture-password-not-production',roles:['user'],permissions:['chat']},'fixture');
    const session=await authService.issueSession(await authService.repository.findUserById(user.id));
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof OS!=='undefined'&&OS.state.booted&&OS.state.user?.roles?.includes('guest'));
    await page.evaluate(value=>{PanthoriumAuth.acceptSession({accessToken:value.accessToken,user:value.principal});openSentinel();},session);
    await page.waitForSelector('.personal-toolbar');
    await page.fill('#chat-input','ทดสอบแชทในหน้าจอจริง');await page.click('#chat-send');
    await page.waitForFunction(()=>document.getElementById('chat-messages').textContent.includes('บันทึกแชทจากหน้าจอจริงแล้ว'));
    await page.getByRole('button',{name:'รายการแชท',exact:true}).click();await page.waitForSelector('.personal-thread-title');
    assert((await page.locator('.personal-thread-title').first().textContent()).includes('ทดสอบแชท'));
    for(const width of [390,320,768]){
      await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
      const layout=await page.evaluate(()=>{const history=document.querySelector('.personal-history'),quota=document.querySelector('.personal-quota'),c=getComputedStyle(history);return {background:c.backgroundColor,top:history.getBoundingClientRect().top,quotaBottom:quota.getBoundingClientRect().bottom,right:history.getBoundingClientRect().right,width:innerWidth};});
      assert.equal(layout.background,'rgb(9, 23, 37)','history must remain opaque under the shared window theme');
      assert(layout.top>=layout.quotaBottom,'history must not cover quota warnings or wrapped toolbar controls');
      assert(layout.right<=layout.width,'history must fit the viewport');
    }
    assert.deepEqual(errors,[]);
    if(process.env.PERSONAL_CHAT_SHELL_SCREENSHOT)await page.screenshot({path:process.env.PERSONAL_CHAT_SHELL_SCREENSHOT});
    console.log('PASS full personal-chat shell: authenticated stream, production scripts, saved history and opaque responsive overlay at 320/390/768px');
  }finally{
    if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>setTimeout(resolve,250));fs.rmSync(temporary,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
