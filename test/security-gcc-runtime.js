'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyGccRuntime } = require('../scripts/verified-gcc-runtime');
const hash = (value, algorithm = 'sha256') => crypto.createHash(algorithm).update(value).digest('hex');
const jsonHash = value => hash(Buffer.from(JSON.stringify(value)));

// Synthetic policy makes the test hermetic; the production CLI cannot select
// this policy and requires the separately reviewed real executable digests.
const bytes = Buffer.alloc(64);
Buffer.from('7f454c46', 'hex').copy(bytes); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(62, 18);
const libraryPath = '/usr/lib/x86_64-linux-gnu/libstdc++.so.6.0.33';
const files = [[libraryPath, 'md5', hash(bytes, 'md5')]];
const purl = 'pkg:deb/debian/libstdc%2B%2B6@14.2.0-19?arch=amd64&distro=debian-13.7&upstream=gcc-14';
const policy = { schemaVersion: 1, os: 'linux', architecture: 'amd64', distro: 'debian', distroVersion: '13.7',
  packageVersion: '14.2.0-19', references: { 'CVE-2026-95619': 'https://example.invalid/review-1', 'CVE-2026-102010': 'https://example.invalid/review-2' },
  packages: { 'libstdc++6': { purl, fileCount: 1, fileManifestSha256: jsonHash(files),
    binary: { name: 'libstdc++.so.6.0.33', path: libraryPath, sha256: hash(bytes), md5: hash(bytes, 'md5') } } } };
const image = { Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'amd64' };
const artifact = { id: 'libstdcxx', name: 'libstdc++6', type: 'deb', version: '14.2.0-19', purl,
  metadata: { architecture: 'amd64', files: [{ path: libraryPath, digest: { algorithm: 'md5', value: hash(bytes, 'md5') } }] } };
const sbom = { schema: { version: '16.1.0' }, distro: { id: 'debian', versionID: '13.7' },
  source: { type: 'image', metadata: { imageID: image.Id } }, artifacts: [artifact, { name: 'torch', type: 'python', version: '2.14.1' }] };
const evidence = { sbom, image, binaries: { 'libstdc++.so.6.0.33': bytes } };
const before = JSON.stringify(sbom);
const proof = verifyGccRuntime(evidence, policy);
assert.equal(JSON.stringify(sbom), before, 'Verification must not modify or filter the complete SBOM');
assert.equal(proof.claims.length, 2);
assert.ok(proof.claims.every(claim => claim.packagePurl === purl && claim.scope === 'reviewed distro package only'));
assert.ok(proof.limitations.some(text => text.includes('third-party wheels')));
assert.throws(() => verifyGccRuntime({ ...evidence, binaries: {} }, policy), /actual executable bytes/);
const changedBinary = Buffer.from(bytes); changedBinary[40] = 1;
assert.throws(() => verifyGccRuntime({ ...evidence, binaries: { 'libstdc++.so.6.0.33': changedBinary } }, policy), /Unreviewed.*executable/);
assert.throws(() => verifyGccRuntime({ ...evidence, image: { ...image, Id: `sha256:${'b'.repeat(64)}` } }, policy), /another image/);
assert.throws(() => verifyGccRuntime({ ...evidence, image: { ...image, Architecture: 'arm64' } }, policy), /architecture/);
function altered(change) { const clone = structuredClone(sbom); change(clone); return { ...evidence, sbom: clone }; }
assert.throws(() => verifyGccRuntime(altered(s => { s.artifacts[0].version = '14.2.0-20'; }), policy), /version/);
assert.throws(() => verifyGccRuntime(altered(s => { s.artifacts[0].metadata.files[0].digest.value = '0'.repeat(32); }), policy), /file inventory/);
assert.throws(() => verifyGccRuntime(altered(s => { s.artifacts[0].metadata.files.push({ path: '/usr/include/ext/pb_ds/erase_fn_imps.hpp' }); }), policy), /file count/);
assert.throws(() => verifyGccRuntime(altered(s => { s.artifacts.push(structuredClone(s.artifacts[0])); }), policy), /exactly one/);
assert.throws(() => verifyGccRuntime(altered(s => { s.distro.versionID = '13.8'; }), policy), /distribution version/);
assert.throws(() => verifyGccRuntime(altered(s => { s.source.type = 'directory'; }), policy), /Complete image/);
console.log('GCC package applicability proof: image, executable and package-file tampering rejected; inventory and wheel scope preserved');
