// Post-deploy staging smoke check. No provider calls, database mutations or
// administrator credentials. Never print the transient guest token.
const assert = require('node:assert/strict');
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
  assert(html.includes('/voice-window-catalog.js?') && html.includes('/voice-command-client.js?'));
  assert.equal((await post('/api/sentinel/command', { command: 'เปิด AI Platform' })).status, 401);
  const sessionResponse = await post('/api/auth/guest', {});
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert(session.accessToken);
  for (const [command, expected] of [['เปิด AI Platform', 'open_ai_dashboard'], ['ปิด AI Platform', 'close_ai_dashboard']]) {
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
  console.log('Staging: command assets loaded; unauthenticated denied; guest open/close instructions correct; administrator window denied');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
