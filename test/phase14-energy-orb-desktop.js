const assert = require('assert');
const fs = require('fs');

const shell = fs.readFileSync('sentinel.html', 'utf8');

assert(!shell.includes('/energy-orb-ui.js'), 'desktop must not load the duplicate replacement orb');
assert(shell.includes('try {\n            initBackground();'), 'desktop must initialize the source prototype orb');
assert(shell.includes('id="bg-canvas"'), 'prototype orb must render in the desktop canvas');
assert(shell.includes('new THREE.PerspectiveCamera(42'), 'prototype camera field of view must be preserved');
assert(shell.includes('camera.position.set(0, 0, 4.65)'), 'prototype camera position must be preserved');
assert(shell.includes('antialias: true'), 'prototype WebGL antialiasing must be preserved');
assert(shell.includes('Math.min(window.devicePixelRatio, 2)'), 'prototype pixel density must be preserved');
assert(shell.includes('renderer.setClearColor(0x01030a, 1)'), 'prototype clear color must be preserved');
assert(shell.includes('window.innerWidth < 700 ? 11880 : 23100'), 'prototype responsive particle counts must be preserved');
assert(shell.includes('new THREE.SphereGeometry(.77, 64, 64)'), 'prototype core geometry must be preserved');
assert(shell.includes('new Float32Array(750 * 3)'), 'prototype star count must be preserved');
assert(shell.includes('8.86578/-mv.z'), 'prototype particle point size must be preserved');
assert(shell.includes('redSheen=.008'), 'prototype subtle red sheen must be preserved');
assert(shell.includes('smoothPulse * .16'), 'click response must preserve prototype expansion');
assert(shell.includes('orbAIEnergy * (.15 + Math.sin(time * 9) * .01)'), 'AI speech response must preserve prototype expansion');
assert(shell.includes('orbVoiceEnergy * .018'), 'user speech response must stay subtle');
assert(shell.includes('id="orb-transcript"'), 'desktop must include the three-line transcript');
assert(shell.includes('data-orb-line="previous"'), 'transcript must include the previous sentence');
assert(shell.includes('data-orb-line="current"'), 'transcript must include the current sentence');
assert(shell.includes('data-orb-line="next"'), 'transcript must include unread text');
assert(shell.includes('font-family: Consolas'), 'transcript must use Consolas');
assert(shell.includes('setOrbTranscript(text, 0)'), 'AI speech must feed the transcript');
assert(shell.includes('window.PanthoriumOrb'), 'orb must expose its integration API');
assert(shell.includes('panel.addEventListener("wheel"'), 'transcript must navigate without a scrollbar');
assert(shell.includes('webglcontextlost'), 'desktop must recover safely if WebGL is lost');
assert(!shell.includes('const SPHERE_RADIUS'), 'legacy sphere implementation must stay removed');

console.log('phase14 exact prototype orb desktop ok');
