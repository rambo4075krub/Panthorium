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
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
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
  console.log('Staging: tested inline voice runtime matches; command assets loaded; unauthenticated denied; guest open/close instructions correct; administrator window denied. Live AI/TTS/audio acceptance is still required.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
