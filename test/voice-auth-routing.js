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
    const fetches = [];
    w.TextDecoder = TextDecoder;
    w.fetch = async (url, init = {}) => {
      fetches.push({ url: String(url), init });
      const frame = ['event: delta', 'data: {"delta":"result"}', '', 'event: done', 'data: {}', '', ''].join('\n');
      const bytes = new TextEncoder().encode(frame); let sent = false;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }) }) }, json: async () => ({}) };
    };
    if (streamFirst) { w.eval(source('ai-stream-client.js')); w.PanthoriumAIStream.install(); }
    w.eval(source('phase2-auth.js'));
    await new Promise(resolve => setImmediate(resolve));
    w.OS.config.accessToken = 'test-authenticated-session';
    w.OS.state.user = { sub: 'operator', permissions: ['chat', 'settings'], roles: ['operator'] };
    if (!streamFirst) { w.eval(source('ai-stream-client.js')); w.PanthoriumAIStream.install(); }
    await w.callAI('เปิด Learning Lab', { voiceMode: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options?.voiceMode, true, `voiceMode lost (${streamFirst ? 'auth wraps stream' : 'stream wraps auth'})`);
    await w.callAI('การเรียนรู้คืออะไร', { voiceMode: false, conversationalVoice: true });
    const streamedRequests = fetches.filter(request => request.url.endsWith('/api/chat/stream'));
    assert.equal(streamedRequests.length, 1, 'spoken conversation uses the streaming chat route');
    assert.equal(JSON.parse(streamedRequests[0].init.body).voice, true, 'conversation flag reaches the streamed server request');
    w.OS.state.user.permissions = [];
    assert.equal((await w.callAI('เปิด Learning Lab', { voiceMode: true })).ok, false);
    assert.equal((await w.callAI('การเรียนรู้คืออะไร', { conversationalVoice: true })).ok, false);
    assert.equal(requests.length, 1, 'RBAC denial must stop the command request');
    assert.equal(fetches.filter(request => request.url.endsWith('/api/chat/stream')).length, 1, 'RBAC denial must stop spoken conversation requests');
  } finally { w.close(); }
}

async function checkAdminRefresh() {
  const dom = new JSDOM('<div id="desktop"></div>', { url: 'https://example.test/admin', runScripts: 'outside-only' });
  const w = dom.window;
  try {
    const requests = [];
    w.OS = { state: { booted: true, user: null }, config: { backendUrl: 'https://example.test', accessToken: '' } };
    w.ensureAuth = async () => false;
    w.callAI = async () => ({ ok: true, text: 'answered' });
    w.fetch = async url => {
      requests.push(String(url));
      if (String(url).endsWith('/api/auth/refresh')) return { ok: true, json: async () => ({ accessToken: 'restored-token', user: { sub: 'admin', roles: ['administrator'], permissions: ['chat'] } }) };
      return { ok: true, json: async () => ({}) };
    };
    w.eval(source('phase2-auth.js'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await w.callAI('ทดสอบเซสชัน')).ok, true);
    assert.equal(w.OS.config.accessToken, 'restored-token');
    assert.equal(requests.filter(url => url.endsWith('/api/auth/refresh')).length, 1);
    assert.equal(requests.some(url => url.endsWith('/api/auth/guest')), false, 'admin must never become a guest');
  } finally { w.close(); }
}

async function checkGuestRejectsAdminCookie() {
  const dom = new JSDOM('<div id="desktop"></div>', { url: 'https://example.test/', runScripts: 'outside-only' });
  const w = dom.window;
  try {
    const requests = [];
    w.OS = { state: { booted: true, user: null }, config: { backendUrl: 'https://example.test', accessToken: '' } };
    w.ensureAuth = async () => false;
    w.callAI = async () => ({ ok: true, text: 'answered' });
    w.fetch = async url => {
      const path = String(url);
      requests.push(path);
      if (path.endsWith('/api/auth/refresh')) return { ok: true, json: async () => ({ accessToken: 'admin-cookie-token', user: { sub: 'admin', roles: ['administrator'], permissions: ['chat', 'settings'] } }) };
      if (path.endsWith('/api/auth/guest')) return { ok: true, json: async () => ({ accessToken: 'guest-token', user: { id: 'guest:public', roles: ['guest'], permissions: ['chat'] } }) };
      return { ok: true, json: async () => ({}) };
    };
    w.eval(source('phase2-auth.js'));
    for (let i = 0; i < 20 && !w.OS.state.user; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests.slice(0, 2).map(url => url.split('/').at(-1)), ['refresh', 'guest']);
    assert.deepEqual(w.OS.state.user.roles, ['guest'], 'a stale Admin cookie cannot make the public root an Admin shell');
    assert.equal(w.OS.config.accessToken, 'guest-token', 'Guest chat uses a Guest token after the stale Admin refresh cookie');
    assert.equal(w.PanthoriumAuth.isAdministrator(), false);
    assert.equal(w.PanthoriumAuth.isGuest(), true);
  } finally { w.close(); }
}

(async () => {
  await checkOrder(false);
  await checkOrder(true);
  await checkAdminRefresh();
  await checkGuestRejectsAdminCookie();
  console.log('Voice options survive both auth/stream wrapper orders; RBAC denial preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
