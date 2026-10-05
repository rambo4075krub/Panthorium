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
const shell = read('sentinel.html');
const windowManager = read('window-manager-ui.js');
const privacyPolicy = read('privacy-policy-ui.js');
const manifest = JSON.parse(read('manifest.json'));

assert.match(desktop, /const APPS=\[/, 'Desktop Manager V2 must use a static App Registry');
assert.match(desktop, /data-desktop-v2/, 'Desktop icons must come from a single managed renderer');
assert.match(desktop, /replaceChildren\(\.\.\.visibleApps\.map\(createIcon\)\)/, 'Desktop render must be deterministic');
assert.doesNotMatch(desktop, /cloneNode\(/, 'Desktop Manager V2 must not clone Start Menu nodes');
assert.doesNotMatch(desktop, /setInterval\(/, 'Desktop Manager V2 must not poll the DOM');
assert.doesNotMatch(desktop, /new MutationObserver/, 'Desktop Manager V2 must not repair the DOM through observers');
assert.doesNotMatch(desktop, /#start-menu #sm-apps\{display:none!important;\}/, 'Staging Admin Start Menu keeps its searchable app list visible');
assert.match(desktop, /menuApps:enabledApps/, 'Administrator launcher registry is available to the Start Menu');
assert.match(desktop, /รีสตาร์ท/, 'Staging Admin Start Menu must keep restart action');
assert.match(desktop, /id:'voice-identity',icon:'🎙️',label:'Voice Identity',role:'administrator'/, 'Admin desktop must expose Voice Identity registration only to administrators');
const voiceUi = read('voice-identity-ui.js');
assert.match(voiceUi, /isAdminEnrollmentContext\(\)/, 'Administrator enrollment must be role and admin-entry gated');
assert.match(voiceUi, /auth\.isGuest\?\.\(\) === true/, 'Guest accounts can open voice registration');
assert.match(voiceUi, /!root\.querySelector\('\[data-consent\]'\)\.checked/, 'Enrollment must remain disabled until biometric consent is checked');

assert.doesNotMatch(access, /setInterval\(/, 'Access shell must be event-driven, not polling');
assert.doesNotMatch(layout, /setInterval\(/, 'UI layout must not poll sync loops');
assert.match(server, /staging-admin-desktop\.js/, 'Server shell must load Desktop Manager V2 directly');
assert.match(shell, /panthorium\.window\.preferences\.v1/, 'window preferences are persisted in shared storage');
assert.match(shell, /fullscreenOnOpen:\s*true/, 'all managed app windows open fullscreen by default');
assert.match(shell, /minimizeToStartMenu:\s*true/, 'the shared preference keeps minimized windows in Start Menu');
assert.match(shell, /preserveStateUntilClose:\s*true/, 'window state persists until explicit close');
assert.match(shell, /data-panthorium-immersive/, 'the shell removes safe-area padding after immersive fullscreen succeeds');
assert.match(shell, /requestFullscreen\(\{ navigationUI: "hide" \}\)/, 'launcher taps request system/browser immersive mode');
assert.doesNotMatch(shell, /class="win-btn max"/, 'native windows no longer expose a restore-size control');
assert.match(shell, /pinLast\?\.\("privacy-policy", sm\)/, 'the Start Menu pins Privacy/Policy after each app render');
assert.match(shell, /function registerExternalWindow\(/, 'custom function windows use the shared desktop window manager');
assert.match(shell, /data-managed-minimized-window/, 'minimized windows reuse their original Start Menu launcher');
assert.match(windowManager, /PanthoriumWindowCatalog\?\.apps/, 'catalog scanning registers all function windows');
assert.match(server, /window-manager-ui\.js/, 'the shared window manager is loaded before function windows');
assert.match(server, /privacy-policy-ui\.js/, 'the centralized policy window is served by the Panthorium shell');
assert.match(privacyPolicy, /PanthoriumPrivacyPolicy\.register/, 'future policy entries use the central registry');
assert.equal(manifest.display, 'fullscreen', 'installed PWA requests immersive display mode');
assert.equal(manifest.display_override[0], 'fullscreen', 'fullscreen is the highest-priority PWA display mode');
assert.match(desktop, /PanthoriumWindowManager\?\.findByAppId/, 'reopening from an admin desktop icon restores the existing managed window');

console.log('Phase 12 Desktop Manager V2 tests passed');
