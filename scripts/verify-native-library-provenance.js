#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hash = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
const jsonHash = value => hash(Buffer.from(JSON.stringify(value)));
const contracts = {
  zlib: { library: 'libz.so.1.3.1', tests: ['unmodified upstream make check (static and shared)'] },
  libsndfile: { library: 'libsndfile.so.1.0.37', tests: ['UBSan MAT4 invalid/valid', 'UBSan IMA read/close', 'upstream CTest suite', 'release MAT4 invalid/valid', 'release IMA read/close'] }
};

function loadPolicies() {
  return Object.fromEntries(Object.entries(contracts).map(([name, contract]) => {
    const directory = path.join(__dirname, '..', 'build', name);
    const lockBytes = fs.readFileSync(path.join(directory, 'source.lock.json'));
    const lock = JSON.parse(lockBytes);
    const patches = {};
    for (const patch of lock.patches) {
      patches[patch.file] = fs.readFileSync(path.join(directory, patch.file));
      if (patch.upstreamPatchFile) patches[patch.upstreamPatchFile] = fs.readFileSync(path.join(directory, patch.upstreamPatchFile));
    }
    return [name, { ...contract, lock, lockBytes, patches }];
  }));
}

// A provenance proof, never a vulnerability exception. Production CLI reads
// only committed source locks and fixed filenames; tests may pass fixtures.
function verifyNativeLibraries({ sbom, enrichedSbom, image, libraries }, policies = loadPolicies()) {
  assert.match(sbom?.schema?.version || '', /^16\./, 'Unsupported Syft schema');
  assert.equal(sbom?.source?.type, 'image', 'Complete image inventory required');
  assert.match(image?.Id || '', /^sha256:[a-f0-9]{64}$/, 'Missing image identity');
  assert.equal(sbom.source.metadata?.imageID, image.Id, 'Raw inventory describes another image');
  assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64', 'Unreviewed architecture');
  assert.equal(sbom.distro?.id, 'debian'); assert.equal(sbom.distro?.versionID, '13.7', 'Unreviewed distribution');
  assert.ok(Array.isArray(sbom.artifacts) && sbom.artifacts.length, 'No raw inventory');
  assert.deepEqual(enrichedSbom?.source, sbom.source, 'Enriched inventory source changed');
  assert.deepEqual(enrichedSbom?.distro, sbom.distro, 'Enriched inventory distribution changed');
  assert.ok(Array.isArray(enrichedSbom.artifacts), 'No enriched inventory');
  const retained = new Map();
  for (const item of enrichedSbom.artifacts) {
    assert.ok(item.id && !retained.has(item.id), 'Duplicate enriched artifact'); retained.set(item.id, item);
  }
  const originalIds = new Set();
  for (const item of sbom.artifacts) {
    assert.ok(item.id && !originalIds.has(item.id), 'Duplicate raw artifact'); originalIds.add(item.id);
    assert.deepEqual(retained.get(item.id), item, `Raw package ${item.name} was removed or modified`);
  }

  const packageProofs = [];
  for (const [name, policy] of Object.entries(policies)) {
    const { lock, lockBytes, patches } = policy;
    assert.equal(lock.schemaVersion, 1); assert.equal(lock.name, name);
    assert.deepEqual(JSON.parse(lockBytes), lock, 'Source lock bytes changed');
    const entry = libraries[name];
    assert.ok(Buffer.isBuffer(entry?.manifestBytes), `Missing ${name} source manifest`);
    const manifest = JSON.parse(entry.manifestBytes);
    for (const key of Object.keys(lock)) assert.deepEqual(manifest[key], lock[key], `Unreviewed ${name} ${key}`);
    assert.equal(manifest.sourceLockSha256, hash(lockBytes), `${name} source-lock digest mismatch`);
    assert.equal(manifest.architecture, 'amd64');
    assert.deepEqual(manifest.tests, policy.tests, `${name} required tests changed`);
    for (const archive of lock.archives) assert.match(archive.sha256, /^[a-f0-9]{64}$/);
    assert.match(lock.sourceDescriptor.sha256, /^[a-f0-9]{64}$/);
    for (const file of lock.patchedFiles) assert.match(file.sha256, /^[a-f0-9]{64}$/);
    const patchFiles = [];
    for (const patch of lock.patches) {
      assert.equal(hash(patches[patch.file]), patch.sha256, `Committed ${name} patch changed`);
      patchFiles.push(patch.file);
      if (patch.upstreamPatchFile) {
        assert.equal(hash(patches[patch.upstreamPatchFile]), patch.upstreamPatchSha256, `Upstream ${name} patch changed`);
        patchFiles.push(patch.upstreamPatchFile);
      }
    }
    const expectedPath = `/usr/lib/x86_64-linux-gnu/${policy.library}`;
    assert.equal(manifest.library?.path, expectedPath, `Unexpected ${name} library path`);
    assert.ok(Buffer.isBuffer(entry.binary) && entry.binary.length >= 64, `Missing ${name} actual ELF`);
    assert.equal(entry.binary.subarray(0, 4).toString('hex'), '7f454c46', `${name} is not ELF`);
    assert.equal(entry.binary[4], 2); assert.equal(entry.binary[5], 1);
    assert.equal(entry.binary.readUInt16LE(18), 62, `${name} is not x86-64`);
    assert.equal(hash(entry.binary), manifest.library.sha256, `${name} executable differs from source manifest`);
    if (lock.runtimeAbi) assert.equal(manifest.exportedSymbolsSha256, lock.runtimeAbi.exportedSymbolsSha256);

    const candidates = sbom.artifacts.filter(item => item.name === lock.debianPackageName && item.type === 'deb');
    assert.equal(candidates.length, 1, `Expected exactly one ${name} runtime package`);
    const item = candidates[0];
    assert.equal(item.version, lock.debianPackageVersion, `Wrong ${name} runtime package version`);
    assert.equal(item.metadataType, 'dpkg-db-entry');
    assert.equal(item.metadata?.package, lock.debianPackageName);
    assert.equal(item.metadata?.version, lock.debianPackageVersion);
    assert.equal(item.metadata?.source, name);
    assert.equal(item.metadata?.sourceVersion, lock.debianPackageVersion, `Wrong ${name} modified source identity`);
    assert.equal(item.metadata?.architecture, 'amd64');
    const purl = `pkg:deb/debian/${lock.debianPackageName}@${encodeURIComponent(lock.debianPackageVersion)}?arch=amd64&distro=debian-13.7&upstream=${encodeURIComponent(name + '@' + lock.debianPackageVersion)}`;
    assert.equal(item.purl, purl, `Wrong ${name} package URL`);
    assert.ok(Array.isArray(item.metadata.files), `Missing ${name} file inventory`);
    const files = new Map();
    for (const file of item.metadata.files) {
      assert.ok(!files.has(file.path), `Duplicate ${name} owned file`); files.set(file.path, file.digest);
      assert.equal(file.digest?.algorithm, 'md5'); assert.match(file.digest.value, /^[a-f0-9]{32}$/);
    }
    const docPath = `/usr/share/doc/${lock.debianPackageName}`;
    const manifestPath = `/usr/local/share/panthorium/${name}-source.json`;
    const expectedFiles = [expectedPath, manifestPath, `${docPath}/source-provenance.json`, `${docPath}/copyright`,
      ...patchFiles.map(filename => `${docPath}/patches/${path.basename(filename)}`)].sort();
    assert.deepEqual([...files.keys()].sort(), expectedFiles, `Unreviewed ${name} owned file inventory`);
    assert.equal(files.get(expectedPath).value, hash(entry.binary, 'md5'), `${name} ELF differs from package ownership digest`);
    for (const filename of [manifestPath, `${docPath}/source-provenance.json`]) {
      assert.equal(files.get(filename).value, hash(entry.manifestBytes, 'md5'), `${name} manifest differs from package ownership digest`);
    }
    for (const filename of patchFiles) {
      assert.equal(files.get(`${docPath}/patches/${path.basename(filename)}`).value, hash(patches[filename], 'md5'), `${name} packaged patch changed`);
    }
    packageProofs.push({ name, packageId: item.id, purl: item.purl, packageVersion: item.version,
      sourceLockSha256: hash(lockBytes), manifestSha256: hash(entry.manifestBytes),
      library: { path: expectedPath, sha256: hash(entry.binary) },
      source: { baseline: lock.debianSourceVersion, archives: lock.archives, patchedFiles: lock.patchedFiles },
      patches: lock.patches, tests: manifest.tests });
  }
  return { schemaVersion: 1, imageId: image.Id, rawSbomSha256: jsonHash(sbom), enrichedSbomSha256: jsonHash(enrichedSbom),
    originalPackageCount: sbom.artifacts.length, enrichedPackageCount: enrichedSbom.artifacts.length,
    packageProofs, limitations: ['Build provenance and package identity proof only; does not suppress scanner findings.',
      'Does not assess bundled or statically linked copies in other packages.'] };
}

if (require.main === module) {
  const [directory, ...extra] = process.argv.slice(2);
  assert.ok(directory && !extra.length, 'Usage: verify-native-library-provenance.js EVIDENCE_DIR');
  const read = name => fs.readFileSync(path.join(directory, name));
  const images = JSON.parse(read('image-inspect.json'));
  assert.ok(Array.isArray(images) && images.length === 1, 'Expected one inspected image');
  const libraries = {};
  for (const [name, contract] of Object.entries(contracts)) {
    libraries[name] = { manifestBytes: read(name + '-source.json'), binary: read(contract.library) };
  }
  const proof = verifyNativeLibraries({ image: images[0], libraries,
    sbom: JSON.parse(read('container-sbom.raw.syft.json')), enrichedSbom: JSON.parse(read('container-sbom.syft.json')) });
  fs.writeFileSync(path.join(directory, 'native-library-provenance.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(`Verified ${proof.packageProofs.length} native packages; preserved all ${proof.originalPackageCount} raw inventory packages`);
}
module.exports = { verifyNativeLibraries };
