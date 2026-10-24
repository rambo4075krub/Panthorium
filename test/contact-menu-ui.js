'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = f => fs.readFileSync(require('node:path').join(__dirname, '..', f), 'utf8');
(async () => {
  const dom = new JSDOM(read('sentinel.html'), { url: 'https://panthorium.test', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window, d = w.document;
  const evaluate = code => vm.runInContext(code, dom.getInternalVMContext());
  const tick = () => new Promise(resolve => setImmediate(resolve));
  try {
    w.fetch = async () => ({ ok: true, json: async () => ({ ok: true, items: [] }) });
    evaluate(read('panthorium-window-base.js'));
    evaluate([...d.scripts].find(s => s.textContent.includes('const OS =')).textContent.replace(/\n    boot\(\);/, '\n    OS.state.booted = true;'));
    w.PanthoriumAuth = { isAdministrator: () => evaluate('OS.state.user?.roles?.includes("administrator")') };
    for (const file of ['start-menu-ui.js', 'access-shell-ui.js', 'contact-ui.js']) evaluate(read(file));
    d.dispatchEvent(new w.Event('DOMContentLoaded'));
    let login = 0, support = 0;
    w.PanthoriumAccounts = { openLogin() { login++; } };
    w.PanthoriumSocial = { async open(module, options) { assert.equal(module, 'talk'); assert.equal(options.support, true); support++; } };
    for (const role of ['guest', 'user', 'administrator', 'operator', 'guest']) {
      evaluate(`OS.state.user = ${JSON.stringify({ sub: role, roles: [role], permissions: ['chat'] })}`);
      w.dispatchEvent(new w.Event('panthorium:auth-changed'));
      for (let repeat = 0; repeat < 2; repeat++) {
        evaluate('renderAppLaunchers()'); w.PanthoriumAccessShell.sync(); await tick();
        const contact = d.querySelector('#sm-apps [data-app-id="contact"]');
        assert(contact, role + ' has contact');
        assert.equal(contact.closest('[data-start-group]')?.dataset.startGroup, 'settings');
        assert.equal(contact.textContent.trim(), '✉️ศูนย์ช่วยเหลือ');
        for (const id of ['account-login', 'account-register']) assert.equal(!!d.querySelector('#sm-apps [data-app-id="' + id + '"]'), role === 'guest');
        assert.equal(d.querySelector('#desktop-icons [data-app-id="contact"]'), null);
        const extra = d.createElement('button'); extra.dataset.appId = 'late-extension'; extra.className = 'sm-app';
        d.getElementById('sm-apps').append(extra); await tick();
        assert.equal(contact.closest('[data-start-group]')?.dataset.startGroup, 'settings', 'extensions preserve Help Center placement');
      }
      d.querySelector('#sm-apps [data-app-id="contact"]').click();
      const root = d.querySelector('[data-panthorium-contact]'); assert(root);
      assert(root.textContent.includes('32 moo4 Pajod Kohkeaw Waritchaphum SakonNakhon 47150'));
      assert.equal(root.querySelector('a').getAttribute('href'), 'mailto:account@panthorium.net');
      root.querySelector('[data-contact-chat]').click(); await tick();
      assert.equal(root.querySelector('[data-contact-chat]').disabled, false);
    }
    assert.equal(login, 2); assert.equal(support, 3);
    assert.equal(d.querySelectorAll('[data-panthorium-contact]').length, 1);
  } finally { w.close(); }
  console.log('Contact menu: guest/user/admin/operator transitions, extension ordering, contact window and chat launch passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
