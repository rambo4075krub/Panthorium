'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { enrichSbom } = require('../scripts/verify-container-sbom');
const { createArtifacts, verifyReports } = require('../scripts/verified-ffmpeg-backport');
const reviewedPolicy = require('../build/media/ffmpeg-backport-policy.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = structuredClone;

function fixture(profile) {
  const lock = require(`../build/media/${profile === 'backend' ? 'ffmpeg-source' : 'ffmpeg-speaker-source'}.lock.json`);
  const image = { Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'amd64' };
  const binaries = { ffmpeg: Buffer.from('\x7fELFfixture-ffmpeg'), ffprobe: Buffer.from('\x7fELFfixture-ffprobe') };
  const manifest = { ...clone(lock), binaries: Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, { path: `/usr/local/bin/${name}`, sha256: hash(bytes) }])) };
  const rawSbom = { schema: { version: '16.1.11' }, source: { id: 'image', type: 'image', metadata: { imageID: image.Id } }, distro: { id: profile === 'backend' ? 'alpine' : 'debian' }, artifacts: [{ id: 'base', name: 'base-library', version: '1.0', type: 'binary' }] };
  const { sbom, proof } = enrichSbom(rawSbom, manifest, lock, binaries, image, profile);
  const input = { rawSbom, sbom, proof, manifest, lock, binaries, image, profile, timestamp: '2026-10-23T00:00:00.000Z', patchBytes: fs.readFileSync(path.join(__dirname, '../build/media/patches/ffmpeg-CVE-2026-107696.patch')) };
  // Only tests substitute a reviewed executable identity. The CLI has no policy
  // override; fake executables must fail against the real committed policy.
  const policy = clone(reviewedPolicy);
  for (const name of ['ffmpeg', 'ffprobe']) policy.profiles[profile].binaries[name] = hash(binaries[name]);
  return { input, policy };
}

for (const profile of ['backend', 'speaker']) {
  const { input, policy } = fixture(profile);
  assert.throws(() => createArtifacts(input), /not an independently reviewed executable/);
  const { vex, record } = createArtifacts(input, policy);
  assert.equal(vex.statements.length, 1);
  assert.equal(vex.statements[0].status, 'fixed');
  assert.ok(vex.statements[0].products[0]['@id'].includes(`image_id=${encodeURIComponent(input.image.Id)}`));
  assert.ok(vex.statements[0].products[0]['@id'].includes(hash(input.binaries.ffmpeg)));

  for (const name of ['ffmpeg', 'ffprobe']) {
    assert.throws(() => createArtifacts({ ...input, binaries: { ...input.binaries, [name]: Buffer.from('\x7fELFtampered') } }, policy), /reviewed executable/);
  }
  const changedLock = clone(input.lock); changedLock.configure.push('--enable-network');
  assert.throws(() => createArtifacts({ ...input, lock: changedLock, manifest: { ...input.manifest, configure: changedLock.configure } }, policy), /lock requires independent review/);
  assert.throws(() => createArtifacts({ ...input, patchBytes: Buffer.from('unreviewed patch') }, policy), /Patch bytes differ/);
  assert.throws(() => createArtifacts({ ...input, image: { ...input.image, Architecture: 'arm64' } }, policy), /architecture/);
  assert.throws(() => createArtifacts({ ...input, image: { ...input.image, Id: `sha256:${'b'.repeat(64)}` } }, policy), /different image/);
  const missingPackage = clone(input.sbom); missingPackage.artifacts.shift();
  assert.throws(() => createArtifacts({ ...input, sbom: missingPackage }, policy), /Complete image SBOM/);
  const changedProof = clone(input.proof); changedProof.artifactPurl = input.lock.purl;
  assert.throws(() => createArtifacts({ ...input, proof: changedProof }, policy), /Source proof differs/);

  const fixedMatch = { vulnerability: { id: 'CVE-2026-107696', severity: 'High' }, artifact: { name: 'ffmpeg', version: '9.0.2', purl: record.artifactPurl } };
  const unrelated = { vulnerability: { id: 'CVE-2026-999999', severity: 'Critical' }, artifact: { name: 'base-library', version: '1.0', purl: 'pkg:generic/base-library@1.0' } };
  const config = { 'only-fixed': false, 'only-notfixed': false, 'ignore-wontfix': '', exclude: [], ignore: [],
    'vex-documents': [], 'vex-add': [], output: ['json'], 'fail-on-severity': '', distro: '', 'by-cve': false,
    'match-upstream-kernel-headers': true, match: { stock: { 'using-cpes': true } },
    db: { 'auto-update': true, 'validate-age': true, 'validate-by-hash-on-start': true } };
  const raw = { source: { type: 'image', target: { imageID: input.image.Id } }, descriptor: { name: 'grype', version: '0.118.0', db: { checksum: 'same', status: { valid: true } }, configuration: config }, matches: [fixedMatch, unrelated], ignoredMatches: [] };
  const ignore = { namespace: 'vex', 'vex-status': 'fixed' };
  const filtered = { ...clone(raw), matches: [clone(unrelated)], ignoredMatches: [{ ...clone(fixedMatch), appliedIgnoreRules: [ignore] }] };
  filtered.descriptor.configuration['vex-documents'] = ['ffmpeg-backport.vex.json'];
  filtered.descriptor.configuration['fail-on-severity'] = 'high';
  filtered.descriptor.configuration.db['auto-update'] = false;
  filtered.descriptor.configuration.ignore = ['not_affected', 'fixed'].map(status => ({
    vulnerability: '', 'include-aliases': false, reason: '', namespace: '', 'fix-state': '',
    package: { name: '', version: '', language: '', type: '', location: '', 'upstream-name': '' },
    'vex-status': status, 'vex-justification': '', 'match-type': ''
  }));
  const audit = verifyReports(raw, filtered, vex, record);
  assert.equal(audit.verifiedFixedMatches.length, 1);
  assert.equal(audit.remainingHighCount, 1, 'An unrelated Critical still blocks release');
  assert.equal(verifyReports({ ...raw, matches: [fixedMatch] }, { ...filtered, matches: [] }, vex, record).remainingHighCount, 0);
  assert.equal(verifyReports({ ...raw, matches: [] }, { ...filtered, matches: [], ignoredMatches: [] }, vex, record).verifiedFixedMatches.length, 0, 'An absent finding needs no suppression');
  assert.throws(() => verifyReports(raw, { ...filtered, matches: [] }, vex, record), /changed or disappeared/);
  const concealed = clone(filtered); concealed.ignoredMatches.push({ ...concealed.matches.pop(), appliedIgnoreRules: [ignore] });
  assert.throws(() => verifyReports(raw, concealed, vex, record), /unrelated vulnerability/);
  const severityChanged = clone(filtered); severityChanged.matches[0].vulnerability.severity = 'Low';
  assert.throws(() => verifyReports(raw, severityChanged, vex, record), /changed or disappeared/);
  const differentDatabase = clone(filtered); differentDatabase.descriptor.db.checksum = 'new';
  assert.throws(() => verifyReports(raw, differentDatabase, vex, record), /databases differ/);
  const matchingDisabled = clone(raw), filteredMatchingDisabled = clone(filtered);
  matchingDisabled.matches = []; filteredMatchingDisabled.matches = []; filteredMatchingDisabled.ignoredMatches = [];
  matchingDisabled.descriptor.configuration.match.stock['using-cpes'] = false;
  filteredMatchingDisabled.descriptor.configuration.match.stock['using-cpes'] = false;
  assert.throws(() => verifyReports(matchingDisabled, filteredMatchingDisabled, vex, record), /CPE matching is disabled/);
  const changedMatching = clone(filtered); changedMatching.descriptor.configuration.match.stock['using-cpes'] = false;
  assert.throws(() => verifyReports(raw, changedMatching, vex, record), /matching configuration changed/);
  const invalidDatabase = clone(raw), filteredInvalidDatabase = clone(filtered);
  invalidDatabase.descriptor.db.status.valid = false; filteredInvalidDatabase.descriptor.db.status.valid = false;
  assert.throws(() => verifyReports(invalidDatabase, filteredInvalidDatabase, vex, record), /database is not valid/);
  for (const key of ['validate-age', 'validate-by-hash-on-start']) {
    const unvalidatedDatabase = clone(raw); unvalidatedDatabase.descriptor.configuration.db[key] = false;
    assert.throws(() => verifyReports(unvalidatedDatabase, filtered, vex, record), /validation is disabled/);
  }
  const distroOverride = clone(raw); distroOverride.descriptor.configuration.distro = 'alpine:3.1';
  assert.throws(() => verifyReports(distroOverride, filtered, vex, record), /Distribution override/);
  const implicitIgnores = clone(raw); implicitIgnores.descriptor.configuration['match-upstream-kernel-headers'] = false;
  assert.throws(() => verifyReports(implicitIgnores, filtered, vex, record), /Implicit package ignores/);
  const changedThreshold = clone(filtered); changedThreshold.descriptor.configuration['fail-on-severity'] = 'critical';
  assert.throws(() => verifyReports(raw, changedThreshold, vex, record), /gate was changed/);
  const differentImage = clone(filtered); differentImage.source.target.imageID = `sha256:${'b'.repeat(64)}`;
  assert.throws(() => verifyReports(raw, differentImage, vex, record), /different image/);
  const wildcardVex = clone(vex); wildcardVex.statements[0].products[0]['@id'] = input.lock.purl;
  assert.throws(() => verifyReports(raw, filtered, wildcardVex, record), /VEX document changed/);
  const otherPackage = clone(fixedMatch); otherPackage.artifact.purl = input.lock.purl;
  assert.throws(() => verifyReports({ ...raw, matches: [otherPackage] }, { ...filtered, matches: [], ignoredMatches: [{ ...otherPackage, appliedIgnoreRules: [ignore] }] }, vex, record), /unrelated package/);
}
console.log('Verified backport: exact source/executable/image binding, tamper rejection and unrelated vulnerability gate preserved');
