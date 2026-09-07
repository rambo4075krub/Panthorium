const assert = require('assert');
const fs = require('fs');

const pkg = fs.readFileSync('package.json', 'utf8');
const boot = fs.readFileSync('boot-recovery.js', 'utf8');
const orb = fs.readFileSync('energy-orb-ui.js', 'utf8');

assert(pkg.includes('14.3.0-energy-orb-desktop'), 'package version must identify Phase 14.3 Energy Orb desktop integration');
assert(pkg.includes('node --check energy-orb-ui.js'), 'check script must validate energy-orb-ui.js');
assert(pkg.includes('test/phase14-energy-orb-desktop.js'), 'test script must include Energy Orb desktop coverage');

assert(boot.includes('/energy-orb-ui.js?v=phase14-orb-shape-v2'), 'boot recovery must bust cache for the corrected Orb shape');
assert(boot.includes('__panthoriumEnergyOrbLoader'), 'boot recovery must dedupe Energy Orb script injection');

assert(orb.includes('PanthoriumEnergyOrb'), 'Energy Orb must expose a global control API');
assert(orb.includes('PANTHORIUM ENERGY CORE INTERACTIVE PROTOTYPE'), 'Energy Orb must preserve the prototype identity');
assert(orb.includes('เลื่อนเมาส์เพื่อควบคุม · คลิกเพื่อปล่อยพลังงาน'), 'Energy Orb must preserve mouse/click behavior copy');
assert(orb.includes('PROTOTYPE_SHAPE'), 'Energy Orb must lock the prototype shape constants');
assert(orb.includes('count:3500'), 'prototype sphere must use the original dense point count');
assert(orb.includes('radius:90'), 'prototype sphere must preserve the original radius');
assert(orb.includes('camera:[220,180,220]'), 'prototype sphere must preserve the original camera angle');
assert(orb.includes('goldenAngle:Math.PI*(3-Math.sqrt(5))'), 'prototype sphere must use golden-angle fibonacci distribution');
assert(orb.includes('camera.lookAt(0,0,0)'), 'prototype sphere must look at the orb center');
assert(orb.includes('new THREE.Points'), 'prototype shape must be a point-cloud sphere');
assert(orb.includes('makePrototypeHaloTexture'), 'prototype halo must preserve the old visual glow');
assert(!orb.includes('IcosahedronGeometry'), 'corrected shape must not add a wireframe core that distorts the prototype');
assert(!orb.includes('TorusGeometry'), 'corrected shape must not add rings that distort the prototype');
assert(orb.includes('bg-canvas') && orb.includes('panthorium-energy-orb-replaced'), 'Energy Orb must replace the legacy sphere canvas visually');
assert(orb.includes("font-family:Consolas,'Courier New',monospace"), 'caption must use Consolas / command prompt font');
assert(orb.includes('grid-template-rows:repeat(3'), 'caption must render exactly three rows');
assert(orb.includes("role=\"log\"") && orb.includes('aria-live="polite"'), 'caption must expose live text accessibly');
assert(orb.includes("addEventListener('wheel'") && orb.includes('ArrowUp') && orb.includes('ArrowDown'), 'caption must navigate previous/next without a scrollbar');
assert(orb.includes('panthorium:ai-stream') && orb.includes('panthorium:ai-done'), 'Energy Orb must connect to AI stream/done events');
assert(orb.includes('panthorium:voice-start') && orb.includes('panthorium:voice-boundary') && orb.includes('panthorium:voice-end'), 'Energy Orb must sync with Thai voice events');
assert(orb.includes('panthorium:voice-user-start') && orb.includes('panthorium:voice-user-result'), 'Energy Orb must sync with user speech events');
assert(orb.includes('prefers-reduced-motion'), 'Energy Orb must respect reduced-motion users');
assert(!orb.includes('new MutationObserver'), 'Energy Orb must not introduce whole-document MutationObserver loops');

console.log('phase14 energy orb desktop ok');
