const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

const desktop = read('staging-admin-desktop.js');
const access = read('access-shell-ui.js');
const layout = read('ui-layout.js');
const server = read('server.js');

assert.match(desktop, /const APPS=\[/, 'Desktop Manager V2 must use a static App Registry');
assert.match(desktop, /data-desktop-v2/, 'Desktop icons must come from a single managed renderer');
assert.match(desktop, /replaceChildren\(\.\.\.visibleApps\.map\(createIcon\)\)/, 'Desktop render must be deterministic');
assert.doesNotMatch(desktop, /cloneNode\(/, 'Desktop Manager V2 must not clone Start Menu nodes');
assert.doesNotMatch(desktop, /setInterval\(/, 'Desktop Manager V2 must not poll the DOM');
assert.doesNotMatch(desktop, /new MutationObserver/, 'Desktop Manager V2 must not repair the DOM through observers');
assert.match(desktop, /#start-menu #sm-apps\{display:none!important;\}/, 'Staging Admin Start Menu must hide app grid');
assert.match(desktop, /รีสตาร์ท/, 'Staging Admin Start Menu must keep restart action');

assert.doesNotMatch(access, /setInterval\(/, 'Access shell must be event-driven, not polling');
assert.doesNotMatch(layout, /setInterval\(/, 'UI layout must not poll sync loops');
assert.match(server, /staging-admin-desktop\.js/, 'Server shell must load Desktop Manager V2 directly');

console.log('Phase 12 Desktop Manager V2 tests passed');
