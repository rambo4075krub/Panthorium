'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { enrichSbom } = require('../scripts/verify-container-sbom');

const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const binaries = { ffmpeg: Buffer.from('\x7fELFtest-ffmpeg'), ffprobe: Buffer.from('\x7fELFtest-ffprobe') };
const lock = {
  schemaVersion: 1, name: 'ffmpeg', version: '9.0.2', license: 'GPL-2.0-or-later', purl: 'pkg:generic/ffmpeg@9.0.2',
  cpe: 'cpe:2.3:a:ffmpeg:ffmpeg:9.0.2:*:*:*:*:*:*:*',
  source: { url: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz', sha256: 'a'.repeat(64) },
  patches: [{ cve: 'CVE-2026-99999', commit: 'b'.repeat(40), sha256: 'c'.repeat(64) }],
  configure: ['--disable-network']
};
const manifest = { ...structuredClone(lock), binaries: Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, {
  path: `/usr/local/bin/${name}`, sha256: digest(bytes)
}])) };
const image = { Id: `sha256:${'d'.repeat(64)}` };
const raw = {
  schema: { version: '16.1.11' }, source: { id: 'image-source', type: 'image', metadata: { imageID: image.Id } },
  distro: { id: 'alpine', versionID: '3.24' },
  artifacts: [{ id: 'existing-package', name: 'musl', version: '1.2.5', type: 'apk' }],
  artifactRelationships: [{ parent: 'image-source', child: 'existing-package', type: 'contains' }]
};
const original = structuredClone(raw);
const { sbom, proof } = enrichSbom(raw, manifest, lock, binaries, image);
assert.deepEqual(raw, original, 'Original scanner inventory must not be mutated');
assert.deepEqual(sbom.artifacts.slice(0, raw.artifacts.length), raw.artifacts);
assert.deepEqual(sbom.artifactRelationships.slice(0, raw.artifactRelationships.length), raw.artifactRelationships);
assert.equal(sbom.artifacts.at(-1).cpes[0].cpe, lock.cpe);
assert.equal(sbom.artifacts.at(-1).version, '9.0.2', 'Do not relabel patched builds as a newer upstream release');
assert.ok(proof.artifactPurl.includes(digest(binaries.ffmpeg)));
assert.equal(proof.enrichedPackageCount, proof.originalPackageCount + 1);

assert.throws(() => enrichSbom(raw, manifest, lock, { ...binaries, ffmpeg: Buffer.from('\x7fELFtampered') }, image), /differs/);
assert.throws(() => enrichSbom(raw, { ...manifest, patches: [] }, lock, binaries, image), /Unreviewed FFmpeg patches/);
assert.throws(() => enrichSbom(raw, { ...manifest, cpe: 'fake' }, lock, binaries, image), /Unreviewed FFmpeg cpe/);
assert.throws(() => enrichSbom(raw, manifest, lock, binaries, { Id: `sha256:${'e'.repeat(64)}` }), /different image/);
assert.throws(() => enrichSbom({ ...raw, artifacts: [] }, manifest, lock, binaries, image), /no packages/);
assert.throws(() => enrichSbom({ ...raw, source: { ...raw.source, type: 'directory' } }, manifest, lock, binaries, image), /complete image/);
assert.throws(() => enrichSbom(sbom, manifest, lock, binaries, image), /already exists/);
const speakerRaw = { ...raw, distro: { id: 'debian', versionID: '13' } };
assert.throws(() => enrichSbom(speakerRaw, manifest, lock, binaries, image), /distribution/);
assert.throws(() => enrichSbom(raw, manifest, lock, binaries, image, 'speaker'), /distribution/);
assert.throws(() => enrichSbom(raw, manifest, lock, binaries, image, 'unknown'), /Unknown image profile/);
assert.equal(enrichSbom(speakerRaw, manifest, lock, binaries, image, 'speaker').proof.profile, 'speaker');
console.log('Container SBOM provenance, package preservation, and tamper rejection tests passed');
