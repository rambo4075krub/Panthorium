'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function main() {
await require('./start-menu-layout')();
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const shell = read('sentinel.html');
const server = read('server.js');
const adminDesktop = read('staging-admin-desktop.js');
const accessShell = read('access-shell-ui.js');
const dom = new JSDOM(shell, { runScripts: 'outside-only', pretendToBeVisual: true });
const doc = dom.window.document;
const css = [...doc.querySelectorAll('style')].map(style => style.textContent).join('\n');

assert.equal(doc.getElementById('taskbar'), null, 'the old taskbar row is removed');
assert(doc.getElementById('system-controls'), 'bottom controls are present');
assert(doc.getElementById('start-menu'), 'the Start menu remains available');
assert(doc.querySelector('script[src^="/start-menu-ui.js?v="]'), 'versioned Start Menu helper is loaded');
assert(server.includes('"start-menu-ui.js"'), 'the new helper is served without a stale static cache');
assert(!adminDesktop.includes('#start-menu #sm-apps{display:none!important;}'), 'administrator menu keeps a searchable launcher list');
assert(accessShell.includes("id === 'notes' || id === 'files'"), 'Start Menu preserves account-authorized Notes and Files launchers');
assert(shell.includes('adminManager.menuApps()'), 'Start Menu includes permitted administrator tools');
assert.equal(doc.getElementById('start-search').type, 'search');
assert.equal(doc.getElementById('clock').tagName, 'TIME');
assert(doc.getElementById('system-controls-left').contains(doc.getElementById('start-btn')));
assert(doc.getElementById('system-controls-left').contains(doc.getElementById('status-dot')));
assert.equal(doc.querySelector('#start-btn img').getAttribute('src'), '/panthorium-logo.svg?v=original-orange-20261015');
assert.match(css, /\.sm-apps\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow-y:\s*auto/);
assert.match(css, /#system-controls\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*calc\(env\(safe-area-inset-bottom,\s*0px\) \+ 12px\)/);
assert.match(css, /#global-voice\s*\{[^}]*right:\s*max\([^}]*bottom:\s*calc\(env\(safe-area-inset-bottom/);

const searchDom = new JSDOM(
  '<div id="apps">' +
    '<button class="sm-app" data-search-text="notes บันทึก"><span>บันทึก</span></button>' +
    '<button class="sm-app" data-search-text="calculator"><span>เครื่องคิดเลข</span></button>' +
    '<button class="sm-app" data-search-text="private" style="display:none"><span>Private</span></button>' +
  '</div><div id="empty" hidden></div>',
  { runScripts: 'outside-only' }
);
searchDom.window.eval(read('start-menu-ui.js'));
const list = searchDom.window.document.getElementById('apps');
const empty = searchDom.window.document.getElementById('empty');
const [notes, calculator, privateItem] = list.children;
const ui = searchDom.window.PanthoriumStartMenuUI;

assert.equal(ui.filter('NOTES', list, empty), 1, 'search matches app ids without case sensitivity');
assert.equal(notes.dataset.searchHidden, undefined);
assert.equal(calculator.dataset.searchHidden, 'true');
assert.equal(privateItem.style.display, 'none', 'search never reveals role-hidden apps');
assert.equal(ui.filter('บันทึก', list, empty), 1, 'Thai app names are searchable');
assert.equal(ui.filter('missing app', list, empty), 0);
assert.equal(empty.hidden, false, 'an empty-state message appears when nothing matches');
assert.equal(ui.filter('', list, empty), 2, 'clearing search restores all accessible apps');
assert.equal(empty.hidden, true);

const privacy = searchDom.window.document.createElement('button');
privacy.className = 'sm-app';
privacy.dataset.appId = 'privacy-policy';
privacy.textContent = 'Privacy/Policy';
list.appendChild(privacy);
ui.pinLast('privacy-policy', list);
const futureApp = searchDom.window.document.createElement('button');
futureApp.className = 'sm-app';
futureApp.dataset.appId = 'future-app';
futureApp.textContent = 'A future app';
list.appendChild(futureApp);
await new Promise(resolve => searchDom.window.setTimeout(resolve, 0));
assert.equal(list.lastElementChild.dataset.appId, 'privacy-policy', 'Privacy/Policy is restored to the bottom after future launchers are added');
const minimizedApp = searchDom.window.document.createElement('button');
minimizedApp.className = 'sm-app';
minimizedApp.dataset.appId = 'future-minimized-window';
list.appendChild(minimizedApp);
await new Promise(resolve => searchDom.window.setTimeout(resolve, 0));
assert.equal(list.lastElementChild.dataset.appId, 'privacy-policy', 'minimized-window launchers cannot move Privacy/Policy from the bottom');

// Categories are actual disclosure controls; moving a legacy dynamic launcher
// into the body preserves its object identity and attached listener.
const flush = () => new Promise(resolve => searchDom.window.setTimeout(resolve, 0));
const work = ui.group('work', 'การทำงาน Work', list);
const toggle = work.querySelector('[data-start-group-toggle]');
const body = ui.groupItems(work);
assert.equal(toggle.tagName, 'BUTTON');
assert.equal(toggle.getAttribute('aria-controls'), body.id);
assert.equal(toggle.getAttribute('aria-expanded'), 'false');
assert.equal(body.hidden, true, 'categories start collapsed');
assert(toggle.querySelector('svg[aria-hidden="true"]'), 'category has an accessible decorative line icon');
let launches = 0;
const editor = searchDom.window.document.createElement('button');
editor.className = 'sm-app'; editor.dataset.appId = 'editor'; editor.dataset.searchText = 'editor วิเคราะห์เอกสาร'; editor.textContent = 'Editor';
editor.addEventListener('click', () => launches++);
work.appendChild(editor);
await flush();
assert.equal(body.firstElementChild, editor, 'legacy append is moved, not copied');
assert.equal(work.querySelector('.sm-group-count').textContent, '1');
toggle.click(); assert.equal(body.hidden, false); assert.equal(launches, 0, 'expanding never launches an app');
toggle.dispatchEvent(new searchDom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
assert.equal(body.hidden, true, 'Space toggles the disclosure');
toggle.dispatchEvent(new searchDom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
assert.equal(body.hidden, false, 'Enter toggles the disclosure');
toggle.dispatchEvent(new searchDom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
assert.equal(searchDom.window.document.activeElement, editor, 'ArrowDown enters the expanded category');
editor.dispatchEvent(new searchDom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
assert.equal(body.hidden, true); assert.equal(searchDom.window.document.activeElement, toggle);

ui.filter('วิเคราะห์เอกสาร', list, empty);
assert.equal(body.hidden, false, 'search temporarily reveals a matching descendant');
assert.equal(editor.dataset.searchHidden, undefined);
work.click(); assert.equal(launches, 1, 'shell search Enter delegates to the matching app');
ui.filter('', list, empty); assert.equal(body.hidden, true, 'clearing search restores the collapsed choice');
toggle.click(); ui.filter('missing app', list, empty); ui.filter('', list, empty);
assert.equal(body.hidden, false, 'search also restores an expanded choice');
const denied = searchDom.window.document.createElement('button');
denied.className = 'sm-app'; denied.textContent = 'Restricted'; denied.hidden = true;
body.appendChild(denied); ui.filter('Restricted', list, empty);
assert.equal(work.dataset.searchHidden, 'true'); assert.equal(denied.hidden, true, 'search does not reveal an access-hidden descendant');
work.hidden = true; ui.filter('editor', list, empty); assert.equal(editor.dataset.searchHidden, 'true'); work.hidden = false;
ui.filter('async keyword', list, empty); assert.equal(empty.hidden, false);
const late = searchDom.window.document.createElement('button'); late.className = 'sm-app'; late.textContent = 'async keyword'; body.appendChild(late);
await flush();
assert.equal(empty.hidden, true, 'late nested insertions rerun active search');
assert.equal(body.hidden, false);
ui.filter('', list, empty);
work.remove();
const rebuilt = ui.group('work', 'การทำงาน Work', list);
ui.groupItems(rebuilt).appendChild(editor); await flush();
assert.equal(ui.groupItems(rebuilt).hidden, false, 'expansion survives the shell rebuilding launcher nodes');
assert.equal(ui.group('work', 'การทำงาน Work', list), rebuilt, 'reinstallation is idempotent');
assert.equal(list.querySelectorAll('[data-start-group="work"]').length, 1);
editor.click(); assert.equal(launches, 2, 'launcher listener survives reparenting and rebuild');

const contacts = searchDom.window.document.createElement('button'); contacts.dataset.appId = 'contacts'; contacts.className = 'sm-app'; list.appendChild(contacts);
ui.pinLast('contacts', list);
let mutations = 0;
const watcher = new searchDom.window.MutationObserver(records => { mutations += records.length; }); watcher.observe(list, { childList: true });
const another = searchDom.window.document.createElement('button'); another.className = 'sm-app'; list.appendChild(another); await flush();
assert.deepEqual(Array.from(list.children).slice(-2).map(item => item.dataset.appId), ['privacy-policy', 'contacts']);
const settledMutations = mutations; ui.keepPinnedLast(list); await flush();
assert.equal(mutations, settledMutations, 'multiple pinned items settle without a mutation loop'); watcher.disconnect();
searchDom.window.close();
dom.window.close();
console.log('Start menu controls: accessible accordions, search expansion restoration, live nested updates, preserved launch handlers/access, and stable multi-item pinning passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
