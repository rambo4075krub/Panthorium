const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const base = process.env.CHAT_SMOKE_URL;
if (!base) throw new Error('CHAT_SMOKE_URL required');
(async () => {
  for (const path of ['/', '/admin']) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, path);
    const dom = new JSDOM(await response.text());
    const d = dom.window.document;
    assert.equal(d.body.dataset.geminiLiveEnabled, 'true', path + ' enables Live');
    assert.equal(d.getElementById('version-badge'), null, path + ' removes version numbers');
    assert.equal(d.getElementById('global-voice')?.hidden, true, path + ' has no floating mic');
    assert.equal(d.querySelector('#system-controls #desktop-voice')?.tagName, 'BUTTON', path + ' offers a dock microphone');
    const source = Array.from(d.scripts).find(script => script.textContent.includes('const OS =')).textContent;
    assert(!source.includes('id="voice-status-box"'), path + ' removes the three status bars');
    assert(source.includes('PanthoriumLiveVoice.toggle()'), path + ' chat mic uses Live');
    assert(source.includes('onClose: () => window.PanthoriumLiveVoice?.stopChatSession?.()'), path + ' closes chat-owned audio with chat');
    dom.window.close();
  }
  const client = await fetch(base + '/live-voice-client.js', { signal: AbortSignal.timeout(20000) });
  assert(client.ok);
  const text = await client.text();
  assert(text.includes('function syncChatButton()'));
  assert(!text.includes('getElementById("global-voice")'));
  console.log('PASS deployed Admin/User: shared desktop/chat microphone, Live binding and removed status bars');
})().catch(error => { console.error(error); process.exitCode = 1; });
