const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');

(async () => {
  for (const edition of ['admin', 'user']) for (const platform of ['win32', 'darwin', 'linux']) {
    const handlers = new Map(), requests = [];
    let dialogs = 0, remote = '15.0.5', fail = false;
    const origin = 'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app';
    const electron = {
      app: { isPackaged: true, getVersion: () => '15.0.4', getPath: () => '/tmp', setPath() {}, whenReady: () => ({ then() {} }), on() {} },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { async showMessageBox() { dialogs++; return { response: 1 }; } },
      net: { async fetch(url) {
        requests.push(url);
        assert(url.endsWith(`Panthorium-Browser-${edition}-update.json`), 'quiet check must not download a binary');
        if (fail) return { ok: false, status: 503 };
        const asset = { name: 'installer', sha256: 'a'.repeat(64), url: 'https://github.com/rambo4075krub/Panthorium/releases/download/staging/installer' };
        return { ok: true, json: async () => ({ edition, version: remote, assets: { windows: asset, macos: asset, linux: asset } }) };
      } }
    };
    const context = vm.createContext({ require: name => name === 'electron' ? electron : name === '../package.json' ? { panthoriumEdition: edition } : require(name), process: { platform, env: {} }, console: { warn() {} }, URL, Buffer, setTimeout, clearTimeout, setInterval });
    vm.runInContext(source, context);
    vm.runInContext('installVoiceBridge()', context);
    const check = handlers.get('panthorium:update-status');
    const event = { senderFrame: { url: origin + '/' } };
    assert.equal((await check(event)).available, true);
    remote = '15.0.4';
    assert.equal((await check(event)).upToDate, true);
    remote = '15.0.3';
    assert.equal((await check(event)).available, false);
    fail = true;
    assert.equal((await check(event)).ok, false);
    assert.equal(dialogs, 0);
    const count = requests.length;
    assert.equal((await check({ senderFrame: { url: 'https://www.youtube.com/' } })).error, 'untrusted_origin');
    assert.equal((await handlers.get('panthorium:check-updates')({ senderFrame: { url: 'https://www.youtube.com/' } })).error, 'untrusted_origin');
    assert.equal(requests.length, count);
  }
  console.log('Update status: both editions on Windows/macOS/Linux; no installer/dialog on status checks; current/new/error and untrusted origins');
})().catch(error => { console.error(error); process.exitCode = 1; });
