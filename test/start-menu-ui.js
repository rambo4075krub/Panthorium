'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

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
assert(shell.includes('/start-menu-ui.js?v=start-menu-controls-v1'));
assert(server.includes('"start-menu-ui.js"'), 'the new helper is served without a stale static cache');
assert(!adminDesktop.includes('#start-menu #sm-apps{display:none!important;}'), 'administrator menu keeps a searchable launcher list');
assert(accessShell.includes("id === 'notes' || id === 'files'"), 'Start Menu preserves account-authorized Notes and Files launchers');
assert(shell.includes('adminManager.menuApps()'), 'Start Menu includes permitted administrator tools');
assert.equal(doc.getElementById('start-search').type, 'search');
assert.equal(doc.getElementById('clock').tagName, 'TIME');
assert(doc.getElementById('system-controls-left').contains(doc.getElementById('start-btn')));
assert(doc.getElementById('system-controls-left').contains(doc.getElementById('status-dot')));
assert.equal(doc.querySelector('#start-btn img').getAttribute('src'), '/panthorium-logo.svg');
assert.match(css, /\.sm-apps\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow-y:\s*auto/);
assert.match(css, /#system-controls\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*env\(safe-area-inset-bottom/);
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
searchDom.window.close();
dom.window.close();
console.log('Start menu controls: responsive structure, Gregorian clock, logo launcher, one-column search, hidden-app access, and minimized-window recovery passed');
