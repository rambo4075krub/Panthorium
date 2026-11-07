'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), { JSDOM } = require('jsdom');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
(async () => {
  const dom = new JSDOM('<div id="sm-apps"></div>', { runScripts: 'outside-only', url: 'https://panthorium.example/', pretendToBeVisual: true }), w = dom.window;
  let agentLinked = false; const requests = [], oauth = [];
  const standard = { id: 'google:owner', provider: 'google', email: 'owner@example.com', purpose: 'standard' };
  const agent = { ...standard, id: 'google:agent:owner', purpose: 'agent' };
  w.OS = { state: { user: { sub: 'owner', roles: ['user'] } }, config: { backendUrl: 'https://panthorium.example', accessToken: 'fixture' }, windows: new Map() };
  w.createWindow = (id, title, html) => { const e = w.document.createElement('div'); e.innerHTML = html; w.document.body.append(e); w.OS.windows.set(id, e); };
  w.open = () => { const popup = { location: {}, close() {} }; oauth.push(popup); return popup; };
  w.fetch = async (input, init = {}) => {
    const url = new URL(input); requests.push({ path: url.pathname, search: url.search, method: init.method, body: init.body && JSON.parse(init.body) });
    if (url.pathname.endsWith('/status')) return Response.json({ ok: true, enabled: true, aiEnabled: true, email: standard.email, providers: ['google'], agentProviders: ['google'], connections: agentLinked ? [standard, agent] : [standard], onboardingRequired: false });
    if (url.pathname.endsWith('/connect')) return Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture-agent' });
    if (url.pathname.endsWith('/connection')) { assert.equal(url.searchParams.get('purpose'), 'agent'); agentLinked = false; return Response.json({ ok: true }); }
    if (url.pathname.endsWith('/analyze')) { assert.equal(JSON.parse(init.body).connectionId, agent.id); return Response.json({ text: 'Fixture summary', sources: [] }); }
    if (url.pathname.endsWith('/prepare')) return Response.json({proposalId:'private-proposal',preview:{action:'trash',account:standard.email,subject:'Fixture mail',messageId:'private-message'}});
    if (url.pathname.endsWith('/confirm')) return Response.json({status:'done'});
    if (url.searchParams.get('action') === 'get') return Response.json({ message: { id: 'm1', subject: 'Fixture mail', text: 'Fixture body', from: 'sender@example.com', date: '', attachments: [] } });
    return Response.json({ ok: true, items: url.searchParams.get('action') === 'list' ? [{ id: 'm1', subject: 'Fixture mail', from: 'sender@example.com' }] : [], complete: true });
  };
  const click = async label => { const b = [...w.document.querySelectorAll('button')].find(x => x.textContent === label); assert(b, 'button exists: ' + label); b.click(); await settle(); };
  try {
    w.eval(fs.readFileSync('action-presentation.js', 'utf8'));w.eval(fs.readFileSync('user-mailbox-ui.js', 'utf8')); await w.PanthoriumUserMailbox.open();
    await click('เชื่อมต่อ AI และเสียง');
    assert(w.document.body.textContent.includes('Sentinel AI ประมวลผลอีเมล'));
    assert.equal(requests.filter(x => x.path.endsWith('/connect')).length, 0, 'disclosure precedes OAuth');
    await click('ดำเนินการต่อไปยังผู้ให้บริการ');
    assert.deepEqual(requests.find(x => x.path.endsWith('/connect')).body, { provider: 'google', purpose: 'agent' });
    assert.match(oauth[0].location.href, /^https:\/\/accounts.google.com\//);
    agentLinked = true; w.dispatchEvent(new w.Event('focus')); await settle();
    assert(w.document.body.textContent.includes('เชื่อมต่อ AI และเสียงแล้ว'));
    await click('Fixture mail\nsender@example.com'); await click('สรุปด้วย AI');
    assert(w.document.body.textContent.includes('Fixture summary'));
    await click('ถอนเฉพาะการเชื่อมต่อ AI และเสียง');
    assert.equal(requests.filter(x => x.method === 'DELETE').length, 0, 'unlink has explicit confirmation');
    await click('ยืนยันถอนการเชื่อมต่อ AI');
    assert(w.document.body.textContent.includes('เชื่อมต่อ AI และเสียง'));
    assert(w.document.body.textContent.includes('เขียนอีเมล'), 'ordinary inbox survives agent unlink');
    await click('Fixture mail\nsender@example.com');
    assert(![...w.document.querySelectorAll('button')].some(b => b.textContent === 'สรุปด้วย AI'), 'no AI action without separate consent');
    await click('ลบลงถังขยะ');
    const detail=w.document.querySelector('[data-detail]');
    assert.match(detail.textContent,/ยืนยันการลบอีเมลหรือไม่/);assert.match(detail.textContent,/Fixture mail/);assert.match(detail.textContent,/owner@example.com/);
    assert.doesNotMatch(detail.textContent,/private-message|messageId|private-proposal/);assert.equal(detail.querySelector('pre'),null);
    assert.equal(requests.filter(x=>x.path.endsWith('/confirm')).length,0);
    await click('ยืนยันย้ายลงถังขยะ');
    assert.deepEqual(requests.find(x=>x.path.endsWith('/confirm')).body,{proposalId:'private-proposal'},'readable preview preserves the server-bound approval');
  } finally { dom.window.close(); }
  console.log('Mailbox UI: separate AI disclosure, consent, return refresh, agent-only analysis and independent disconnect passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
