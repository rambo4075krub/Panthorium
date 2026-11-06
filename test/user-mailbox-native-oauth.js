'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validMailboxOAuthUrl, installMailboxOAuth } = require('../electron/mailbox-oauth.cjs');
const { PROVIDERS } = require('../services/mailbox/providers');
const origin = 'https://panthorium.net';
function authUrl(provider) {
  return PROVIDERS[provider].authorize + '?' + new URLSearchParams({
    client_id: 'test-client', redirect_uri: origin + '/api/mailbox/oauth/' + provider + '/callback',
    scope: PROVIDERS[provider].scope, response_type: 'code', state: 'a'.repeat(43),
    code_challenge: 'b'.repeat(43), code_challenge_method: 'S256', prompt: 'consent', access_type: 'offline'
  });
}
(async () => {
  for (const provider of ['google', 'microsoft']) assert(validMailboxOAuthUrl(authUrl(provider), origin));
  const good = authUrl('google');
  for (const bad of [
    'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'https://evil.example/',
    good.replace('accounts.google.com', 'accounts.google.com.evil.example'),
    good.replace('accounts.google.com', 'user@accounts.google.com'),
    good.replace('accounts.google.com', 'accounts.google.com:8443'),
    good.replace('/o/oauth2/v2/auth', '/redirect'), good + '&redirect_uri=https://evil.example',
    good + '&client_secret=not-permitted', good + '#fragment'
  ]) assert(!validMailboxOAuthUrl(bad, origin), bad);
  for (const [key, value] of [['redirect_uri', 'https://evil.example/callback'], ['scope', 'https://mail.google.com/'], ['state', 'short'], ['code_challenge_method', 'plain'], ['response_type', 'token']]) {
    const bad = new URL(good); bad.searchParams.set(key, value);
    assert(!validMailboxOAuthUrl(bad.href, origin), key);
  }
  let handler, opened = 0;
  installMailboxOAuth({ ipcMain: { handle(name, fn) { assert.equal(name, 'panthorium:mailbox-oauth'); handler = fn; } },
    shell: { async openExternal(url) { assert.equal(url, good); opened++; } },
    security: { isTrustedShellEvent: event => event.trusted === true }, appOrigin: origin });
  assert.equal((await handler({ trusted: false }, good)).error, 'untrusted_origin');
  assert.equal((await handler({ trusted: true }, 'file:///C:/test.exe')).error, 'invalid_mailbox_oauth_url');
  assert.equal(opened, 0);
  assert.equal((await handler({ trusted: true }, good)).ok, true); assert.equal(opened, 1);

  // Exercise the actual UI connection function with browser capabilities supplied at its boundary.
  const source = fs.readFileSync('user-mailbox-ui.js', 'utf8');
  const start = source.indexOf('async function connectMailbox('), end = source.indexOf('async function render(){', start);
  assert(start > 0 && end > start);
  async function launch(window, api = async () => ({ url: good })) {
    const notes = [], content = { append() {} };
    const context = vm.createContext({ window, navigator: { userAgent: '' }, api, note: text => notes.push(text), el: () => ({}) });
    vm.runInContext(source.slice(start, end), context);
    await context.connectMailbox('google', content); return notes;
  }
  let desktopCalls = 0;
  await launch({ panthoriumDesktop: { isElectron: true, async openMailboxOAuth(url) { assert.equal(url, good); desktopCalls++; return { ok: true }; } }, open() { throw Error('native must not use embedded popup'); } });
  assert.equal(desktopCalls, 1);
  await assert.rejects(() => launch({ panthoriumDesktop: { isElectron: true } }), /Panthorium Browser/);
  let external;
  await launch({ Capacitor: { getPlatform: () => 'android' }, location: { assign: url => { external = url; } }, open() { throw Error('Android must use external navigation'); } });
  assert.equal(external, good);
  let blankOpened = false, closed = false;
  const popup = { opener: {}, location: {}, close() { closed = true; } };
  const browser = { open() { blankOpened = true; return popup; } };
  await launch(browser, async () => { assert(blankOpened); assert.equal(popup.opener, null); return { url: good }; });
  assert.equal(popup.location.href, good);
  await assert.rejects(() => launch(browser, async () => { throw Error('account changed'); }), /account changed/);
  assert(closed);
  console.log('Mailbox OAuth launch: external desktop/Android browser, strict native URL policy, trusted-frame gate and popup cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
