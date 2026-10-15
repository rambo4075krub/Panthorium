'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
(async () => {
 const dom = new JSDOM('<!doctype html><head></head><body><div class="window"><div class="window-titlebar">Notes</div><input value="keep"></div></body>', {runScripts:'outside-only'});
 const w=dom.window; const source=fs.readFileSync('window-theme-ui.js','utf8');w.eval(source);
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,0));
 assert.equal(w.document.querySelector('.window').dataset.panthoriumTheme,'reference-glass');
 const root=w.document.createElement('div');root.className='panthorium-managed-window';root.innerHTML='<header><h2>Future app</h2><button data-close>Close</button></header><textarea>preserved</textarea>';let clicked=0;root.querySelector('button').onclick=()=>clicked++;w.document.body.append(root);await new Promise(r=>setTimeout(r,0));
 assert.equal(root.dataset.panthoriumTheme,'reference-glass');assert(root.firstElementChild.hasAttribute('data-pt-titlebar'));root.querySelector('button').click();assert.equal(clicked,1);assert.equal(root.querySelector('textarea').value,'preserved');assert.equal(w.document.querySelector('input').value,'keep');
 w.eval(source);assert.equal(w.document.querySelectorAll('#panthorium-reference-window-theme').length,1);
 const css=w.document.querySelector('style').textContent;const ref=fs.readFileSync('design/window-reference.html','utf8');for(const value of ['#57f5ff','#aa8cff','#87dfff25','linear-gradient(125deg,#102336df,#050d1be8 62%,#11152bda)','0 25px 90px #000b,0 0 35px #08baff15,inset 0 1px #c7f5ff35']){assert(ref.includes(value));assert(css.includes(value));}
 assert(fs.readFileSync('server.js','utf8').includes('"window-theme-ui.js"'));assert(!/\.panthorium-window-fullscreen\s*\{[^}]*padding/.test(css));dom.window.close();console.log('Window theme: existing/future windows, handlers, input state, canonical values and idempotence passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
