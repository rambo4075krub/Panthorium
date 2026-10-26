'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { signManifest } = require('../electron/update-signature.cjs');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-update-cache-'));
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const trust = { version: 1, keys: { test: publicKey.export({ type: 'spki', format: 'pem' }) } };
    const binary = Buffer.from('verified fixture');
    const asset = { name: 'fixture.exe', url: 'https://github.com/rambo4075krub/Panthorium/releases/download/staging/fixture.exe', size: binary.length, sha256: crypto.createHash('sha256').update(binary).digest('hex') };
    const manifest = signManifest({ edition: 'user', version: '15.1.1', assets: { windows: asset } }, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'test', trust);
    let downloads = 0, dialogs = 0;
    const electron = {
      app: { isPackaged: true, getVersion: () => '15.0.11', getPath: () => directory, setPath() {}, whenReady: () => ({ then() {} }), on() {} },
      dialog: { async showMessageBox() { dialogs++; return { response: 1 }; } },
      net: { async fetch(url) { if (url.endsWith('.exe')) { downloads++; return new Response(binary); } return Response.json(manifest); } }
    };
    const realRequire = createRequire(path.resolve('electron/main.cjs'));
    const context = vm.createContext({ require: name => name === 'electron' ? electron : name === './update-trust.json' ? trust : name === 'child_process' ? { spawn() { throw Error('Deferred updates must never execute an installer'); } } : realRequire(name), process: { platform: 'win32', env: {} }, console, URL, Buffer, setTimeout, clearTimeout, setInterval });
    vm.runInContext(fs.readFileSync('electron/main.cjs', 'utf8'), context);
    assert((await vm.runInContext('checkForUpdates({manual:false})', context)).deferred);
    await vm.runInContext('checkForUpdates({manual:false})', context);
    assert.equal(downloads, 1); assert.equal(dialogs, 1, 'automatic polling respects a postponed version');
    await vm.runInContext('checkForUpdates({manual:true})', context);
    assert.equal(downloads, 1, 'a manual retry reuses verified bytes'); assert.equal(dialogs, 2);
    fs.writeFileSync(path.join(directory, 'updates', 'fixture.exe'), Buffer.alloc(binary.length));
    await vm.runInContext('checkForUpdates({manual:true})', context);
    assert.equal(downloads, 2, 'tampered cached bytes are never trusted');
    console.log('Native updater: one prompt per postponed version, verified cache reuse, tampered-cache replacement and no deferred installer execution passed.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
