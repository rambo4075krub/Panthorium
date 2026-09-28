// Post-deploy staging smoke check. No provider calls, database mutations or
// administrator credentials. Never print the transient guest token.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
(async () => {
  const base = new URL(process.env.STAGING_URL);
  assert.equal(base.protocol, 'https:');
  assert(base.hostname.includes('staging') && base.hostname.endsWith('.run.app'), 'staging only');
  const post = (path, body, token) => fetch(new URL(path, base), {
    method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const preflight = await fetch(new URL('/api/auth/login', base), { method: 'OPTIONS', headers: { Origin: base.origin, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204, 'admin login CORS preflight');
  assert.equal(preflight.headers.get('access-control-allow-origin'), base.origin, 'CORS must echo the actual staging origin');
  const electronPreflight = await fetch(new URL('/api/auth/login', base), { method: 'OPTIONS', headers: { Origin: 'null', 'User-Agent': 'Panthorium Electron/36', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(electronPreflight.status, 204, 'Electron file origin preflight');
  assert.equal(electronPreflight.headers.get('access-control-allow-origin'), 'null', 'Electron must receive its original null origin');
  const foreignPreflight = await fetch(new URL('/api/auth/login', base), { method: 'OPTIONS', headers: { Origin: 'https://unrelated.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(foreignPreflight.status, 403, 'unrelated browser origins must stay denied');
  const shell = await fetch(new URL('/admin', base));
  assert.equal(shell.status, 200);
  const html = await shell.text();
  assert(html.includes('/voice-window-catalog.js?') && html.includes('/external-apps-ui.js?') && html.includes('/voice-command-client.js?'));
  const deployedDOM = new JSDOM(html);
  const testedDOM = new JSDOM(fs.readFileSync(path.join(__dirname, '..', 'sentinel.html'), 'utf8'));
  try {
    const runtime = dom => [...dom.window.document.scripts].find(script => script.textContent.includes('const OS ='))?.textContent;
    assert(runtime(testedDOM), 'test checkout must contain the voice runtime');
    assert.equal(runtime(deployedDOM), runtime(testedDOM), 'deployed inline voice runtime must exactly match the tested shell');
  } finally { deployedDOM.window.close(); testedDOM.window.close(); }
  assert.equal((await post('/api/sentinel/command', { command: 'เปิด AI Platform' })).status, 401);
  const sessionResponse = await post('/api/auth/guest', {});
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert(session.accessToken);
  for (const [command, expected] of [['เปิด Sentinel AI', 'open_sentinel'], ['ปิด Sentinel AI', 'close_sentinel']]) {
    const response = await post('/api/sentinel/command', { command }, session.accessToken);
    assert.equal(response.status, 200, command);
    const data = await response.json();
    assert.equal(data.uiPending, true);
    assert.equal(data.executed, false, 'server must wait for UI execution');
    assert.equal(data.results[0].output.uiAction, expected);
  }
  const forbidden = await post('/api/sentinel/command', { command: 'เปิด Learning Lab' }, session.accessToken);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, 'voice_action_permission_denied');
  assert.equal((await post('/api/sentinel/command', { command: 'เปิด AI Platform' }, session.accessToken)).status, 403);
  const chatResponse = await fetch(new URL('/api/chat', base), { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` }, body: JSON.stringify({ message: 'ตอบสั้น ๆ ว่า Sentinel พร้อมทดสอบ', sessionId: 'staging-guest-smoke', provider: 'vertex' }), signal: AbortSignal.timeout(90000) });
  assert.equal(chatResponse.status, 200, 'guest chat HTTP status');
  const chat = await chatResponse.json();
  assert.equal(chat.ok, true, `guest AI chat failed: ${chat.error || 'unknown'}`);
  if (chat.provider !== 'vertex') console.error('Vertex fallback diagnostic:', JSON.stringify(chat.providerFailureCodes || []));
  assert.equal(chat.provider, 'vertex', `tuned Vertex endpoint unavailable (fallback: ${chat.provider || 'none'})`);
  assert(chat.text?.trim(), 'guest chat answer must be nonempty');
  console.log('Staging: browser and Electron CORS passed; command assets loaded; guest command and tuned Vertex chat answered. Live microphone/TTS acceptance is still required.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
