'use strict';

// Run with: npx --no-install electron test/electron-native-security.js
// This starts the real main/preload in Electron, without an API server, account,
// signing credential, permission mocks, or an automatic media approval flag.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');

if (process.argv.includes('--verify-package')) {
  const asar = require('@electron/asar');
  const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(metadata.main, 'electron/main.cjs');
  for (const file of ['main.cjs', 'preload.cjs', 'browser-security.cjs', 'update-signature.cjs', 'update-download.cjs', 'update-trust.json']) {
    assert.deepEqual(asar.extractFile(archive, 'electron/' + file), fs.readFileSync(path.join(root, 'electron', file)),
      'The unpacked application must contain the reviewed ' + file);
  }
  console.log('Native package: main, preload, security policy, update verifier and trust store match source');
} else {
  assert(process.versions.electron, 'Run this integration test with the installed Electron executable');
  assert.equal(process.versions.electron, require('../package.json').devDependencies.electron);
  const { app, BrowserWindow, session } = require('electron');
  for (const flag of ['no-sandbox', 'disable-web-security', 'ignore-certificate-errors', 'use-fake-ui-for-media-stream', 'auto-select-desktop-capture-source']) {
    assert(!app.commandLine.hasSwitch(flag), 'The native smoke must not bypass security using --' + flag);
  }
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-native-security-'));
  app.setPath('appData', temporary);
  process.env.PANTHORIUM_URL = 'https://shell.panthorium.test/';
  const shellOrigin = new URL(process.env.PANTHORIUM_URL).origin;
  const guestOrigin = 'https://guest.panthorium.test';
  const preload = path.join(root, 'electron/preload.cjs');
  let stopping = false;
  const watchdog = setTimeout(() => fail(new Error('Native security smoke exceeded 90 seconds')), 90000);

  function finish(code) {
    if (stopping) return;
    stopping = true;
    clearTimeout(watchdog);
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    // Windows may retain Chromium file handles until process exit. The profile
    // is in the runner's temporary directory; best-effort removal is sufficient.
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {}
    app.exit(code);
  }
  function fail(error) {
    console.error(error && error.stack || error);
    finish(1);
  }
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_e, file, error) => fail(new Error('Preload failed: ' + file + ': ' + error.message)));
    contents.on('render-process-gone', (_e, details) => {
      if (!stopping && !['clean-exit', 'killed'].includes(details.reason)) fail(new Error('Renderer exited: ' + details.reason));
    });
  });

  // Intercept built-in HTTPS in every actual Session. Chromium still applies
  // secure-context, origin, permissions and sandbox rules. No DNS, certificates,
  // production endpoint, or web-security bypass is involved.
  app.on('session-created', ses => {
    ses.protocol.handle('https', request => {
      const url = new URL(request.url);
      assert([shellOrigin, guestOrigin].includes(url.origin), 'Unexpected network destination: ' + url.origin);
      return new Response('<!doctype html><html><head><title>Native security fixture</title></head><body><h1>Fixture</h1></body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    });
    ses.protocol.handle('http', () => Response.error());
  });

  function event(emitter, name, predicate = () => true) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { emitter.removeListener(name, listener); reject(new Error('Timed out waiting for ' + name)); }, 10000);
      function listener(...args) {
        if (!predicate(...args)) return;
        clearTimeout(timer);
        emitter.removeListener(name, listener);
        resolve(args);
      }
      emitter.on(name, listener);
    });
  }
  async function loaded(contents, url) {
    const deadline = Date.now() + 10000;
    while (contents.getURL() !== url || contents.isLoadingMainFrame()) {
      assert(Date.now() < deadline, 'Timed out loading ' + url);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  async function evaluate(contents, fn, ...args) {
    return contents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', true);
  }
  async function focus(win) {
    win.show(); win.focus();
    const deadline = Date.now() + 10000;
    while (!await evaluate(win.webContents, () => document.hasFocus())) {
      assert(Date.now() < deadline, 'Screen-capture test requires a focused document');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  async function microphone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const kinds = stream.getTracks().map(track => track.kind);
      stream.getTracks().forEach(track => track.stop());
      return { ok: true, kinds };
    } catch (error) { return { ok: false, name: error.name, message: error.message }; }
  }
  async function screenCapture() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      return { ok: true };
    } catch (error) { return { ok: false, name: error.name, message: error.message }; }
  }
  async function deniedMicrophone(contents, label) {
    const result = await evaluate(contents, microphone);
    assert.equal(result.ok, false, label + ' must not get microphone access');
    assert.equal(result.name, 'NotAllowedError', label + ': ' + JSON.stringify(result));
  }
  async function isolated(contents, bridgeExpected) {
    const state = await evaluate(contents, () => ({
      require: typeof require, process: typeof process,
      bridge: typeof window.panthoriumDesktop, secure: window.isSecureContext
    }));
    assert.deepEqual(state, { require: 'undefined', process: 'undefined', bridge: bridgeExpected ? 'object' : 'undefined', secure: true });
    const preferences = contents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
  }
  async function account(shell, id) {
    const result = await evaluate(shell.webContents, id => window.panthoriumDesktop.setBrowserAccount(id), id);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.partitions;
  }
  let viewNumber = 0;
  function insertWebview(shell, partition, url, malicious = false) {
    return evaluate(shell.webContents, (id, partition, url, preloadUrl, malicious) => {
      const view = document.createElement('webview');
      view.id = id;
      view.setAttribute('partition', partition);
      view.setAttribute('allowpopups', '');
      if (malicious) {
        view.setAttribute('preload', preloadUrl);
        view.setAttribute('nodeintegration', '');
        view.setAttribute('disablewebsecurity', '');
        view.setAttribute('webpreferences', 'sandbox=no,contextIsolation=no,nodeIntegrationInWorker=yes,nodeIntegrationInSubFrames=yes,webviewTag=yes');
      }
      view.src = url;
      document.body.append(view);
    }, 'guest-' + (++viewNumber), partition, url, pathToFileURL(preload).href, malicious);
  }
  async function guest(shell, partition, malicious = false) {
    const attached = event(shell.webContents, 'did-attach-webview');
    await insertWebview(shell, partition, guestOrigin + '/', malicious);
    const [, contents] = await attached;
    await loaded(contents, guestOrigin + '/');
    return contents;
  }
  async function rejectedGuest(shell, partition, url) {
    // This listener runs after the real main-process guard, and sees the real
    // native event. It does not replace or invoke the policy directly.
    const attaching = event(shell.webContents, 'will-attach-webview');
    await insertWebview(shell, partition, url);
    const [nativeEvent] = await attaching;
    assert.equal(nativeEvent.defaultPrevented, true, 'Unsafe guest must be rejected before creation');
  }

  const created = event(app, 'browser-window-created');
  require('../electron/main.cjs');
  (async () => {
    await app.whenReady();
    const [, shell] = await created;
    await loaded(shell.webContents, process.env.PANTHORIUM_URL);
    await isolated(shell.webContents, true);
    const bridge = await evaluate(shell.webContents, async () => ({
      version: window.panthoriumDesktop.bridgeVersion,
      info: await window.panthoriumDesktop.getAppInfo()
    }));
    assert.equal(bridge.version, '7');
    assert.equal(bridge.info.packaged, false);
    assert.equal(bridge.info.platform, process.platform);
    const mic = await evaluate(shell.webContents, microphone);
    assert.equal(mic.ok, true, 'Trusted shell fake microphone baseline: ' + JSON.stringify(mic));
    assert.deepEqual(mic.kinds, ['audio']);
    console.log('PASS real main/preload bridge, renderer sandbox and trusted-shell microphone');

    for (const origin of [shellOrigin, guestOrigin]) {
      await evaluate(shell.webContents, origin => new Promise(resolve => {
        const frame = document.createElement('iframe');
        frame.allow = 'microphone; camera';
        frame.onload = () => resolve(true);
        frame.src = origin + '/frame';
        document.body.append(frame);
      }), origin);
      const frame = shell.webContents.mainFrame.frames.find(frame => frame.url === origin + '/frame');
      assert(frame, 'Actual iframe should exist');
      await deniedMicrophone(frame, origin + ' iframe');
    }
    const unregistered = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload } });
    await unregistered.loadURL(shellOrigin + '/unregistered');
    await deniedMicrophone(unregistered.webContents, 'Unregistered default-session window');
    const badAccount = await evaluate(unregistered.webContents, () => window.panthoriumDesktop.setBrowserAccount('attacker'));
    assert.equal(badAccount.error, 'untrusted_origin');
    unregistered.destroy();

    const otherSession = session.fromPartition('native-security-unregistered');
    const other = new BrowserWindow({ show: false, webPreferences: { session: otherSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await other.loadURL(shellOrigin + '/other-session');
    await deniedMicrophone(other.webContents, 'Unregistered non-default-session window');
    console.log('PASS same-origin/cross-origin iframe, unregistered window and new-session permission denial');

    await focus(shell);
    const screen = await evaluate(shell.webContents, screenCapture);
    assert.equal(screen.ok, false);
    assert.equal(screen.name, 'NotAllowedError', 'Production screen permission denial: ' + JSON.stringify(screen));
    // Adapter-only probe: allow the permission gate in this disposable session
    // to reach the production display handler installed by main. The production
    // callback(null) must reject cleanly; callback({}) throws in Electron 44.
    otherSession.setPermissionCheckHandler((_wc, permission) => ['media', 'display-capture'].includes(permission));
    otherSession.setPermissionRequestHandler((_wc, permission, callback) => callback(['media', 'display-capture'].includes(permission)));
    await focus(other);
    const display = await evaluate(other.webContents, screenCapture);
    assert.equal(display.ok, false);
    assert.equal(display.name, 'AbortError', 'Native display-handler clean denial: ' + JSON.stringify(display));
    other.destroy();
    console.log('PASS screen-capture policy denial and native display-handler clean cancellation');

    const a = await account(shell, 'native-account-A');
    const first = await guest(shell, a.external, true);
    await isolated(first, false);
    const preferences = first.getLastWebPreferences();
    assert(!preferences.preload, 'Untrusted guest preload must be removed');
    assert.equal(preferences.nodeIntegrationInWorker, false);
    assert.equal(preferences.nodeIntegrationInSubFrames, false);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.webviewTag, false);
    await deniedMicrophone(first, 'Guest webview');
    await evaluate(first, () => { document.cookie = 'account_marker=A; Path=/; Secure; SameSite=Lax'; });
    assert.match(await evaluate(first, () => document.cookie), /account_marker=A/);
    await rejectedGuest(shell, 'persist:foreign-account', guestOrigin + '/');
    await rejectedGuest(shell, a.external, 'file:///not-a-permitted-document');

    const popupCreated = event(first, 'did-create-window');
    await evaluate(first, url => { window.open(url); }, guestOrigin + '/popup');
    const [popup] = await popupCreated;
    await loaded(popup.webContents, guestOrigin + '/popup');
    await isolated(popup.webContents, false);
    assert.equal(popup.webContents.session, first.session);
    assert.match(await evaluate(popup.webContents, () => document.cookie), /account_marker=A/);
    await deniedMicrophone(popup.webContents, 'Guest popup');

    const guestClosed = event(first, 'destroyed'), popupClosed = event(popup.webContents, 'destroyed');
    const b = await account(shell, 'native-account-B');
    await Promise.all([guestClosed, popupClosed]);
    assert.notEqual(a.external, b.external);
    await rejectedGuest(shell, a.external, guestOrigin + '/');
    const second = await guest(shell, b.external);
    assert.doesNotMatch(await evaluate(second, () => document.cookie), /account_marker=A/);
    const secondClosed = event(second, 'destroyed');
    const restored = await account(shell, 'native-account-A');
    await secondClosed;
    assert.equal(restored.external, a.external);
    const again = await guest(shell, restored.external);
    assert.match(await evaluate(again, () => document.cookie), /account_marker=A/);
    const againClosed = event(again, 'destroyed');
    assert.deepEqual(await account(shell, ''), {});
    await againClosed;
    console.log('PASS native webview sanitization, guest/popup denial, account teardown and A/B/A cookie isolation');
    console.log('PASS Electron ' + process.versions.electron + ' native security smoke');
    finish(0);
  })().catch(fail);
}
