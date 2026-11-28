const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const { releaseAssetPath } = require('../middleware/publicAssets');
const base = process.env.CHAT_SMOKE_URL;
if (!base) throw new Error('CHAT_SMOKE_URL required');
(async () => {
  for (const route of ['/', '/admin']) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, route);
    const dom = new JSDOM(await response.text());
    const d = dom.window.document;
    assert.equal(d.body.dataset.geminiLiveEnabled, 'true', route + ' enables Live');
    assert.equal(d.getElementById('version-badge'), null, route + ' removes version numbers');
    assert.equal(d.getElementById('global-voice')?.hidden, true, route + ' has no floating mic');
    assert.equal(d.querySelector('#system-controls #desktop-voice')?.tagName, 'BUTTON', route + ' offers a dock microphone');
    const entry = d.querySelector('script[src="/sentinel-shell.js"]');
    assert(entry, 'shell declares its bootstrap');
    const script = await fetch(new URL(entry.getAttribute('src'), base), { signal: AbortSignal.timeout(20000) });
    assert.equal(script.status, 200);
    const source = await script.text();
    assert.equal(source, fs.readFileSync(path.join(__dirname, '..', releaseAssetPath('sentinel-shell.js')), 'utf8'));
    assert(!source.includes('id="voice-status-box"'), route + ' removes the three status bars');
    assert(source.includes('PanthoriumLiveVoice.toggle()'), route + ' chat mic uses Live');
    assert(source.includes('PanthoriumLiveVoice?.stopChatSession?.()'), route + ' closes chat-owned audio with chat');
    dom.window.close();
  }
  const client = await fetch(base + '/live-voice-client.js', { signal: AbortSignal.timeout(20000) });
  assert(client.ok);
  const text = await client.text();
  assert(text.includes('function syncChatButton()'));
  assert(!text.includes('getElementById("global-voice")'));
  console.log('PASS deployed Admin/User: shared desktop/chat microphone, Live binding and removed status bars');
})().catch(error => { console.error(error); process.exitCode = 1; });
