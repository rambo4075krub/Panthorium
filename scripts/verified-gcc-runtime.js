#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const reviewedPolicy = require('../build/security/gcc-runtime-policy.json');
const digest = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
const jsonHash = value => digest(Buffer.from(JSON.stringify(value)));
const vulnerabilities = ['CVE-2026-95619', 'CVE-2026-102010'];

// This records narrowly reviewed distro-package applicability. It does not
// remove scanner findings, generate VEX, or assess compiled copies in wheels.
// Only hermetic unit tests can pass a policy argument; CLI policy is committed.
function verifyGccRuntime({ sbom, image, binaries }, policy = reviewedPolicy) {
  assert.equal(policy.schemaVersion, 1);
  assert.match(sbom?.schema?.version || '', /^16\./, 'Unsupported Syft schema');
  assert.equal(sbom.source?.type, 'image', 'Complete image inventory required');
  assert.match(image?.Id || '', /^sha256:[a-f0-9]{64}$/, 'Missing image identity');
  assert.equal(sbom.source.metadata?.imageID, image.Id, 'Inventory describes another image');
  assert.equal(image.Os, policy.os, 'Unreviewed operating system');
  assert.equal(image.Architecture, policy.architecture, 'Unreviewed architecture');
  assert.equal(sbom.distro?.id, policy.distro, 'Unreviewed distribution');
  assert.equal(sbom.distro?.versionID, policy.distroVersion, 'Unreviewed distribution version');
  assert.ok(Array.isArray(sbom.artifacts) && sbom.artifacts.length, 'No inventoried packages');
  const packageProofs = [], claims = [];
  for (const [name, expected] of Object.entries(policy.packages)) {
    const candidates = sbom.artifacts.filter(item => item.name === name && item.type === 'deb');
    assert.equal(candidates.length, 1, `Expected exactly one ${name} package`);
    const item = candidates[0];
    assert.equal(item.version, policy.packageVersion, `Unreviewed ${name} version`);
    assert.equal(item.purl, expected.purl, `Unreviewed ${name} package identity`);
    assert.equal(item.metadata?.architecture, 'amd64', `Unreviewed ${name} package architecture`);
    assert.ok(Array.isArray(item.metadata.files), `Missing ${name} file inventory`);
    const files = item.metadata.files.map(file => [file.path, file.digest?.algorithm, file.digest?.value])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    assert.equal(new Set(files.map(file => file[0])).size, files.length, `Duplicate ${name} file paths`);
    assert.equal(files.length, expected.fileCount, `Unreviewed ${name} file count`);
    assert.equal(jsonHash(files), expected.fileManifestSha256, `Unreviewed ${name} file inventory`);
    assert.ok(!files.some(file => /(?:^|\/)pb_ds(?:\/|$)|erase_fn_imps\.hpp/.test(file[0])), 'PBDS implementation is present');
    const proof = { id: item.id, purl: item.purl, name, version: item.version,
      fileManifestSha256: jsonHash(files), binaries: [] };
    if (expected.binary) {
      const binary = expected.binary, bytes = binaries[binary.name];
      assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 64, `Missing ${name} actual executable bytes`);
      assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46', `${name} is not ELF`);
      assert.equal(bytes[4], 2, `${name} is not ELF64`);
      assert.equal(bytes[5], 1, `${name} is not little-endian`);
      assert.equal(bytes.readUInt16LE(18), 62, `${name} is not x86-64`);
      assert.equal(digest(bytes), binary.sha256, `Unreviewed ${name} executable`);
      assert.equal(digest(bytes, 'md5'), binary.md5, `${name} differs from distro inventory`);
      assert.ok(files.some(file => file[0] === binary.path && file[1] === 'md5' && file[2] === binary.md5),
        `${name} executable not owned by reviewed package`);
      proof.binaries.push({ path: binary.path, sha256: binary.sha256 });
    } else {
      assert.ok(files.every(file => file[0].startsWith('/usr/share/doc/')), 'Expected documentation-only package');
    }
    packageProofs.push(proof);
    for (const vulnerability of vulnerabilities) claims.push({
      vulnerability, packagePurl: item.purl, packageName: name,
      status: 'not_affected', justification: 'vulnerable_code_not_present',
      scope: 'reviewed distro package only',
      evidence: vulnerability === 'CVE-2026-95619' && name === 'libstdc++6'
        ? 'Reviewed ELF uses the unaffected POSIX allocation branch; upstream overflow regression passed against this exact executable.'
        : vulnerability === 'CVE-2026-102010'
          ? 'The affected PBDS template header is not supplied or instantiated by this reviewed runtime package.'
          : 'This source-package match does not contain the affected aligned C++ allocation implementation.',
      reference: policy.references[vulnerability]
    });
  }
  return { schemaVersion: 1, imageId: image.Id, policySha256: jsonHash(policy), sbomSha256: jsonHash(sbom),
    packageProofs, claims,
    limitations: ['Does not assess PBDS template code compiled into third-party wheels or other application binaries.',
      'Does not suppress findings or establish whole-image safety.'] };
}

if (require.main === module) {
  const [directory, ...extra] = process.argv.slice(2);
  assert.ok(directory && !extra.length, 'Usage: verified-gcc-runtime.js EVIDENCE_DIR');
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const images = read('image-inspect.json');
  assert.ok(Array.isArray(images) && images.length === 1, 'Expected one image');
  const binaries = {};
  for (const expected of Object.values(reviewedPolicy.packages)) {
    if (expected.binary) binaries[expected.binary.name] = fs.readFileSync(path.join(directory, expected.binary.name));
  }
  const proof = verifyGccRuntime({ sbom: read('container-sbom.raw.syft.json'), image: images[0], binaries });
  fs.writeFileSync(path.join(directory, 'gcc-runtime-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(`Verified ${proof.claims.length} package-specific applicability records; scanner findings remain unchanged`);
}
module.exports = { verifyGccRuntime };
