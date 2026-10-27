const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { JSDOM } = require('jsdom');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const svg = source('panthorium-logo.svg');
const mark = source('panthorium-logo-mark.svg');
const shell = source('sentinel.html');
const branding = source('branding.js');
const bootStart = shell.indexOf('<div id="boot-screen">');
const bootEnd = shell.indexOf('<!-- LOGIN', bootStart);
const bootMarkup = bootStart >= 0 && bootEnd > bootStart ? shell.slice(bootStart, bootEnd) : '';
const cssBlock = selector => {
  const start = shell.indexOf(selector + ' {');
  const end = shell.indexOf('}', start);
  return start >= 0 && end > start ? shell.slice(start, end) : '';
};

assert(bootMarkup.includes('panthorium-logo-mark.svg'), 'restart retains the plain logo mark');
assert(!bootMarkup.includes('data-panthorium-logo'), 'restart remains outside shared avatar branding');
assert(mark.includes('viewBox="0 0 256 256"') && !mark.includes('<circle'), 'restart mark remains plain');
assert(bootMarkup.includes('boot-title') && bootMarkup.includes('boot-progress') && bootMarkup.includes('boot-status'), 'restart keeps its existing text and progress');

const png = fs.readFileSync(path.join(__dirname, '..', 'panthorium-logo.png'));
// Preserve the actual system assets from before the sapphire change, not a redraw
// of the separately uploaded source image. Hashes are from commit 72f5ffa.
for (const [name, asset, expected] of [
  ['shared', svg, '019b2a1a4335375139214b9ec2d2124fe863873a36acb0a72a714d56fece3ca5'],
  ['boot', mark, '4184ccd856d70ff5f7a6099fcb7c8efd73eacb8e5210f2e08c2fee3bebe4be31'],
]) {
  assert.equal(createHash('sha256').update(asset).digest('hex'), expected, name + ' restores the original system SVG exactly');
  assert(asset.includes('matrix(0.68 0 0 0.68 40.96 40.96)'), name + ' keeps safe circular-frame spacing');
  assert(!asset.includes('<circle'), name + ' does not add a second circle');
}
assert.equal(png.readUInt32BE(16), 512, 'PNG width matches the manifest');
assert.equal(png.readUInt32BE(20), 512, 'PNG height matches the manifest');
for (const file of ['panthorium-logo-sapphire.png', 'mobile/android/www/panthorium-logo.png', 'mobile/android/www/panthorium-logo-sapphire.png']) {
  assert.deepEqual(fs.readFileSync(path.join(__dirname, '..', file)), png, file + ' serves the original orange artwork, including legacy URLs');
}
assert(!branding.includes('.sm-avatar > img[data-panthorium-logo]'), 'avatar art is never enlarged beyond its frame');
assert(branding.includes('overflow: hidden !important;'), 'logo frames clip their contents');
assert(cssBlock('.sm-avatar').includes('background: rgba(0,255,204,0.15);') && cssBlock('.sm-avatar').includes('border: 1px solid var(--accent);'), 'restore the original guest avatar fill and border');
assert(cssBlock('.login-avatar').includes('border: 2px solid var(--accent);') && cssBlock('.login-avatar').includes('background: rgba(0,255,204,0.08);'), 'restore the original login avatar frame');
assert(cssBlock('.about-logo').includes('border: 2px solid var(--accent);'), 'restore the original about logo frame');

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <div class="boot-logo" style="width:120px;height:120px;border-radius:50%"><img src="/panthorium-logo-mark.svg" alt="Panthorium"></div>
  <div class="login-avatar" style="width:90px;height:90px;border-radius:50%;border:2px solid #00ffcc"><img data-panthorium-logo src="/panthorium-logo.svg" alt="Panthorium"></div>
  <div class="sm-avatar" style="width:40px;height:40px;border-radius:50%;border:1px solid #00ffcc"></div>
  <div class="about-logo" style="width:80px;height:80px;border-radius:50%;border:2px solid #00ffcc"></div>
</body></html>`, { url:'https://panthorium.net/', runScripts: 'outside-only', pretendToBeVisual: true });
try {
  const w = dom.window;
  w.eval(branding);
  assert(w.document.getElementById('panthorium-logo-fit-style').textContent.includes('overflow: hidden'), 'logo frames clip any oversized artwork');
  const restartFrame = w.document.querySelector('.boot-logo');
  assert.equal(restartFrame.querySelector('img').getAttribute('src'), '/panthorium-logo-mark.svg');
  assert(!restartFrame.classList.contains('panthorium-logo-frame'), 'restart page is untouched by shared branding');
  for (const selector of ['.login-avatar', '.sm-avatar', '.about-logo']) {
    const frame = w.document.querySelector(selector);
    assert.equal(frame.querySelector('img').getAttribute('src'), '/panthorium-logo.svg?v=original-orange-20261015');
    assert.equal(frame.style.borderRadius, '50%', selector + ' retains its circle');
    assert(frame.querySelector('img[data-panthorium-logo]'), selector + ' contains the original logo');
    assert(frame.classList.contains('panthorium-logo-frame'));
  }
  const shared = w.document.querySelector('.sm-avatar img');
  shared.dispatchEvent(new w.Event('error'));
  assert(shared.src.includes('panthorium-logo.png'), 'failed SVG uses the existing PNG');
  w.PanthoriumBranding.refresh();
  assert(shared.src.includes('panthorium-logo.png'), 'branding refresh does not restart the failed SVG request');
  const fallbackUrl=shared.src;shared.dispatchEvent(new w.Event('error'));
  assert.equal(shared.src,fallbackUrl,'fallback errors do not loop');
  assert.equal(restartFrame.style.width, '120px', 'restart logo keeps its original size');
} finally {
  dom.window.close();
}
console.log('Branding: original system SVG identity, safe spacing, existing-image upgrade, Android fallback and legacy URL coverage passed');
