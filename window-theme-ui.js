/* Panthorium shared window appearance. Canonical reference: design/window-reference.html.
 * Applies to native windows and registered external windows, including future ones.
 * This module changes presentation only; application handlers and permissions stay owned by apps.
 */
(function () {
  'use strict';
  const styleId = 'panthorium-reference-window-theme';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
:root {
 --pt-cyan:#57f5ff; --pt-violet:#aa8cff; --pt-muted:#8dabc0;
 --pt-border:#87dfff25; --pt-panel:#0a1726d4; --pt-text:#e8f5ff;
 --pt-window-background:linear-gradient(125deg,#102336df,#050d1be8 62%,#11152bda);
 --pt-window-shadow:0 25px 90px #000b,0 0 35px #08baff15,inset 0 1px #c7f5ff35;
 --pt-title-background:linear-gradient(100deg,#12314570,#08101c50);
 --pt-card-background:linear-gradient(130deg,#17394c9c,#0d1c31bd 70%);
 --pt-input-background:linear-gradient(120deg,#16364be6,#0b192cfa 65%,#202440df);
}
/* Specificity anchor outranks legacy class styles; !important handles inline surfaces. */
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) {
 background:var(--pt-window-background)!important; border:1px solid #71dcff65!important;
 box-shadow:var(--pt-window-shadow)!important; backdrop-filter:blur(24px)!important;
 color:var(--pt-text)!important; font-family:'Segoe UI',Tahoma,sans-serif!important;
 --surface:#0a1726d4; --surface2:#102336; --text:#e8f5ff; --text-dim:#8dabc0;
 --accent:#57f5ff; --window-radius:22px; color-scheme:dark;
 scrollbar-width:thin; scrollbar-color:#34617b transparent;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]):not(.maximized):not(.panthorium-window-fullscreen) {border-radius:22px!important;}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window])::before {
 content:'';position:absolute;top:0;left:5%;right:25%;height:1px;
 background:linear-gradient(90deg,transparent,#a5ffff,transparent);box-shadow:0 0 18px #46ddff;pointer-events:none;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.window-titlebar,[data-pt-titlebar]) {
 min-height:70px!important;height:auto!important;flex-shrink:0;
 background:var(--pt-title-background)!important;border-bottom:1px solid var(--pt-border)!important;
 padding:12px 23px!important;gap:12px;color:var(--pt-text)!important;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.window-title,[data-pt-titlebar] h2) {
 font-size:20px!important;font-weight:600!important;letter-spacing:.3px;text-shadow:none!important;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.window-body,[data-pt-body]) {
 background:transparent!important;color:var(--pt-text);scrollbar-width:thin;scrollbar-color:#34617b transparent;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(button,input,select,textarea) {font-family:inherit!important;}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),select,textarea) {
 background:var(--pt-input-background)!important;color:#e8f7ff!important;
 border:1px solid #77e0ff6a!important;border-radius:12px!important;
 box-shadow:inset 0 1px #bcffff25;max-width:100%;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(input,textarea)::placeholder{color:#6e92ac!important;}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) button:not(.win-btn):not(.panthorium-window-control):not([data-close]):not([id$='-close']) {
 border-radius:10px!important;border:1px solid #8be4ff32;background:var(--pt-card-background);color:var(--pt-text);
 box-shadow:inset 0 1px #c8f5ff13;transition:background .2s,box-shadow .2s;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) button:hover:not(:disabled){filter:brightness(1.2);}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) button:disabled{opacity:.48;cursor:not-allowed;}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(button,input,textarea,select):focus-visible{outline:2px solid var(--pt-cyan)!important;outline-offset:3px;}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.win-btn,.panthorium-window-control,[data-close],[id$='-close']) {
 width:34px!important;height:32px!important;min-width:34px!important;padding:0!important;
 border:1px solid #81d7f21c!important;border-radius:8px!important;background:#132a3e50!important;color:#d4e9f7!important;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.win-btn.close,[data-close],[id$='-close']):hover{background:#92344f!important;}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.card,[data-pt-card]) {
 background:var(--pt-card-background)!important;border:1px solid #8be4ff32!important;border-radius:13px!important;
 box-shadow:inset 0 1px #c8f5ff13,0 10px 25px #0002!important;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(aside,[data-pt-sidebar]) {
 background:linear-gradient(150deg,#0f233780,#06101acc)!important;border-right:1px solid var(--pt-border);
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is([aria-selected=true],[aria-current=page],[data-pt-nav].active) {
 color:#9affff!important;background:linear-gradient(100deg,#17b7ce26,#0c2e4930)!important;
 border-color:#52e5f56b!important;box-shadow:inset 3px 0 #6dfaff,0 0 18px #00dbff0c!important;
}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(th,td){border-color:var(--pt-border)!important;}
:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) th{background:#12314570!important;color:#b6dceb!important;}
@media(max-height:800px) and (min-width:761px){
 :is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.window-titlebar,[data-pt-titlebar]){min-height:60px!important;}
}
@media(max-width:600px){
 :is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.window-titlebar,[data-pt-titlebar]){min-height:62px!important;padding:10px 13px!important;gap:5px;}
 :is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.window-title,[data-pt-titlebar] h2){font-size:16px!important;}
 :is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) :is(.win-btn,.panthorium-window-control){width:28px!important;min-width:28px!important;}
}
@media(prefers-reduced-motion:reduce){:is(#panthorium-theme-specificity,.window,.panthorium-managed-window,[data-panthorium-window]) *{transition:none!important;}}
`;
  document.head.appendChild(style);
  function apply(root) {
    if (!root || root.nodeType !== 1) return;
    root.dataset.panthoriumTheme = 'reference-glass';
    if (root.classList.contains('window')) return;
    // External apps put their heading/toolbar first. Only mark a verified header,
    // never the entire content wrapper, so business layouts remain intact.
    const first = root.firstElementChild;
    if (first && (first.matches('header') || first.querySelector('h1,h2,[data-close],[id$="-close"]'))) {
      first.setAttribute('data-pt-titlebar', '');
    }
  }
  function scan() {
    if (!window.document?.body) return;
    document.querySelectorAll('.window,.panthorium-managed-window,[data-panthorium-window]').forEach(apply);
  }
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; scan(); });
  });
  function start() { scan(); observer.observe(document.body, { childList:true, subtree:true }); }
  window.PanthoriumWindowTheme = Object.freeze({ apply, scan, reference:'design/window-reference.html' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
