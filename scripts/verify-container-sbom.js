#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const provenanceFields = ['schemaVersion', 'name', 'version', 'license', 'purl', 'cpe', 'source', 'patches', 'configure'];

// Enrich the complete image inventory; never replace or filter its packages.
// The upstream version/CPE stays intact even when a patch was backported.
function enrichSbom(sbom, manifest, lock, binaries, image, profile = 'backend') {
  assert.match(sbom?.schema?.version || '', /^16\./, 'Unsupported Syft schema');
  assert.equal(sbom?.source?.type, 'image', 'A complete image SBOM is required');
  assert.ok(Array.isArray(sbom.artifacts) && sbom.artifacts.length, 'Image SBOM has no packages');
  assert.match(image?.Id || '', /^sha256:[a-f0-9]{64}$/, 'Missing Docker image identity');
  assert.equal(sbom.source.metadata?.imageID, image.Id, 'SBOM describes a different image');
  const expectedDistro = { backend: 'alpine', speaker: 'debian' }[profile];
  assert.ok(expectedDistro, 'Unknown image profile');
  assert.equal(sbom.distro?.id, expectedDistro, 'Unexpected image distribution for profile');

  for (const field of provenanceFields) {
    assert.notEqual(lock[field], undefined, `Source lock omits ${field}`);
    assert.deepEqual(manifest[field], lock[field], `Unreviewed FFmpeg ${field}`);
  }
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.name, 'ffmpeg');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.purl, `pkg:generic/ffmpeg@${manifest.version}`);
  assert.equal(manifest.cpe, `cpe:2.3:a:ffmpeg:ffmpeg:${manifest.version}:*:*:*:*:*:*:*`);
  assert.match(manifest.source.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(manifest.configure) && manifest.configure.length > 0);

  const verifiedBinaries = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const entry = manifest.binaries?.[name];
    assert.equal(entry?.path, `/usr/local/bin/${name}`, `Unexpected ${name} location`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, `Invalid ${name} digest`);
    const bytes = binaries[name];
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 4, `${name} executable missing`);
    assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46', `${name} is not ELF`);
    assert.equal(sha256(bytes), entry.sha256, `${name} differs from the build manifest`);
    verifiedBinaries[name] = { path: entry.path, sha256: entry.sha256 };
  }

  // A checksum qualifier scopes any later reviewed VEX to this exact executable,
  // while the ordinary upstream CPE keeps all upstream CVEs visible to Grype.
  const artifactPurl = `${manifest.purl}?checksum=sha256%3A${verifiedBinaries.ffmpeg.sha256}`;
  const id = sha256(Buffer.from(artifactPurl)).slice(0, 16);
  assert.ok(!sbom.artifacts.some(item => item.id === id), 'Source artifact already exists');
  const result = structuredClone(sbom);
  result.artifacts.push({
    id,
    name: 'ffmpeg',
    version: manifest.version,
    type: 'binary',
    foundBy: 'panthorium-verified-source-manifest',
    locations: Object.values(verifiedBinaries).map(item => ({ path: item.path, accessPath: item.path })),
    licenses: [{ value: manifest.license, spdxExpression: manifest.license, type: 'declared', urls: [], locations: [] }],
    language: '',
    cpes: [{ cpe: manifest.cpe, source: 'declared' }],
    purl: artifactPurl
  });
  result.artifactRelationships ||= [];
  result.artifactRelationships.push({ parent: result.source.id, child: id, type: 'contains' });
  return {
    sbom: result,
    proof: {
      schemaVersion: 1,
      profile,
      imageId: image.Id,
      sourceManifestSha256: sha256(Buffer.from(JSON.stringify(manifest))),
      source: manifest.source,
      patches: manifest.patches,
      configure: manifest.configure,
      binaries: verifiedBinaries,
      artifactId: id,
      artifactPurl,
      cpe: manifest.cpe,
      originalPackageCount: sbom.artifacts.length,
      enrichedPackageCount: result.artifacts.length
    }
  };
}

if (require.main === module) {
  const [rawPath, manifestPath, binaryDirectory, inspectPath, lockPath, outputPath, proofPath, profile = 'backend'] = process.argv.slice(2);
  assert.ok(proofPath, 'Usage: verify-container-sbom.js RAW MANIFEST BINARY_DIR INSPECT LOCK OUTPUT PROOF [backend|speaker]');
  const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
  const images = readJson(inspectPath);
  assert.ok(Array.isArray(images) && images.length === 1, 'Expected exactly one inspected image');
  const { sbom, proof } = enrichSbom(readJson(rawPath), readJson(manifestPath), readJson(lockPath), {
    ffmpeg: fs.readFileSync(path.join(binaryDirectory, 'ffmpeg')),
    ffprobe: fs.readFileSync(path.join(binaryDirectory, 'ffprobe'))
  }, images[0], profile);
  fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2) + '\n');
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  console.log(`Preserved ${proof.originalPackageCount} image packages and added verified FFmpeg ${proof.cpe}`);
}

module.exports = { enrichSbom };
