const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const svg = source('panthorium-logo.svg');
const mark = source('panthorium-logo-mark.svg');
const shell = source('sentinel.html');
const branding = source('branding.js');
const bootStart = shell.indexOf('<div id="boot-screen">');
const bootEnd = shell.indexOf('<!-- LOGIN', bootStart);
const bootMarkup = bootStart >= 0 && bootEnd > bootStart ? shell.slice(bootStart, bootEnd) : '';

assert(bootMarkup.includes('panthorium-logo-mark.svg'), 'restart retains the plain logo mark');
assert(!bootMarkup.includes('data-panthorium-logo'), 'restart remains outside shared avatar branding');
assert(mark.includes('viewBox="0 0 256 256"') && !mark.includes('<circle'), 'restart mark remains plain');
assert(bootMarkup.includes('boot-title') && bootMarkup.includes('boot-progress') && bootMarkup.includes('boot-status'), 'restart keeps its existing text and progress');

const group = svg.match(/<g transform="([^"]+)">([\\s\\S]*?)<\\/g>/);
assert(group, 'logo artwork is contained by its original safe-inset group');
assert.equal(group[1], 'matrix(0.68 0 0 0.68 40.96 40.96)', 'restore the original logo scale');
assert(svg.includes('<rect width="256" height="256" fill="none"/>'), 'logo outside the mark stays transparent');
assert(!svg.includes('<circle'), 'the shared SVG does not add a second circle to the shell frame');
assert.equal((group[2].match(/<path /g) || []).length, 4, 'all original logo facets remain');
assert(!branding.includes('.sm-avatar > img[data-panthorium-logo]'), 'avatar art is never enlarged beyond its frame');
assert(branding.includes('overflow: hidden !important;'), 'logo frames clip their contents');
assert(/\\.sm-avatar \\{[^}]*background: rgba\\(0,255,204,0.15\\);[^}]*border: 1px solid var\\(--accent\\);/s.test(shell), 'restore the original guest avatar fill and border');
assert(/\\.login-avatar \\{[^}]*border: 2px solid var\\(--accent\\);[^}]*background: rgba\\(0,255,204,0.08\\);/s.test(shell), 'restore the original login avatar frame');
assert(/\\.about-logo \\{[^}]*border: 2px solid var\\(--accent\\);/s.test(shell), 'restore the original about logo frame');

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <div class="boot-logo" style="width:120px;height:120px;border-radius:50%"><img src="/panthorium-logo-mark.svg" alt="Panthorium"></div>
  <div class="login-avatar" style="width:90px;height:90px;border-radius:50%;border:2px solid #00ffcc"></div>
  <div class="sm-avatar" style="width:40px;height:40px;border-radius:50%;border:1px solid #00ffcc"></div>
  <div class="about-logo" style="width:80px;height:80px;border-radius:50%;border:2px solid #00ffcc"></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
try {
  const w = dom.window;
  w.eval(branding);
  assert(w.document.getElementById('panthorium-logo-fit-style').textContent.includes('overflow: hidden'), 'logo frames clip any oversized artwork');
  const restartFrame = w.document.querySelector('.boot-logo');
  assert.equal(restartFrame.querySelector('img').getAttribute('src'), '/panthorium-logo-mark.svg');
  assert(!restartFrame.classList.contains('panthorium-logo-frame'), 'restart page is untouched by shared branding');
  for (const selector of ['.login-avatar', '.sm-avatar', '.about-logo']) {
    const frame = w.document.querySelector(selector);
    assert.equal(frame.style.borderRadius, '50%', selector + ' retains its circle');
    assert(frame.querySelector('img[data-panthorium-logo]'), selector + ' contains the original logo');
    assert(frame.classList.contains('panthorium-logo-frame'));
  }
  assert.equal(restartFrame.style.width, '120px', 'restart logo keeps its original size');
} finally {
  dom.window.close();
}
console.log('Branding logo: restore original mark sizing and shell frames; restart remains unchanged');
