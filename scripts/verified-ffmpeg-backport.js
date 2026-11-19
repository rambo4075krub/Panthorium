#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { enrichSbom } = require('./verify-container-sbom');
const { verifyOpenSsl, loadOpenSslEvidence } = require('./verified-openssl-backport');
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
function createArtifacts({ rawSbom, sbom, manifest, lock, binaries, image, patchBytes, proof, profile, timestamp, compilationFiles, openSslEvidence }, policy = reviewedPolicy, opensslPolicy) {
  assert.equal(policy.schemaVersion, 2);
  const profilePolicy = policy.profiles[profile];
  assert.ok(profilePolicy, 'Unreviewed build profile');
  assert.equal(image.Os, profilePolicy.os, 'Unreviewed operating system');
  assert.equal(image.Architecture, profilePolicy.architecture, 'Unreviewed architecture');
  assert.equal(jsonHash(lock), profilePolicy.sourceLockSha256, 'Source/configuration lock requires independent review');
  assert.equal(lock.source.gitCommit, policy.sourceCommit);
  assert.equal(lock.patches.length, 22, 'Reviewed patch set missing');
  for (const patch of lock.patches) {
    assert.equal(sha256(patchBytes[patch.file]), patch.sha256, 'Patch bytes differ from reviewed patch');
  }
  for (const binary of ['ffmpeg', 'ffprobe']) {
    assert.equal(sha256(binaries[binary]), profilePolicy.binaries[binary], `${binary} is not an independently reviewed executable`);
  }
  assert.equal(jsonHash(manifest.compilation), profilePolicy.compilationSha256, 'Compilation evidence requires independent review');
  const macros = {};
  for (const name of ['config.h', 'config_components.h']) {
    assert.equal(sha256(compilationFiles[name]), manifest.compilation.configuration[name], 'Compiled configuration bytes differ');
    for (const match of compilationFiles[name].toString('utf8').matchAll(/^#define (CONFIG_[A-Z0-9_]+) ([01])$/gm)) macros[match[1]] = Number(match[2]);
  }
  const codecObjects = JSON.parse(compilationFiles['codec-objects.json']);
  assert.equal(jsonHash(codecObjects), manifest.compilation.codecObjectsSha256, 'Compiled object inventory differs');
  assert.ok(!codecObjects.some(name => /^(?:vaapi_hevc|vdpau_hevc|dxva2_hevc|ffv1enc_vulkan|vulkan_decode|lcevcdec)\.o$/.test(name)), 'Excluded code is present');
  for (const names of Object.values(lock.excludedComponents)) {
    for (const name of names) {
      assert.equal(macros[name], 0, 'Excluded component was enabled');
      assert.equal(manifest.compilation.excludedMacros[name], 0, 'Excluded component evidence differs');
    }
  }
  let openssl;
  if (profile === 'backend') {
    assert.ok(openSslEvidence, 'Backend OpenSSL evidence is required');
    openssl = verifyOpenSsl(openSslEvidence, opensslPolicy);
    assert.equal(openssl.proof.imageId, image.Id, 'OpenSSL proof describes a different image');
    assert.deepEqual(rawSbom, openssl.sbom, 'OpenSSL inventory differs from verified package bytes');
  } else {
    assert.equal(openSslEvidence, undefined, 'Unexpected OpenSSL policy for speaker');
  }
  const expected = enrichSbom(rawSbom, manifest, lock, binaries, image, profile);
  assert.deepEqual(sbom, expected.sbom, 'Complete image SBOM was changed after verification');
  assert.deepEqual(proof, expected.proof, 'Source proof differs from actual bytes');
  assert.equal(new Date(timestamp).toISOString(), timestamp, 'Invalid VEX timestamp');
  const fixed = new Map();
  for (const patch of lock.patches) for (const cve of patch.cves || [patch.cve]) {
    assert.match(cve, /^CVE-\d{4}-\d+$/);
    fixed.set(cve, [...(fixed.get(cve) || []), patch.commit]);
  }
  const statements = [...fixed.entries()].sort().map(([cve, commits]) => ({
    vulnerability: { '@id': `https://nvd.nist.gov/vuln/detail/${cve}`, name: cve },
    products: [{ '@id': proof.artifactPurl }], status: 'fixed',
    status_notes: `Upstream backports ${commits.join(', ')}; reviewed source, patches, configuration and both executable digests verified for this image.`
  }));
  for (const [cve, names] of Object.entries(lock.excludedComponents).sort()) {
    assert.ok(!fixed.has(cve), 'Contradictory FFmpeg review');
    statements.push({
      vulnerability: { '@id': `https://nvd.nist.gov/vuln/detail/${cve}`, name: cve },
      products: [{ '@id': proof.artifactPurl }], status: 'not_affected', justification: 'vulnerable_code_not_present',
      impact_statement: `The pinned build disables ${names.join(', ')}. Generated configuration, codec archive membership and independently reviewed executable bytes verify the vulnerable implementation is absent.`
    });
  }
  if (openssl) statements.push(...openssl.statements);
  const identity = { imageId: image.Id, artifactPurl: proof.artifactPurl, policySha256: jsonHash(policy) };
  const vex = {
    '@context': 'https://openvex.dev/ns/v0.2.0',
    '@id': `urn:sha256:${jsonHash(identity)}`,
    author: 'Panthorium verified build policy',
    timestamp,
    version: 1,
    statements
  };
  // This is an unsigned verification record, not a release signature. CI binds
  // it to extracted bytes and retains both unfiltered and VEX-aware reports.
  const record = {
    schemaVersion: 2, profile, timestamp, ...identity,
    binaries: proof.binaries, sourceLockSha256: jsonHash(lock),
    patches: lock.patches.map(patch => ({ file: patch.file, sha256: sha256(patchBytes[patch.file]) })),
    compilationSha256: jsonHash(manifest.compilation),
    openssl: openssl?.proof || null,
    accepted: statements.map(statement => {
      const artifactPurl = statement.products[0]['@id'];
      const native = openssl?.proof.packages.find(p => p.artifactPurl === artifactPurl);
      return { vulnerability: statement.vulnerability.name, artifactPurl,
        name: native?.name || 'ffmpeg', version: native?.version || '9.0.2', status: statement.status,
        ...(statement.justification ? { justification: statement.justification } : {}) };
    }),
    rawSbomSha256: jsonHash(rawSbom), sbomSha256: jsonHash(sbom), vexSha256: jsonHash(vex),
    evidenceRun: profilePolicy.evidenceRun || policy.evidenceRun
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
  assert.equal(record.schemaVersion, 2, 'Unreviewed vulnerability policy');
  assert.match(record.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(record.artifactPurl, `pkg:generic/ffmpeg@9.0.2?checksum=sha256%3A${record.binaries.ffmpeg.sha256}&image_id=${encodeURIComponent(record.imageId)}`, 'Record is not bound to this executable and image');
  assert.equal(jsonHash(vex), record.vexSha256, 'VEX document changed after verification');
  assert.equal(vex.statements.length, record.accepted.length, 'Unexpected VEX statement');
  for (const [index, accepted] of record.accepted.entries()) {
    const statement = vex.statements[index];
    assert.deepEqual(statement.products, [{ '@id': accepted.artifactPurl }]);
    assert.equal(statement.vulnerability.name, accepted.vulnerability);
    assert.equal(statement.status, accepted.status);
    assert.equal(statement.justification, accepted.justification);
    assert.ok(accepted.artifactPurl.includes(`image_id=${encodeURIComponent(record.imageId)}`));
    assert.ok(accepted.artifactPurl.includes('checksum=sha256%3A'));
  }
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
    const reviewed = record.accepted.filter(item => item.vulnerability === match.vulnerability?.id);
    assert.ok(reviewed.length, 'An unrelated vulnerability was suppressed');
    const exact = reviewed.find(item => item.artifactPurl === match.artifact?.purl);
    assert.ok(exact, 'An unrelated package/image was suppressed');
    assert.equal(match.artifact?.name, exact.name);
    assert.equal(match.artifact?.version, exact.version);
    assert.ok(match.appliedIgnoreRules?.length === 1, 'Unexpected suppression rule');
    const rule = match.appliedIgnoreRules[0];
    assert.equal(rule.namespace, 'vex');
    assert.equal(rule['vex-status'], exact.status);
    if (exact.justification) assert.equal(rule['vex-justification'], exact.justification);
    // Grype 0.118 can omit the rule's vulnerability field. The finding itself
    // was matched above to the exact reviewed CVE and artifact, not this label.
    assert.ok([undefined, '', exact.vulnerability, `https://nvd.nist.gov/vuln/detail/${exact.vulnerability}`].includes(rule.vulnerability));
    accepted.push({ vulnerability: match.vulnerability.id, artifactPurl: match.artifact.purl, status: exact.status });
  }
  const remainingHigh = filtered.matches.filter(match => ['high', 'critical'].includes(String(match.vulnerability?.severity).toLowerCase()));
  return {
    schemaVersion: 1, imageId: record.imageId, rawScanSha256: jsonHash(raw), filteredScanSha256: jsonHash(filtered),
    vexSha256: record.vexSha256, rawMatchCount: raw.matches.length, remainingMatchCount: filtered.matches.length,
    verifiedFixedMatches: accepted.filter(item => item.status === 'fixed'),
    verifiedNotAffectedMatches: accepted.filter(item => item.status === 'not_affected'), remainingHighCount: remainingHigh.length
  };
}

function loadEvidence(directory, timestamp) {
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const proof = read('ffmpeg-proof.json');
  const names = { backend: 'ffmpeg-source.lock.json', speaker: 'ffmpeg-speaker-source.lock.json', 'speaker-candidate-noble': 'ffmpeg-speaker-source.lock.json' };
  assert.ok(names[proof.profile], 'Unknown source profile');
  const lock = require(path.join(__dirname, '../build/media', names[proof.profile]));
  const images = read('image-inspect.json');
  assert.ok(Array.isArray(images) && images.length === 1);
  return {
    rawSbom: read(proof.profile === 'speaker-candidate-noble' ? 'service-sbom.with-native.syft.json' : proof.profile === 'backend' ? 'container-sbom.with-openssl.syft.json' : 'container-sbom.raw.syft.json'),
    sbom: read(proof.profile === 'speaker-candidate-noble' ? 'service-sbom.syft.json' : 'container-sbom.syft.json'), manifest: read('ffmpeg-source.json'),
    lock, proof, profile: proof.profile, image: images[0], timestamp,
    binaries: { ffmpeg: fs.readFileSync(path.join(directory, 'ffmpeg')), ffprobe: fs.readFileSync(path.join(directory, 'ffprobe')) },
    patchBytes: Object.fromEntries(lock.patches.map(patch => [patch.file, fs.readFileSync(path.join(__dirname, '../build/media', patch.file))])),
    compilationFiles: Object.fromEntries(['config.h', 'config_components.h', 'codec-objects.json'].map(name => [name, fs.readFileSync(path.join(directory, `ffmpeg-${name}`))])),
    ...(proof.profile === 'backend' ? { openSslEvidence: loadOpenSslEvidence(directory, images[0]) } : {})
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
    console.log(`Created ${vex.statements.length} verified statements for this exact image`);
  } else {
    const record = read('ffmpeg-backport-verification.json'), vex = read('ffmpeg-backport.vex.json');
    const expected = createArtifacts(loadEvidence(directory, record.timestamp));
    assert.deepEqual(record, expected.record, 'Verification record changed');
    assert.deepEqual(vex, expected.vex, 'VEX document changed');
    const audit = verifyReports(read('container-vulnerabilities.raw.json'), read('container-vulnerabilities.json'), vex, record);
    write('scan-policy-audit.json', audit);
    console.log(`Verified ${audit.verifiedFixedMatches.length} fixed and ${audit.verifiedNotAffectedMatches.length} absent-code matches; ${audit.remainingHighCount} High/Critical matches still block release`);
    if (audit.remainingHighCount) process.exitCode = 2;
  }
}
module.exports = { createArtifacts, verifyReports };
