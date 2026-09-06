'use strict';

const assert = require('assert');
const fs = require('fs');

const desktop = fs.readFileSync('staging-admin-desktop.js', 'utf8');
const production = fs.readFileSync('production-intelligence-ui.js', 'utf8');
const shell = fs.readFileSync('sentinel.html', 'utf8');

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

assert(shell.includes('red: new THREE.Color(0xff3b30)'), 'particle sphere should use red at the top');
assert(shell.includes('purple: new THREE.Color(0xa855f7)'), 'particle sphere should transition through purple');
assert(shell.includes('blue: new THREE.Color(0x2563ff)'), 'particle sphere should transition through blue');
assert(shell.includes('white: new THREE.Color(0xffffff)'), 'particle sphere should fade to white at the bottom');
assert(shell.includes('SPHERE_RADIUS * 0.01'), 'particle sphere should continuously ripple at 1 percent');
assert(shell.includes('SPHERE_RADIUS * 0.03'), 'user and admin speech should ripple at 3 percent');
assert(shell.includes('SPHERE_RADIUS * 0.10'), 'AI speech should ripple at 10 percent');
assert(shell.includes('userSpeechActive = true'), 'microphone recognition should activate user speech motion');
assert(shell.includes('aiSpeechActive || synthesisSpeaking'), 'speech synthesis should activate AI speech motion');
assert(shell.includes('organicNoise'), 'particle sphere should include organic noise');
assert(shell.includes('proceduralNoise'), 'particle sphere should include procedural noise');
assert(shell.includes('rotatingBands'), 'particle color groups should rotate dynamically');
assert(shell.includes('if (aiSpeaking) colorFlowPhase += frameDelta * 3.2'), 'particle color groups should move only during AI speech');
assert(!shell.includes('sphere.rotation.y +='), 'particle sphere should not rotate on the Y axis');
assert(!shell.includes('sphere.rotation.x +='), 'particle sphere should not rotate on the X axis');
assert(shell.includes('vertexColors: true'), 'particle sphere should use per-point dynamic colors');
assert(shell.includes('sphereGlow = new THREE.Points'), 'particle sphere should include an additive glow layer');
assert(shell.includes('blending: THREE.AdditiveBlending'), 'particle sphere glow should use additive blending');

console.log('Phase 14 desktop layout fix tests passed');
