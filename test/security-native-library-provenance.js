'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifyNativeLibraries } = require('../scripts/verify-native-library-provenance');
const hash = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
const definitions = {
  zlib: { library: 'libz.so.1.3.1', tests: ['unmodified upstream make check (static and shared)'] },
  libsndfile: { library: 'libsndfile.so.1.0.37', tests: ['UBSan MAT4 invalid/valid', 'UBSan IMA read/close', 'upstream CTest suite', 'release MAT4 invalid/valid', 'release IMA read/close'] }
};
function fixture() {
  const image = { Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'amd64' };
  const sbom = { schema: { version: '16.1.0' }, source: { type: 'image', metadata: { imageID: image.Id } },
    distro: { id: 'debian', versionID: '13.7' }, artifacts: [{ id: 'torch', name: 'torch', type: 'python', version: '2.14.1' }] };
  const libraries = {}, policies = {};
  for (const [name, contract] of Object.entries(definitions)) {
    const directory = path.join(__dirname, '..', 'build', name);
    const lockBytes = fs.readFileSync(path.join(directory, 'source.lock.json'));
    const lock = JSON.parse(lockBytes);
    const patches = {};
    for (const patch of lock.patches) {
      patches[patch.file] = fs.readFileSync(path.join(directory, patch.file));
      if (patch.upstreamPatchFile) patches[patch.upstreamPatchFile] = fs.readFileSync(path.join(directory, patch.upstreamPatchFile));
    }
    policies[name] = { ...contract, lock, lockBytes, patches };
    const binary = Buffer.alloc(80);
    Buffer.from('7f454c46', 'hex').copy(binary); binary[4] = 2; binary[5] = 1; binary.writeUInt16LE(62, 18);
    const libraryPath = `/usr/lib/x86_64-linux-gnu/${contract.library}`;
    const manifest = { ...lock, sourceLockSha256: hash(lockBytes), architecture: 'amd64',
      library: { path: libraryPath, sha256: hash(binary) }, tests: contract.tests };
    if (lock.runtimeAbi) manifest.exportedSymbolsSha256 = lock.runtimeAbi.exportedSymbolsSha256;
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    libraries[name] = { manifestBytes, binary };
    const file = (filename, bytes) => ({ path: filename, digest: { algorithm: 'md5', value: hash(bytes, 'md5') } });
    const docPath = `/usr/share/doc/${lock.debianPackageName}`;
    const files = [file(libraryPath, binary), file(`/usr/local/share/panthorium/${name}-source.json`, manifestBytes),
      file(`${docPath}/source-provenance.json`, manifestBytes), file(`${docPath}/copyright`, Buffer.from('license'))];
    for (const [filename, bytes] of Object.entries(patches)) files.push(file(`${docPath}/patches/${path.basename(filename)}`, bytes));
    sbom.artifacts.push({ id: name, name: lock.debianPackageName, type: 'deb', version: lock.debianPackageVersion,
      purl: `pkg:deb/debian/${lock.debianPackageName}@${encodeURIComponent(lock.debianPackageVersion)}?arch=amd64&distro=debian-13.7&upstream=${encodeURIComponent(name + '@' + lock.debianPackageVersion)}`,
      metadataType: 'dpkg-db-entry', metadata: { package: lock.debianPackageName, version: lock.debianPackageVersion,
        source: name, sourceVersion: lock.debianPackageVersion, architecture: 'amd64', files } });
  }
  const enrichedSbom = structuredClone(sbom);
  enrichedSbom.artifacts.push({ id: 'ffmpeg', name: 'ffmpeg', type: 'binary', version: '8.1.2' });
  return { evidence: { sbom, enrichedSbom, image, libraries }, policies };
}
function run(change = () => {}) {
  const data = fixture(); change(data.evidence, data.policies);
  return verifyNativeLibraries(data.evidence, data.policies);
}
const initial = fixture(), unchanged = JSON.stringify(initial.evidence.sbom);
const proof = verifyNativeLibraries(initial.evidence);
assert.equal(proof.packageProofs.length, 2);
assert.equal(proof.originalPackageCount, 3);
assert.equal(proof.enrichedPackageCount, 4);
assert.equal(JSON.stringify(initial.evidence.sbom), unchanged, 'Must not mutate raw inventory');
assert.equal(proof.claims, undefined, 'Provenance must not issue vulnerability exceptions');
assert.ok(proof.limitations.some(value => value.includes('statically linked')));
assert.throws(() => run(e => { e.image.Id = `sha256:${'b'.repeat(64)}`; }), /another image/);
assert.throws(() => run(e => { e.image.Architecture = 'arm64'; }), /architecture/);
assert.throws(() => run(e => { e.enrichedSbom.artifacts.shift(); }), /removed or modified/);
assert.throws(() => run(e => { e.enrichedSbom.artifacts[0].version = '0'; }), /removed or modified/);
assert.throws(() => run(e => { e.enrichedSbom.artifacts.push(e.enrichedSbom.artifacts[0]); }), /Duplicate/);
assert.throws(() => run(e => { e.libraries.zlib.binary[40] = 1; }), /executable differs/);
assert.throws(() => run(e => { delete e.libraries.zlib; }), /Missing.*manifest/);
function updateManifest(e, change) {
  const manifest = JSON.parse(e.libraries.zlib.manifestBytes); change(manifest);
  e.libraries.zlib.manifestBytes = Buffer.from(JSON.stringify(manifest));
}
assert.throws(() => run(e => updateManifest(e, m => { m.patchedFiles[0].sha256 = '0'.repeat(64); })), /Unreviewed.*patchedFiles/);
assert.throws(() => run(e => updateManifest(e, m => { m.sourceLockSha256 = '0'.repeat(64); })), /source-lock digest/);
assert.throws(() => run(e => updateManifest(e, m => { m.tests = []; })), /required tests/);
assert.throws(() => run(e => updateManifest(e, m => { m.library.path = '/tmp/libz.so'; })), /library path/);
assert.throws(() => run((e, p) => { p.zlib.patches['patches/gzwrite-input-reset.patch'] = Buffer.from('changed'); }), /patch changed/);
function updatePackage(e, change) {
  change(e.sbom.artifacts[1]); e.enrichedSbom.artifacts[1] = structuredClone(e.sbom.artifacts[1]);
}
assert.throws(() => run(e => updatePackage(e, p => { p.version = '1.3.2'; })), /runtime package version/);
assert.throws(() => run(e => updatePackage(e, p => { p.metadata.sourceVersion = ''; })), /modified source identity/);
assert.throws(() => run(e => updatePackage(e, p => { p.purl = 'pkg:generic/zlib@1.3.2'; })), /package URL/);
assert.throws(() => run(e => updatePackage(e, p => { p.metadata.files[0].digest.value = '0'.repeat(32); })), /ownership digest/);
assert.throws(() => run(e => updatePackage(e, p => { p.metadata.files.push({ path: '/usr/lib/libz-old.so', digest: { algorithm: 'md5', value: '0'.repeat(32) } }); })), /file inventory/);
assert.throws(() => run(e => updatePackage(e, p => { p.metadata.files[1].digest.value = '0'.repeat(32); })), /manifest differs/);
console.log('Native provenance: exact source locks, patches, ELF, package ownership and unchanged image inventory verified; tampering rejected');
