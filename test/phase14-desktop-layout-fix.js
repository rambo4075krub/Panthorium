'use strict';

const assert = require('assert');
const fs = require('fs');

const desktop = fs.readFileSync('staging-admin-desktop.js', 'utf8');
const production = fs.readFileSync('production-intelligence-ui.js', 'utf8');

assert(desktop.includes('grid-auto-flow:column'), 'staging admin desktop should wrap overflowing icons into top-to-bottom columns');
assert(desktop.includes('overflow:visible'), 'staging admin desktop should not show the old icon scrollbar');
assert(desktop.includes('removeLegacyFloatingLaunchers'), 'staging admin desktop should clean legacy floating launchers');
assert(desktop.includes("desktop.style.display='grid'"), 'desktop manager should force grid layout');
assert(desktop.includes("layout:'wrapped-columns'"), 'desktop ready event should identify wrapped-columns layout');
assert(!desktop.includes('overflow:auto!important'), 'old scrolling icon rail must not return');

assert(production.includes('isStagingAdmin'), 'production intelligence UI should detect staging admin');
assert(production.includes('removeLegacyFloatingLaunchers'), 'production intelligence UI should remove legacy floating launchers');
assert(!production.includes('position:fixed;right:16px;bottom:58px'), 'duplicate bottom-right Production Intelligence launcher must be removed');
assert(!production.includes('new MutationObserver'), 'production intelligence UI must not install a whole-document MutationObserver');

console.log('Phase 14 desktop layout fix tests passed');
