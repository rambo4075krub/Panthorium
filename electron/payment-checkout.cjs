'use strict';
function validPaymentCheckoutUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try { const url = new URL(value); return url.origin === 'https://checkout.stripe.com' && !url.username && !url.password && !url.port && url.pathname.startsWith('/c/pay/'); } catch { return false; }
}
function installPaymentCheckout({ ipcMain, shell, security }) {
  ipcMain.handle('panthorium:payment-checkout', async (event, url) => {
    if (!security.isTrustedShellEvent(event)) return {ok:false,error:'untrusted_origin'};
    if (!validPaymentCheckoutUrl(url)) return {ok:false,error:'invalid_checkout_url'};
    try { await shell.openExternal(url); return {ok:true}; } catch { return {ok:false,error:'checkout_browser_unavailable'}; }
  });
}
module.exports = { validPaymentCheckoutUrl, installPaymentCheckout };
