'use strict';

const assert = require('assert');
const fs = require('fs');

const desktop = fs.readFileSync('staging-admin-desktop.js', 'utf8');
const production = fs.readFileSync('production-intelligence-ui.js', 'utf8');
const shell = fs.readFileSync('sentinel.html', 'utf8');
const uiLayout = fs.readFileSync('ui-layout.js', 'utf8');

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

assert(uiLayout.includes('camera.position.set(0, 0, 4.65)'), 'layout sync must preserve the prototype orb camera position');
assert(!uiLayout.includes('var radius = 90'), 'layout sync must not restore the removed legacy sphere camera distance');

assert(shell.includes('Interactive Procedural Energy Orb'), 'desktop should use the new procedural energy orb');
assert(shell.includes('window.innerWidth < 700 ? 11880 : 23100'), 'orb should use responsive particle counts');
assert(shell.includes('new THREE.ShaderMaterial'), 'orb particles should use the procedural shader');
assert(shell.includes('8.86578/-mv.z'), 'orb should retain the enlarged point size');
assert(shell.includes('redSheen=.008'), 'orb should retain the subtle red sheen');
assert(shell.includes('smoothPulse * .16'), 'mouse click should expand the orb');
assert(shell.includes('orbAIEnergy * (.15 + Math.sin(time * 9) * .01)'), 'AI speech should expand the orb about as much as a click');
assert(shell.includes('orbVoiceEnergy * .018'), 'user and admin speech should move the orb subtly');
assert(shell.includes('userSpeechActive = true'), 'microphone recognition should activate user speech motion');
assert(shell.includes('orbAIActive || aiSpeechActive || synthesisSpeaking'), 'speech synthesis and the AI event API should activate AI motion');
assert(shell.includes('1 - Math.exp(-delta * (aiTarget ? 8 : 3.5))'), 'AI motion should return smoothly to idle');
assert(shell.includes('1 - Math.exp(-delta * (sensedVoice > orbVoiceEnergy ? 14 : 5))'), 'voice motion should return smoothly to idle');
assert(shell.includes('id="orb-transcript"'), 'desktop should include the three-line AI transcript');
assert(shell.includes('data-orb-line="previous"'), 'transcript should include the previous sentence');
assert(shell.includes('data-orb-line="current"'), 'transcript should include the current sentence');
assert(shell.includes('data-orb-line="next"'), 'transcript should include unread text');
assert(shell.includes('font-family: Consolas'), 'transcript should use Consolas');
assert(shell.includes('setOrbTranscript(text, 0)'), 'spoken AI text should feed the transcript');
assert(shell.includes('window.PanthoriumOrb'), 'orb should expose its integration API');
assert(shell.includes('/vendor/three.min.js?v=r128-local'), 'orb should load Three.js locally instead of depending on a remote CDN');
assert(shell.includes('webglcontextlost'), 'orb should handle WebGL context loss');
assert(shell.includes('orb-fallback-active'), 'orb should retain a visible fallback when WebGL is unavailable');
assert(!shell.includes('1000 / 45'), 'orb animation cadence should match the supplied prototype source');
assert(!shell.includes('const SPHERE_RADIUS'), 'the old sphere implementation must be removed');
assert(!shell.includes('sphereGlow = new THREE.Points'), 'the old duplicate sphere glow layer must be removed');
assert(shell.includes('blending: THREE.AdditiveBlending'), 'orb glow should use additive blending');

console.log('Phase 14 desktop layout fix tests passed');
