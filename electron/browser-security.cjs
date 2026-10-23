'use strict';
const crypto = require('node:crypto');
const { isIP } = require('node:net');

function safeWebviewUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && host.includes('.')
      && !host.startsWith('[') && isIP(host) === 0 && host !== 'localhost'
      && !['.localhost', '.local', '.internal'].some(suffix => host.endsWith(suffix));
  } catch { return false; }
}

function createBrowserSecurity({ app, session, trustedOrigin, edition }) {
  const shells = new Map(), guests = new Map(), configured = new WeakSet();
  const safePreferences = Object.freeze({ contextIsolation: true, sandbox: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webSecurity: true,
    allowRunningInsecureContent: false, experimentalFeatures: false, webviewTag: false });
  const shellFrame = (wc, origin, details = {}) => !!wc && shells.has(wc.id) && !wc.isDestroyed()
    && trustedOrigin(wc.getURL()) && trustedOrigin(origin) && details.isMainFrame === true
    && (!details.requestingUrl || trustedOrigin(details.requestingUrl))
    && (!details.securityOrigin || trustedOrigin(details.securityOrigin))
    && (!details.embeddingOrigin || trustedOrigin(details.embeddingOrigin));

  function installSession(ses) {
    if (configured.has(ses)) return;
    configured.add(ses);
    ses.setPermissionCheckHandler((wc, permission, origin, details = {}) =>
      shellFrame(wc, origin, details) && (permission === 'notifications'
        || (permission === 'media' && ['audio', 'video'].includes(details.mediaType))));
    ses.setPermissionRequestHandler((wc, permission, callback, details = {}) => {
      const allowed = shellFrame(wc, details.requestingUrl, details) && (permission === 'notifications'
        || (permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0
          && details.mediaTypes.every(type => ['audio', 'video'].includes(type))));
      callback(allowed);
    });
    // Screen/device access is a different permission from camera/microphone.
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  }

  function destroyGuests(ownerId) {
    for (const [wc, entry] of guests) if (entry.ownerId === ownerId) {
      guests.delete(wc);
      try { if (entry.window && !entry.window.isDestroyed()) entry.window.destroy();
        else if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false }); } catch {}
    }
  }

  function setAccount(wc, accountId) {
    const state = shells.get(wc.id);
    if (!state) return { ok: false, error: 'untrusted_origin' };
    if (typeof accountId !== 'string' || accountId.length > 160 || /[\x00-\x20]/.test(accountId)) {
      return { ok: false, error: 'invalid_browser_account' };
    }
    if (state.accountId !== accountId) {
      destroyGuests(wc.id);
      state.accountId = accountId;
      state.partitions = accountId ? Object.fromEntries(['browser', 'external'].map(kind => [kind,
        'persist:panthorium-' + kind + '-v2-' + crypto.createHash('sha256').update(edition + ':' + accountId).digest('hex')])) : {};
      for (const partition of Object.values(state.partitions)) {
        const ses = session.fromPartition(partition);
        installSession(ses);
        // Also covers renderer-initiated loadURL, which does not emit will-navigate.
        ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel:
          details.url.startsWith('file:') || (['mainFrame', 'subFrame'].includes(details.resourceType)
            && !safeWebviewUrl(details.url) && !['about:blank', 'about:srcdoc'].includes(details.url)) }));
      }
    }
    return { ok: true, partitions: { ...state.partitions } };
  }

  function protectGuest(wc, ownerId, accountId, window = null) {
    installSession(wc.session);
    guests.set(wc, { ownerId, accountId, window });
    wc.once('destroyed', () => guests.delete(wc));
    const current = () => shells.get(ownerId)?.accountId === accountId;
    const guard = (event, url) => { if (!current() || !safeWebviewUrl(url)) event.preventDefault(); };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url }) => {
      if (!current() || (!safeWebviewUrl(url) && url !== 'about:blank')) return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true,
        webPreferences: { ...safePreferences, session: wc.session, preload: undefined } } };
    });
    wc.on('did-create-window', popup => {
      if (!current()) { popup.destroy(); return; }
      popup.removeMenu();
      protectGuest(popup.webContents, ownerId, accountId, popup);
    });
  }

  function registerShell(wc) {
    shells.set(wc.id, { accountId: '', partitions: {} });
    installSession(wc.session);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event, url) => { if (!trustedOrigin(url)) event.preventDefault(); };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-attach-webview', (event, preferences, params) => {
      const state = shells.get(wc.id);
      if (!trustedOrigin(wc.getURL()) || !state?.accountId
          || !Object.values(state.partitions).includes(params.partition)
          || (params.src && params.src !== 'about:blank' && !safeWebviewUrl(params.src))) {
        event.preventDefault(); return;
      }
      // Never let attributes from remote HTML grant native capabilities.
      for (const key of ['preload', 'preloadURL', 'session', 'additionalArguments', 'enableBlinkFeatures', 'disableBlinkFeatures']) delete preferences[key];
      Object.assign(preferences, safePreferences, { partition: params.partition });
    });
    wc.on('did-attach-webview', (_event, guest) => {
      const state = shells.get(wc.id);
      if (!state?.accountId || !Object.values(state.partitions).some(p => session.fromPartition(p) === guest.session)) {
        guest.close({ waitForBeforeUnload: false }); return;
      }
      protectGuest(guest, wc.id, state.accountId);
    });
    wc.once('destroyed', () => { destroyGuests(wc.id); shells.delete(wc.id); });
  }

  function isTrustedShellEvent(event) {
    return !!event.sender && shells.has(event.sender.id) && event.senderFrame === event.sender.mainFrame
      && trustedOrigin(event.senderFrame?.url) && trustedOrigin(event.sender.getURL());
  }
  app.on('session-created', installSession);
  app.on('web-contents-created', (_event, wc) => {
    installSession(wc.session);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  return { installSession, registerShell, setAccount, isTrustedShellEvent };
}
module.exports = { createBrowserSecurity, safeWebviewUrl };
