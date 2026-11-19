'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const { verifyOpenSsl } = require('../../scripts/verified-openssl-backport');
module.exports = function opensslFixture(image) {
  const directory = path.join(__dirname, '../../build/alpine-security/openssl');
  const lock = require(path.join(directory, 'openssl-source.lock.json'));
  const binaries = Object.fromEntries(['libcrypto.so.3', 'libssl.so.3'].map(name => [name, Buffer.from(`\x7fELFfixture-${name}`)]));
  const policy = structuredClone(require(path.join(directory, 'backport-policy.json')));
  policy.binaries = Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, hash(bytes)]));
  const manifest = { ...structuredClone(lock), binaries: Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, { path: `/usr/lib/${name}`, sha256: hash(bytes) }])) };
  const testLogs = {
    'openssl-tests.log': Buffer.from('All tests successful.\nResult: PASS\n'),
    'openssl-security-tests.log': Buffer.from('PASS: empty AAD retains authentication, context reuse clears stale AAD, invalid nonce lengths rejected\n')
  };
  manifest.runtimeVersion = 'OpenSSL 3.5.9 29 Sep 2026';
  manifest.testLogs = Object.fromEntries(Object.entries(testLogs).map(([name, bytes]) => [name, hash(bytes)]));
  const rawSbom = {
    schema: { version: '16.1.11' }, source: { id: 'image', type: 'image', metadata: { imageID: image.Id } },
    distro: { id: 'alpine', versionID: '3.24.4' },
    artifacts: [['libcrypto3','libcrypto.so.3'],['libssl3','libssl.so.3']].map(([name,library]) => ({
      id: name, name, version: lock.packageVersion, type: 'apk', purl: `pkg:apk/alpine/${name}@${lock.packageVersion}?arch=x86_64&distro=alpine-3.24.4&upstream=openssl`,
      metadata: { architecture: 'x86_64', originPackage: 'openssl', version: lock.packageVersion,
        files: [{ path: `/usr/lib/${library}`, digest: { algorithm: "'Q1'+base64(sha1)", value: 'Q1' + crypto.createHash('sha1').update(binaries[library]).digest('base64') } }] }
    }))
  };
  const input = { image, lock, binaries, manifest, rawSbom, testLogs,
    patches: Object.fromEntries([lock.distributionPatch, ...lock.patches].map(patch => [patch.file, fs.readFileSync(path.join(directory, patch.file))])) };
  return { input, policy, result: verifyOpenSsl(input, policy) };
};
