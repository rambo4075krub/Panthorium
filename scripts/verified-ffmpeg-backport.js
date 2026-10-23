#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { enrichSbom } = require('./verify-container-sbom');
const reviewedPolicy = require('../build/media/ffmpeg-backport-policy.json');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const jsonHash = value => sha256(Buffer.from(JSON.stringify(value)));
const canonical = value => JSON.stringify(sortObject(value));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
  return value;
}

// The CLI always uses the committed reviewed policy. The explicit policy
// argument permits hermetic unit fixtures; it is not a CLI/environment override.
function createArtifacts({ rawSbom, sbom, manifest, lock, binaries, image, patchBytes, proof, profile, timestamp }, policy = reviewedPolicy) {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.vulnerability, 'CVE-2026-107696', 'Only the reviewed FFmpeg backport is supported');
  assert.equal(policy.status, 'fixed');
  const profilePolicy = policy.profiles[profile];
  assert.ok(profilePolicy, 'Unreviewed build profile');
  assert.equal(image.Os, profilePolicy.os, 'Unreviewed operating system');
  assert.equal(image.Architecture, profilePolicy.architecture, 'Unreviewed architecture');
  assert.equal(jsonHash(lock), profilePolicy.sourceLockSha256, 'Source/configuration lock requires independent review');
  assert.equal(lock.source.gitCommit, policy.sourceCommit);
  const patch = lock.patches.find(item => item.cve === policy.vulnerability);
  assert.ok(patch, 'Reviewed backport missing');
  assert.equal(patch.commit, policy.patchCommit, 'Unreviewed patch commit');
  assert.equal(patch.sha256, policy.patchSha256);
  assert.equal(sha256(patchBytes), policy.patchSha256, 'Patch bytes differ from reviewed patch');
  assert.deepEqual(patch.patchedFiles, [{ path: policy.patchedFile, sha256: policy.patchedFileSha256 }]);
  for (const binary of ['ffmpeg', 'ffprobe']) {
    assert.equal(sha256(binaries[binary]), profilePolicy.binaries[binary], `${binary} is not an independently reviewed executable`);
  }
  const expected = enrichSbom(rawSbom, manifest, lock, binaries, image, profile);
  assert.deepEqual(sbom, expected.sbom, 'Complete image SBOM was changed after verification');
  assert.deepEqual(proof, expected.proof, 'Source proof differs from actual bytes');
  assert.equal(new Date(timestamp).toISOString(), timestamp, 'Invalid VEX timestamp');
  const identity = { imageId: image.Id, artifactPurl: proof.artifactPurl, vulnerability: policy.vulnerability, policySha256: jsonHash(policy) };
  const vex = {
    '@context': 'https://openvex.dev/ns/v0.2.0',
    '@id': `urn:sha256:${jsonHash(identity)}`,
    author: 'Panthorium verified build policy',
    timestamp,
    version: 1,
    statements: [{
      vulnerability: { '@id': `https://nvd.nist.gov/vuln/detail/${policy.vulnerability}`, name: policy.vulnerability },
      products: [{ '@id': proof.artifactPurl }],
      status: 'fixed',
      status_notes: `Upstream backport ${policy.patchCommit}; reviewed source, patch, configuration and both executable digests verified for this image.`
    }]
  };
  // This is an unsigned verification record, not a release signature. CI binds
  // it to extracted bytes and retains both unfiltered and VEX-aware reports.
  const record = {
    schemaVersion: 1, profile, timestamp, ...identity,
    binaries: proof.binaries, sourceLockSha256: jsonHash(lock), patchSha256: sha256(patchBytes),
    rawSbomSha256: jsonHash(rawSbom), sbomSha256: jsonHash(sbom), vexSha256: jsonHash(vex),
    evidenceRun: policy.evidenceRun
  };
  return { vex, record };
}

function matchWithoutRules(match) {
  const result = { ...match };
  delete result.appliedIgnoreRules;
  return result;
}
function defaultVexRule(status) {
  return {
    vulnerability: '', 'include-aliases': false, reason: '', namespace: '', 'fix-state': '',
    package: { name: '', version: '', language: '', type: '', location: '', 'upstream-name': '' },
    'vex-status': status, 'vex-justification': '', 'match-type': ''
  };
}
function comparableConfig(config) {
  const result = structuredClone(config);
  // The raw run is diagnostic; the second run adds exactly one VEX document,
  // writes another report and reuses the first run's verified database.
  for (const key of ['file', 'fail-on-severity', 'vex-documents', 'ignore']) delete result[key];
  delete result.db['auto-update'];
  return result;
}
function verifyReports(raw, filtered, vex, record) {
  assert.equal(record.vulnerability, 'CVE-2026-107696', 'Unreviewed vulnerability policy');
  assert.match(record.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(record.artifactPurl, `pkg:generic/ffmpeg@9.0.2?checksum=sha256%3A${record.binaries.ffmpeg.sha256}&image_id=${encodeURIComponent(record.imageId)}`, 'Record is not bound to this executable and image');
  assert.equal(jsonHash(vex), record.vexSha256, 'VEX document changed after verification');
  assert.equal(vex.statements.length, 1, 'Unexpected VEX statement');
  assert.deepEqual(vex.statements[0].products, [{ '@id': record.artifactPurl }]);
  assert.equal(vex.statements[0].vulnerability.name, 'CVE-2026-107696');
  assert.equal(vex.statements[0].status, 'fixed');
  assert.equal(raw.descriptor?.name, 'grype');
  assert.equal(raw.descriptor?.version, '0.118.0', 'Review scanner changes before applying policy');
  assert.equal(filtered.descriptor?.name, 'grype');
  assert.equal(filtered.descriptor?.version, raw.descriptor.version);
  assert.deepEqual(filtered.descriptor.db, raw.descriptor.db, 'Scanner databases differ');
  assert.equal(raw.descriptor.db?.status?.valid, true, 'Scanner database is not valid');
  assert.equal(raw.source?.type, 'image');
  assert.equal(raw.source?.target?.imageID, record.imageId, 'Raw scan describes a different image');
  assert.deepEqual(filtered.source, raw.source, 'Filtered scan describes a different image');
  const rawConfig = raw.descriptor.configuration;
  const filteredConfig = filtered.descriptor.configuration;
  assert.equal(rawConfig.match?.stock?.['using-cpes'], true, 'Source package CPE matching is disabled');
  assert.equal(rawConfig.distro, '', 'Distribution override is forbidden');
  assert.equal(rawConfig['by-cve'], false, 'Unreviewed vulnerability alias mode');
  assert.equal(rawConfig['match-upstream-kernel-headers'], true, 'Implicit package ignores are forbidden');
  assert.equal(rawConfig.db?.['validate-by-hash-on-start'], true, 'Database hash validation is disabled');
  assert.equal(rawConfig.db?.['validate-age'], true, 'Database age validation is disabled');
  assert.ok([true, false].includes(rawConfig.db['auto-update']));
  assert.equal(filteredConfig.db?.['auto-update'], false, 'Second scan must reuse the same database');
  assert.ok(['', 'high'].includes(rawConfig['fail-on-severity']), 'Unreviewed diagnostic threshold');
  assert.equal(filteredConfig['fail-on-severity'], 'high', 'High/Critical scanner gate was changed');
  assert.deepEqual(rawConfig.output, ['json']);
  assert.equal(rawConfig['only-fixed'], false);
  assert.equal(rawConfig['only-notfixed'], false);
  assert.equal(rawConfig['ignore-wontfix'], '');
  assert.deepEqual(rawConfig.exclude, []);
  assert.deepEqual(rawConfig.ignore, [], 'Raw scanner ignore rules are forbidden');
  assert.deepEqual(rawConfig['vex-add'], []);
  assert.deepEqual(rawConfig['vex-documents'], [], 'First report must be unfiltered');
  assert.ok(Array.isArray(filteredConfig['vex-documents']) && filteredConfig['vex-documents'].length === 1 &&
    typeof filteredConfig['vex-documents'][0] === 'string' && filteredConfig['vex-documents'][0].length > 0, 'Expected one VEX document');
  assert.deepEqual(filteredConfig.ignore, [defaultVexRule('not_affected'), defaultVexRule('fixed')], 'Unexpected filtered scanner ignore rules');
  assert.deepEqual(comparableConfig(filteredConfig), comparableConfig(rawConfig), 'Scanner matching configuration changed');
  assert.deepEqual(raw.ignoredMatches || [], [], 'Unfiltered scan must not already suppress findings');
  assert.ok(Array.isArray(raw.matches) && Array.isArray(filtered.matches), 'Missing scanner matches');
  const allFiltered = [...filtered.matches, ...(filtered.ignoredMatches || []).map(matchWithoutRules)];
  assert.deepEqual(allFiltered.map(canonical).sort(), raw.matches.map(canonical).sort(), 'Findings changed or disappeared between scans');
  const accepted = [];
  for (const match of filtered.ignoredMatches || []) {
    assert.equal(match.vulnerability?.id, record.vulnerability, 'An unrelated vulnerability was suppressed');
    assert.equal(match.artifact?.purl, record.artifactPurl, 'An unrelated package/image was suppressed');
    assert.equal(match.artifact?.name, 'ffmpeg');
    assert.equal(match.artifact?.version, '9.0.2');
    assert.ok(match.appliedIgnoreRules?.length === 1, 'Unexpected suppression rule');
    const rule = match.appliedIgnoreRules[0];
    assert.equal(rule.namespace, 'vex');
    assert.equal(rule['vex-status'], 'fixed');
    // Grype 0.118 can omit the rule's vulnerability field. The finding itself
    // was matched above to the exact reviewed CVE and artifact, not this label.
    assert.ok([undefined, '', record.vulnerability, `https://nvd.nist.gov/vuln/detail/${record.vulnerability}`].includes(rule.vulnerability));
    accepted.push({ vulnerability: match.vulnerability.id, artifactPurl: match.artifact.purl });
  }
  const remainingHigh = filtered.matches.filter(match => ['high', 'critical'].includes(String(match.vulnerability?.severity).toLowerCase()));
  return {
    schemaVersion: 1, imageId: record.imageId, rawScanSha256: jsonHash(raw), filteredScanSha256: jsonHash(filtered),
    vexSha256: record.vexSha256, rawMatchCount: raw.matches.length, remainingMatchCount: filtered.matches.length,
    verifiedFixedMatches: accepted, remainingHighCount: remainingHigh.length
  };
}

function loadEvidence(directory, timestamp) {
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const proof = read('ffmpeg-proof.json');
  const names = { backend: 'ffmpeg-source.lock.json', speaker: 'ffmpeg-speaker-source.lock.json' };
  assert.ok(names[proof.profile], 'Unknown source profile');
  const lock = require(path.join(__dirname, '../build/media', names[proof.profile]));
  const images = read('image-inspect.json');
  assert.ok(Array.isArray(images) && images.length === 1);
  return {
    rawSbom: read('container-sbom.raw.syft.json'), sbom: read('container-sbom.syft.json'), manifest: read('ffmpeg-source.json'),
    lock, proof, profile: proof.profile, image: images[0], timestamp,
    binaries: { ffmpeg: fs.readFileSync(path.join(directory, 'ffmpeg')), ffprobe: fs.readFileSync(path.join(directory, 'ffprobe')) },
    patchBytes: fs.readFileSync(path.join(__dirname, '../build/media/patches/ffmpeg-CVE-2026-107696.patch'))
  };
}
if (require.main === module) {
  const [mode, directory, ...extra] = process.argv.slice(2);
  assert.ok(['create', 'verify'].includes(mode) && directory && extra.length === 0, 'Usage: verified-ffmpeg-backport.js create|verify EVIDENCE_DIR');
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  if (mode === 'create') {
    const { vex, record } = createArtifacts(loadEvidence(directory, new Date().toISOString()));
    write('ffmpeg-backport.vex.json', vex);
    write('ffmpeg-backport-verification.json', record);
    console.log('Created one fixed statement for the reviewed executable and inspected image');
  } else {
    const record = read('ffmpeg-backport-verification.json'), vex = read('ffmpeg-backport.vex.json');
    const expected = createArtifacts(loadEvidence(directory, record.timestamp));
    assert.deepEqual(record, expected.record, 'Verification record changed');
    assert.deepEqual(vex, expected.vex, 'VEX document changed');
    const audit = verifyReports(read('container-vulnerabilities.raw.json'), read('container-vulnerabilities.json'), vex, record);
    write('scan-policy-audit.json', audit);
    console.log(`Verified ${audit.verifiedFixedMatches.length} fixed matches; ${audit.remainingHighCount} High/Critical matches still block release`);
    if (audit.remainingHighCount) process.exitCode = 2;
  }
}
module.exports = { createArtifacts, verifyReports };
