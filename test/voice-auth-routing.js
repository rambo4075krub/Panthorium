const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

async function checkOrder(streamFirst) {
  const dom = new JSDOM('<div id="desktop"></div>', { url: 'https://example.test/admin', runScripts: 'outside-only' });
  const w = dom.window;
  try {
    const requests = [];
    w.OS = { state: { booted: true }, config: { backendUrl: '' } };
    w.ensureAuth = async () => true;
    w.callAI = async (prompt, options) => { requests.push({ prompt, options }); return { ok: true, text: 'result' }; };
    w.fetch = async () => ({ ok: true, json: async () => ({}) });
    if (streamFirst) { w.eval(source('ai-stream-client.js')); w.PanthoriumAIStream.install(); }
    w.eval(source('phase2-auth.js'));
    await new Promise(resolve => setImmediate(resolve));
    w.OS.state.user = { sub: 'operator', permissions: ['chat', 'settings'], roles: ['operator'] };
    if (!streamFirst) { w.eval(source('ai-stream-client.js')); w.PanthoriumAIStream.install(); }
    await w.callAI('เปิด Learning Lab', { voiceMode: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options?.voiceMode, true, `voiceMode lost (${streamFirst ? 'auth wraps stream' : 'stream wraps auth'})`);
    w.OS.state.user.permissions = [];
    assert.equal((await w.callAI('เปิด Learning Lab', { voiceMode: true })).ok, false);
    assert.equal(requests.length, 1, 'RBAC denial must stop the request');
  } finally { w.close(); }
}

(async () => {
  await checkOrder(false);
  await checkOrder(true);
  console.log('Voice options survive both auth/stream wrapper orders; RBAC denial preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
