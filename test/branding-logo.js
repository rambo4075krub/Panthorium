const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const svg = source('panthorium-logo.svg');
const group = svg.match(/<g transform="([^"]+)">([\s\S]*?)<\/g>/);
assert(group, 'logo facets are contained by a centered scale group');
assert.equal(group[1], 'matrix(0.52 0 0 0.52 61.44 61.44)');
assert(svg.includes('<circle cx="128" cy="128" r="100" fill="#003f40"/>'), 'logo has a colored interior circle');
assert(svg.includes('stroke="#00e8c6" stroke-width="5"'), 'logo has the reference teal ring');
assert(!svg.includes('<rect width="256" height="256" fill='), 'area outside the ring remains transparent');
assert.equal((group[2].match(/<path /g) || []).length, 4, 'all colored logo facets remain in the scaled group');

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <div class="boot-logo" style="width:120px;height:120px;border-radius:50%"></div>
  <div class="login-avatar" style="width:90px;height:90px;border-radius:50%"></div>
  <div class="sm-avatar" style="width:40px;height:40px;border-radius:50%"></div>
  <div class="about-logo" style="width:80px;height:80px;border-radius:50%"></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
try {
  const w = dom.window;
  w.eval(source('branding.js'));
  assert(w.document.getElementById('panthorium-logo-fit-style').textContent.includes('overflow: hidden'), 'logo frames clip any future oversized artwork');
  for (const selector of ['.boot-logo', '.login-avatar', '.sm-avatar', '.about-logo']) {
    const frame = w.document.querySelector(selector);
    assert.equal(frame.style.borderRadius, '50%', selector + ' retains its circular frame');
    assert(frame.querySelector('img[data-panthorium-logo]'), selector + ' contains the shared logo');
    assert(frame.classList.contains('panthorium-logo-frame'));
  }
  assert.equal(w.document.querySelector('.boot-logo').style.width, '120px', 'boot branding does not override responsive frame sizing');
  const future = w.document.createElement('div');
  future.dataset.panthoriumLogoFrame = '';
  future.style.cssText = 'width:48px;height:48px;border-radius:50%;border:1px solid #00ffcc';
  w.document.body.appendChild(future);
  w.PanthoriumBranding.refresh();
  assert(future.querySelector('img[data-panthorium-logo]'), 'future app logo frames use the same transparent circular logo');
  assert.equal(future.style.borderRadius, '50%', 'future app frame remains circular');
} finally {
  dom.window.close();
}
console.log('Branding logo: shared logo keeps its ring and transparent exterior in every shell frame');
