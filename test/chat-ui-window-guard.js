'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(test) {
  const dom = new JSDOM('<body></body>', { url: 'https://panthorium.test', runScripts: 'outside-only' });
  const w = dom.window;
  w.OS = { state: { user: { id: 'owner', roles: ['user'], permissions: ['chat'] } }, windows: new Map() };
  for (const name of ['voice-window-catalog.js', 'voice-command-client.js']) w.eval(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));
  try { await test(w); } finally { w.close(); }
}
async function main() {
  await fixture(async w => {
    let effects = 0;
    w.openCalculator = () => { effects++; };
    w.PanthoriumScreenVoice = { execute() { effects++; } };
    const controller = new w.AbortController(); controller.abort();
    assert.equal((await w.PanthoriumVoiceCommands.windowAction('open_calculator', { signal: controller.signal })).ok, false);
    assert.equal((await w.PanthoriumVoiceCommands.windowAction('screen_command:read%20this%20page#fixture', { signal: controller.signal })).ok, false);
    assert.equal(effects, 0, 'canceled before dispatch must not touch any module');
  });
  for (const reason of ['owner', 'auth', 'permission']) await fixture(async w => {
    let effects = 0;
    const controller = new w.AbortController();
    // The SSE client owns this abort binding; default Live callers keep their
    // existing context-free contract.
    w.addEventListener('panthorium:auth-changed', () => controller.abort());
    const running = w.PanthoriumVoiceCommands.windowAction('open_calculator', { signal: controller.signal });
    await wait(10);
    if (reason === 'owner') w.OS.state.user = { ...w.OS.state.user, id: 'other' };
    if (reason === 'permission') w.OS.state.user = { ...w.OS.state.user, permissions: [] };
    if (reason === 'auth') w.dispatchEvent(new w.Event('panthorium:auth-changed'));
    w.openCalculator = () => { effects++; };
    assert.equal((await running).ok, false);
    assert.equal(effects, 0, reason + ' change while module loads prevents opener invocation');
  });
  await fixture(async w => {
    let release, focus = 0, modes = 0, invoked = 0;
    const controller = new w.AbortController();
    w.PanthoriumWindowManager = { focus() { focus++; }, setMode() { modes++; return true; } };
    w.openCalculator = async () => { invoked++; await new Promise(resolve => { release = resolve; }); };
    const running = w.PanthoriumVoiceCommands.windowAction('maximize_calculator', { signal: controller.signal });
    await wait(5);
    assert.equal(invoked, 1);
    controller.abort();
    const node = w.document.createElement('div'); node.className = 'window'; node.dataset.id = 'calculator'; w.document.body.append(node);
    release();
    assert.equal((await running).ok, false);
    assert.equal(focus, 0); assert.equal(modes, 0, 'abort after opener invocation prevents later focus/mode effects');
  });
  await fixture(async w => {
    let invoked = 0;
    w.openCalculator = () => {
      invoked++;
      const node = w.document.createElement('div'); node.className = 'window'; node.dataset.id = 'calculator'; w.document.body.append(node);
    };
    const result = await w.PanthoriumVoiceCommands.windowAction('open_calculator');
    assert.equal(result.ok, true, 'existing Live default call remains supported'); assert.equal(invoked, 1);
    const result2 = await w.PanthoriumVoiceCommands.windowAction('open_calculator');
    assert.equal(result2.ok, true); assert.equal(invoked, 1, 'visible window reused');
  });
  console.log('PASS chat UI window guard: pre-abort, identity/session/permission changes during module wait, post-opener effect guard and default Live compatibility');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
