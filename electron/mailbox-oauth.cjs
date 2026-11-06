'use strict';

const providers = {
  google: { origin: 'https://accounts.google.com', path: '/o/oauth2/v2/auth', scope: 'openid email https://www.googleapis.com/auth/gmail.modify' },
  microsoft: { origin: 'https://login.microsoftonline.com', path: '/common/oauth2/v2.0/authorize', scope: 'openid email offline_access User.Read Mail.ReadWrite Mail.Send' }
};
const keys = new Set(['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'prompt', 'login_hint', 'access_type']);

function validMailboxOAuthUrl(value, appOrigin) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value), q = url.searchParams;
    if (url.username || url.password || url.hash || url.port) return false;
    const pair = Object.entries(providers).find(([, p]) => p.origin === url.origin && p.path === url.pathname);
    if (!pair) return false;
    const [provider, spec] = pair;
    for (const key of q.keys()) if (!keys.has(key) || q.getAll(key).length !== 1) return false;
    if (new URL(appOrigin).origin !== appOrigin || !appOrigin.startsWith('https://')) return false;
    return q.get('redirect_uri') === appOrigin + '/api/mailbox/oauth/' + provider + '/callback'
      && q.get('response_type') === 'code' && q.get('scope') === spec.scope
      && q.get('code_challenge_method') === 'S256' && q.get('prompt') === 'consent'
      && /^[A-Za-z0-9_-]{43}$/.test(q.get('state') || '')
      && /^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') || '')
      && /^[^\s]{1,500}$/.test(q.get('client_id') || '')
      && (provider !== 'google' || q.get('access_type') === 'offline');
  } catch { return false; }
}

function installMailboxOAuth({ ipcMain, shell, security, appOrigin }) {
  ipcMain.handle('panthorium:mailbox-oauth', async (event, url) => {
    if (!security.isTrustedShellEvent(event)) return { ok: false, error: 'untrusted_origin' };
    if (!validMailboxOAuthUrl(url, appOrigin)) return { ok: false, error: 'invalid_mailbox_oauth_url' };
    try { await shell.openExternal(url); return { ok: true }; }
    catch { return { ok: false, error: 'mailbox_browser_unavailable' }; }
  });
}

module.exports = { validMailboxOAuthUrl, installMailboxOAuth };
