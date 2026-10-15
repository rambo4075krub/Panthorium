'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('window-theme-ui.js', 'utf8');
const baseCss = fs.readFileSync('panthorium-window-base.css', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function contrast(foreground, background) {
 const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255)
  .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
 const a = luminance(foreground), b = luminance(background);
 return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function nativeFields() {
 return `<label>บทบาท<select name="role" aria-label="บทบาท">
  <optgroup label="ทีม"><option value="member" selected>สมาชิก</option><option value="viewer">ผู้ดู</option><option value="blocked" disabled>ปิดใช้งาน</option></optgroup>
  <optgroup label="ยังไม่พร้อม" disabled><option value="future">ในอนาคต</option></optgroup>
 </select></label>
 <select name="teams" multiple size="4" aria-label="ทีม"><option value="a" selected>ทีม ก</option><option value="b">ทีม ข</option><option value="c" selected>ทีม ค</option></select>
 <select name="locked" disabled><option selected>ปิดใช้งาน</option></select>
 <select name="legacy" style="color:white;background:white;color-scheme:light"><option style="color:white;background:white">สีเฉพาะแอป</option></select>`;
}

function checkPalette(w, root, rules) {
 const normal = root.querySelector('option[value="viewer"]');
 const selected = root.querySelector('option[value="member"]');
 const disabled = root.querySelector('option[value="blocked"]');
 const disabledGroup = root.querySelector('optgroup[disabled]');
 for (const node of root.querySelectorAll('select:not([name=legacy]),select:not([name=legacy]) option,select:not([name=legacy]) optgroup')) {
  const css = w.getComputedStyle(node);
  assert.equal(css.colorScheme, 'dark');
  assert(['', 'none'].includes(css.backgroundImage), 'native popups use solid colors, not glass gradients');
  assert(contrast(css.color, css.backgroundColor) >= 4.5, `readable native control: ${node.outerHTML}`);
 }
 assert.equal(w.getComputedStyle(normal).backgroundColor, 'rgb(11, 25, 44)');
 assert.equal(w.getComputedStyle(selected).backgroundColor, 'rgb(36, 86, 107)');
 for (const node of [disabled, disabledGroup, disabledGroup.firstElementChild, root.querySelector('select:disabled'), root.querySelector('select:disabled option')]) {
  assert.equal(w.getComputedStyle(node).color, 'rgb(158, 179, 195)');
 }
 // JSDOM does not implement stylesheet !important > normal inline declarations.
 // Check the matching author declarations here; real-browser QA checks the cascade.
 for (const node of root.querySelectorAll('[name=legacy],[name=legacy] option')) {
  const matching = rules.filter(rule => rule.selectorText?.includes('select') && rule.style.getPropertyValue('color-scheme') === 'dark' && node.matches(rule.selectorText));
  for (const property of ['background', 'color', 'color-scheme']) {
   assert(matching.some(rule => rule.style.getPropertyPriority(property) === 'important'), `${property} must override app inline colors`);
  }
  assert.equal(node.style.color, 'white', 'theme does not rewrite application-owned inline state');
 }
 const control = root.querySelector('[name=role]');
 assert(control instanceof w.HTMLSelectElement);
 assert.equal(control.value, 'member');
 assert.equal(control.getAttribute('aria-label'), 'บทบาท');
 assert.equal(root.querySelector('[name=teams]').multiple, true);
 assert.deepEqual(Array.from(root.querySelector('[name=teams]').selectedOptions, o => o.value), ['a', 'c']);
 assert.equal(root.querySelector('[name=locked]').disabled, true);
 let changes = 0; control.addEventListener('change', () => changes++);
 control.value = 'viewer'; control.dispatchEvent(new w.Event('change', { bubbles: true }));
 assert.equal(changes, 1); assert.equal(control.value, 'viewer');
}

async function checkNativeSelects(mode) {
 const dom = new JSDOM('<!doctype html><head></head><body style="color-scheme:light"><select id="outside" style="color:black;background:white"><option>Outside</option></select></body>', { runScripts: 'outside-only' });
 const w = dom.window;
 try {
  if (mode !== 'theme') { const style = w.document.createElement('style'); style.textContent = baseCss; w.document.head.append(style); }
  if (mode !== 'base') w.eval(source);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  // Future external windows and options receive the palette without per-app hooks.
  for (const attribute of ['class="window"', 'class="panthorium-window"', 'class="panthorium-managed-window"', 'data-panthorium-window="future"']) {
   const root = w.document.createElement('section'); root.innerHTML = `<div ${attribute}>${nativeFields()}</div>`;
   w.document.body.append(root); await tick();
   const rules = Array.from(w.document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules));
   checkPalette(w, root.firstElementChild, rules);
  }
  assert.equal(w.getComputedStyle(w.document.getElementById('outside')).backgroundColor, 'rgb(255, 255, 255)', 'unmanaged page controls remain untouched');
  const rules = Array.from(w.document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules));
  const forced = rules.filter(rule => rule.media?.mediaText === '(forced-colors:active)').flatMap(rule => Array.from(rule.cssRules));
  assert(forced.length > 0, 'Windows high contrast has explicit system-color fallbacks');
  const normal = forced.find(rule => rule.selectorText.endsWith('select :is(option,optgroup)'));
  assert.equal(normal.style.getPropertyValue('forced-color-adjust'), 'auto');
  assert.equal(normal.style.getPropertyValue('background'), 'Canvas');
  assert.equal(normal.style.getPropertyValue('color'), 'CanvasText');
  const selected = forced.find(rule => rule.selectorText.endsWith('option:checked'));
  assert.equal(selected.style.getPropertyValue('background'), 'Highlight');
  assert.equal(selected.style.getPropertyValue('color'), 'HighlightText');
  assert(forced.some(rule => rule.style.getPropertyValue('color') === 'GrayText'));
  assert(!rules.some(rule => rule.selectorText?.includes('select') && ['none', 'base-select'].includes(rule.style.getPropertyValue('appearance'))), 'preserve the native picker, arrow and keyboard behavior');
 } finally { w.close(); }
}

(async () => {
 const dom = new JSDOM('<!doctype html><head></head><body><div class="window"><div class="window-titlebar">Notes</div><input value="keep"></div></body>', { runScripts: 'outside-only' });
 const w = dom.window; w.eval(source);
 w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await tick();
 assert.equal(w.document.querySelector('.window').dataset.panthoriumTheme, 'reference-glass');
 const root = w.document.createElement('div'); root.className = 'panthorium-managed-window';
 root.innerHTML = '<header><h2>Future app</h2><button data-close>Close</button></header><textarea>preserved</textarea>';
 let clicked = 0; root.querySelector('button').onclick = () => clicked++; w.document.body.append(root); await tick();
 assert.equal(root.dataset.panthoriumTheme, 'reference-glass'); assert(root.firstElementChild.hasAttribute('data-pt-titlebar'));
 root.querySelector('button').click(); assert.equal(clicked, 1);
 assert.equal(root.querySelector('textarea').value, 'preserved'); assert.equal(w.document.querySelector('input').value, 'keep');
 w.eval(source); assert.equal(w.document.querySelectorAll('#panthorium-reference-window-theme').length, 1);
 const css = w.document.querySelector('style').textContent, ref = fs.readFileSync('design/window-reference.html', 'utf8');
 for (const value of ['#57f5ff', '#aa8cff', '#87dfff25', 'linear-gradient(125deg,#102336df,#050d1be8 62%,#11152bda)', '0 25px 90px #000b,0 0 35px #08baff15,inset 0 1px #c7f5ff35']) { assert(ref.includes(value)); assert(css.includes(value)); }
 assert(fs.readFileSync('server.js', 'utf8').includes('"window-theme-ui.js"'));
 assert(!/\.panthorium-window-fullscreen\s*\{[^}]*padding/.test(css)); w.close();
 for (const mode of ['base', 'theme', 'combined']) await checkNativeSelects(mode);
 console.log('Window theme: native select contrast, selected/disabled groups, high-contrast rules, dynamic window scopes, state preservation and canonical appearance passed');
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
