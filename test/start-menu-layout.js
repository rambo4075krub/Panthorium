'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

async function main() {
  const dom = new JSDOM(read('sentinel.html'), { url: 'https://panthorium.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window, d = w.document;
  const evaluate = code => vm.runInContext(code, dom.getInternalVMContext());
  const flush = () => new Promise(resolve => setTimeout(resolve, 30));
  const user = role => ({ sub: role === 'guest' ? 'guest:test' : role, roles: [role], permissions: ['chat', ...(role === 'administrator' ? ['settings'] : [])] });
  const expected = ['sentinel', 'files', 'calendar', 'notes', 'cloud-group-social', 'cloud-group-creative', 'billing', 'privacy-policy', 'cloud-group-settings'];
  const settingsIds = ['goals', 'assistant-preferences', 'contact', 'reminders', 'account-logout'];
  const visibleEntries = () => Array.from(d.getElementById('sm-apps').children).filter(el => !el.hidden && el.dataset.searchHidden !== 'true' && el.style.display !== 'none').map(el => el.dataset.appId);
  const search = value => { const input = d.getElementById('start-search'); input.value = value; input.dispatchEvent(new w.Event('input')); };
  try {
    w.AbortSignal = AbortSignal;
    w.fetch = async url => ({ ok: true, json: async () => String(url).includes('/cloud-apps/catalog')
      ? { ok: true, catalog: JSON.parse(read('services/catalog/cloud-app-packs.json')), readiness: {} }
      : { ok: true, items: [], organizations: [], runs: [], memories: [], files: [], calls: [], orders: [] } });
    for (const file of ['panthorium-window-base.js', 'start-menu-ui.js']) evaluate(read(file));
    evaluate([...d.scripts].find(s => s.textContent.includes('const OS =')).textContent.replace(/\n    boot\(\);/, '\n    OS.state.booted = true;'));
    evaluate(`OS.state.user = ${JSON.stringify(user('user'))}; OS.config.accessToken = 'test';`);
    d.getElementById('desktop').classList.add('active');
    w.PanthoriumAuth = { isAdministrator: () => evaluate('OS.state.user.roles.includes("administrator")') };
    let logout = 0;
    w.PanthoriumAccounts = { openLogout() { logout++; } };
    for (const file of ['voice-window-catalog.js', 'calculator-expression.js', 'cloud-apps-ui.js', 'organization-catalog.js', 'organizations-ui.js', 'creative-studio-ui.js', 'social-ui.js', 'goal-tracker-ui.js', 'assistant-preferences-ui.js', 'reminders-ui.js', 'contact-ui.js', 'voice-command-client.js', 'access-shell-ui.js', 'ui-layout.js']) evaluate(read(file));
    d.dispatchEvent(new w.Event('DOMContentLoaded'));
    w.dispatchEvent(new w.Event('panthorium:auth-changed'));
    await flush();
    const restart = d.getElementById('btn-restart');
    const download = d.getElementById('panthorium-browser-download');
    assert(restart && download);
    assert.equal(download.getAttribute('href'), '/browser-download.html');
    for (const role of ['user', 'administrator', 'operator', 'guest', 'user']) {
      evaluate(`OS.state.user = ${JSON.stringify(user(role))}`);
      w.dispatchEvent(new w.Event('panthorium:auth-changed'));
      await flush();
      for (let repeat = 0; repeat < 2; repeat++) {
        d.getElementById('start-btn').click();
        w.PanthoriumAccessShell.sync();
        await flush();
        const visible = visibleEntries();
        if (role !== 'guest') assert.deepEqual(visible, expected, role + ': exact main menu order after rebuild');
        else {
          assert(visible.includes('cloud-group-settings'), 'Guest retains the public Help Center');
          assert(!visible.includes('files'), 'private apps remain account-gated');
        }
        const settings = d.querySelector('[data-start-group="settings"]');
        assert.equal(d.querySelectorAll('[data-start-group="settings"]').length, 1);
        assert(settings.querySelector('.sm-group-icon svg'));
        assert.deepEqual(Array.from(settings.querySelectorAll('.sm-app')).map(el => el.dataset.appId), role === 'guest' ? ['contact'] : settingsIds);
        assert.equal(d.getElementById('btn-restart'), restart, 'restart control is preserved');
        assert.equal(d.getElementById('panthorium-browser-download'), download, 'download control is preserved');
        assert.equal(d.getElementById('btn-settings-quick').hidden, true, 'old footer Settings is replaced by the category');
      }
      // Access filtering and curated ordering must agree once the menu is idle.
      // Previously Guest registration bounced between second and last place on
      // every animation frame, queuing more work whenever the menu was opened.
      let mutations = 0;
      const observer = new w.MutationObserver(records => { mutations += records.length; });
      observer.observe(d.getElementById('sm-apps'), { childList: true, subtree: true });
      await new Promise(resolve => setTimeout(resolve, 100));
      const settled = mutations;
      await new Promise(resolve => setTimeout(resolve, 100));
      observer.disconnect();
      assert.equal(mutations, settled, role + ': access and layout observers stop reordering the idle menu');
    }
    const settings = d.querySelector('[data-start-group="settings"]');
    settings.querySelector('[data-start-group-toggle]').click();
    assert.equal(w.PanthoriumStartMenuUI.groupItems(settings).hidden, false);
    for (const id of settingsIds) {
      settings.querySelector(`[data-app-id="${id}"]`).click();
      if (id !== 'account-logout') assert(d.querySelector(`.window[data-id="${id}"]`), id + ' opens its existing window');
    }
    assert.equal(logout, 1);
    assert.equal(d.querySelector('[data-panthorium-contact] h1').textContent, 'ศูนย์ช่วยเหลือ');
    for (const [query, id] of [['เครื่องคิดเลข', 'calculator'], ['พื้นที่องค์กรและทีม', 'organizations'], ['ชีวิตประจำวัน ช่วงวัย', 'cloud-group-life'], ['การเรียน การสอน', 'cloud-group-study'], ['การทำงาน ธุรกิจ', 'cloud-group-work'], ['วิชาชีพเฉพาะ', 'cloud-group-specialist']]) {
      search(query);
      const item = d.querySelector(`#sm-apps [data-app-id="${id}"]`);
      assert(item, id + ' remains installed');
      assert.notEqual(item.dataset.searchHidden, 'true', id + ' is discoverable by search');
      assert.notEqual(item.closest('[data-start-group]')?.dataset.searchHidden, 'true');
      search('');
      assert(!visibleEntries().includes(id), id + ' is hidden when search clears');
    }
    search('เครื่องคิดเลข');
    d.getElementById('start-search').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert(d.querySelector('.window[data-id="calculator"]'), 'search Enter opens a hidden app');
    search('');
    for (const [phrase, category] of [['ชีวิตประจำวัน ช่วงวัย', 'life'], ['การเรียน การสอน', 'study'], ['การทำงาน ธุรกิจ', 'work'], ['วิชาชีพเฉพาะ', 'specialist'], ['การเรียน การสอน', 'study']]) {
      const command = w.PanthoriumWindowCatalog.parse('เปิด ' + phrase);
      assert(command, phrase + ' has a voice command');
      const result = await w.PanthoriumVoiceCommands.windowAction(command.action);
      assert.equal(result.ok, true, phrase + ': ' + JSON.stringify(result));
      assert(d.querySelector(`.window[data-id="cloud-apps"][data-cloud-category="${category}"]`), 'voice selects the requested category even when another is open');
    }
    for (const action of ['open_calculator', 'open_organizations']) {
      const result = await w.PanthoriumVoiceCommands.windowAction(action);
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    evaluate('minimizeWindow("cloud-apps"); minimizeWindow("calculator"); minimizeWindow("organizations");');
    await flush();
    assert.deepEqual(visibleEntries(), expected, 'minimizing hidden apps does not add default menu entries');
    search('เครื่องคิดเลข');
    d.querySelector('#sm-apps [data-app-id="calculator"]').click();
    assert.notEqual(d.querySelector('.window[data-id="calculator"]').style.display, 'none', 'search restores a minimized hidden app');
    search('');
    evaluate(`OS.state.user = ${JSON.stringify(user('guest'))}`);
    w.dispatchEvent(new w.Event('panthorium:auth-changed'));
    await flush();
    search('วิชาชีพเฉพาะ');
    assert.equal(d.getElementById('sm-empty').hidden, false, 'search cannot bypass account restrictions');
    assert.equal((await w.PanthoriumVoiceCommands.windowAction('open_cloud_specialist')).ok, false);
    console.log('Curated Start: exact order, Settings actions, role transitions, hidden-app search/Enter/restore and voice category switching passed');
  } finally { w.close(); }
}
module.exports = main;
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
