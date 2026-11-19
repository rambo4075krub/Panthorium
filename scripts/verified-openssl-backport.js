'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const reviewedPolicy = require('../build/alpine-security/openssl/backport-policy.json');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const jsonHash = value => sha256(Buffer.from(JSON.stringify(value)));
const directory = path.join(__dirname, '../build/alpine-security/openssl');

// Preserve the complete APK inventory. Qualifiers identify the exact repaired
// library and image; versions, CPEs, ownership, metadata and packages stay intact.
function verifyOpenSsl({ rawSbom, manifest, lock, binaries, image, patches }, policy = reviewedPolicy) {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'amd64');
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
  assert.match(rawSbom.schema?.version || '', /^16\./);
  assert.equal(rawSbom.source?.type, 'image');
  assert.equal(rawSbom.source.metadata?.imageID, image.Id);
  assert.equal(rawSbom.distro?.id, 'alpine');
  assert.equal(jsonHash(lock), policy.sourceLockSha256, 'OpenSSL source lock requires independent review');
  assert.equal(lock.version, '3.5.9');
  assert.equal(lock.packageVersion, '3.5.9-r1');
  for (const key of Object.keys(lock)) assert.deepEqual(manifest[key], lock[key], `Unreviewed OpenSSL ${key}`);
  for (const patch of [lock.distributionPatch, ...lock.patches]) {
    assert.equal(sha256(patches[patch.file]), patch.sha256, 'OpenSSL patch bytes differ');
  }
  const result = structuredClone(rawSbom);
  const verified = [];
  const vulnerabilities = [...new Set(lock.patches.flatMap(patch => patch.cves))].sort();
  assert.deepEqual(vulnerabilities, policy.vulnerabilities, 'Unreviewed OpenSSL vulnerability set');
  for (const [name, library] of [['libcrypto3', 'libcrypto.so.3'], ['libssl3', 'libssl.so.3']]) {
    const bytes = binaries[library];
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 4);
    assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46');
    const digest = sha256(bytes);
    assert.equal(digest, policy.binaries[library], 'OpenSSL library is not an independently reviewed executable');
    assert.deepEqual(manifest.binaries[library], { path: `/usr/lib/${library}`, sha256: digest });
    const packages = result.artifacts.filter(item => item.name === name);
    assert.equal(packages.length, 1, 'Expected exactly one installed OpenSSL APK');
    const artifact = packages[0];
    assert.equal(artifact.type, 'apk');
    assert.equal(artifact.version, lock.packageVersion, 'Installed OpenSSL package was not rebuilt');
    assert.equal(artifact.metadata?.architecture, 'x86_64');
    assert.equal(artifact.metadata?.originPackage, 'openssl');
    assert.equal(artifact.metadata?.version, lock.packageVersion);
    const owned = artifact.metadata?.files?.find(file => file.path === `/usr/lib/${library}`);
    assert.ok(owned, 'APK does not own the reviewed library');
    assert.equal(owned.digest?.algorithm, "'Q1'+base64(sha1)", 'Unreviewed APK file checksum format');
    assert.equal(owned.digest.value, 'Q1' + crypto.createHash('sha1').update(bytes).digest('base64'), 'Installed library differs from APK inventory checksum');
    assert.ok(artifact.purl.startsWith(`pkg:apk/alpine/${name}@${lock.packageVersion}?`));
    assert.ok(!/[?&](?:checksum|image_id)=/.test(artifact.purl), 'OpenSSL artifact was already qualified');
    const originalPurl = artifact.purl;
    const [base, query] = artifact.purl.split('?');
    const qualifiers = new URLSearchParams(query);
    qualifiers.set('checksum', `sha256:${digest}`);
    qualifiers.set('image_id', image.Id);
    qualifiers.sort();
    artifact.purl = `${base}?${qualifiers}`;
    verified.push({ name, version: artifact.version, library, sha256: digest, originalPurl, artifactPurl: artifact.purl });
  }
  return {
    sbom: result,
    proof: { schemaVersion: 1, imageId: image.Id, sourceLockSha256: jsonHash(lock), policySha256: jsonHash(policy),
      rawSbomSha256: jsonHash(rawSbom), sbomSha256: jsonHash(result), vulnerabilities, packages: verified,
      evidenceRun: policy.evidenceRun },
    statements: vulnerabilities.flatMap(cve => verified.map(artifact => ({
      vulnerability: { '@id': `https://nvd.nist.gov/vuln/detail/${cve}`, name: cve },
      products: [{ '@id': artifact.artifactPurl }], status: 'fixed',
      status_notes: 'Official OpenSSL 3.5 branch backport; pinned source and patch checksums, full upstream tests, independently reviewed ELF and exact installed APK/image verified.'
    })))
  };
}

function loadOpenSslEvidence(evidenceDirectory, image) {
  const read = name => JSON.parse(fs.readFileSync(path.join(evidenceDirectory, name), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'openssl-source.lock.json'), 'utf8'));
  return {
    rawSbom: read('container-sbom.raw.syft.json'), manifest: read('openssl-source.json'), lock, image,
    binaries: Object.fromEntries(['libcrypto.so.3', 'libssl.so.3'].map(name => [name, fs.readFileSync(path.join(evidenceDirectory, name))])),
    patches: Object.fromEntries([lock.distributionPatch, ...lock.patches].map(patch => [patch.file, fs.readFileSync(path.join(directory, patch.file))]))
  };
}
if (require.main === module) {
  const [evidenceDirectory, ...extra] = process.argv.slice(2);
  assert.ok(evidenceDirectory && !extra.length, 'Usage: verified-openssl-backport.js EVIDENCE_DIR');
  const images = JSON.parse(fs.readFileSync(path.join(evidenceDirectory, 'image-inspect.json'), 'utf8'));
  assert.equal(images.length, 1);
  const result = verifyOpenSsl(loadOpenSslEvidence(evidenceDirectory, images[0]));
  for (const [filename, value] of [['container-sbom.with-openssl.syft.json', result.sbom], ['openssl-proof.json', result.proof]]) {
    fs.writeFileSync(path.join(evidenceDirectory, filename), JSON.stringify(value, null, 2) + '\n');
  }
  console.log('Verified both repaired OpenSSL APK libraries without removing any inventory entry');
}
module.exports = { verifyOpenSsl, loadOpenSslEvidence };
