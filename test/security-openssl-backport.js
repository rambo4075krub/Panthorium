'use strict';
const assert = require('node:assert/strict');
const { verifyOpenSsl } = require('../scripts/verified-openssl-backport');
const fixture = require('./helpers/openssl-security-fixture');
const { input, policy, result } = fixture({ Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'amd64' });
assert.throws(() => verifyOpenSsl(input), /not an independently reviewed executable/);
assert.equal(result.statements.length, 16);
assert.equal(result.sbom.artifacts.length, input.rawSbom.artifacts.length);
for (let index = 0; index < result.sbom.artifacts.length; index++) {
  const original = input.rawSbom.artifacts[index];
  const decorated = result.sbom.artifacts[index];
  assert.deepEqual({ ...decorated, purl: original.purl }, original, 'Only binding qualifiers may change');
  assert.equal(decorated.purl.split('?')[0], original.purl.split('?')[0]);
  const qualifiers = new URLSearchParams(decorated.purl.split('?')[1]);
  qualifiers.delete('checksum'); qualifiers.delete('image_id');
  assert.equal(qualifiers.toString(), original.purl.split('?')[1]);
}
for (const library of ['libcrypto.so.3', 'libssl.so.3']) {
  assert.throws(() => verifyOpenSsl({ ...input, binaries: { ...input.binaries, [library]: Buffer.from('\x7fELFtampered') } }, policy), /reviewed executable/);
}
const mutate = operation => { const rawSbom = structuredClone(input.rawSbom); operation(rawSbom); return { ...input, rawSbom }; };
assert.throws(() => verifyOpenSsl(mutate(s => { s.artifacts[0].version = '3.5.9-r0'; }), policy), /not rebuilt/);
assert.throws(() => verifyOpenSsl(mutate(s => { s.artifacts[0].metadata.files = []; }), policy), /does not own/);
assert.throws(() => verifyOpenSsl(mutate(s => { s.artifacts.push(structuredClone(s.artifacts[0])); }), policy), /exactly one/);
assert.throws(() => verifyOpenSsl(mutate(s => { s.artifacts[0].purl += '&image_id=other'; }), policy), /already qualified/);
const patch = input.lock.patches[0].file;
assert.throws(() => verifyOpenSsl({ ...input, patches: { ...input.patches, [patch]: Buffer.from('changed') } }, policy), /patch bytes differ/);
assert.throws(() => verifyOpenSsl({ ...input, lock: { ...input.lock, patches: [] } }, policy), /source lock requires/);
assert.throws(() => verifyOpenSsl(input, { ...policy, vulnerabilities: [...policy.vulnerabilities, 'CVE-2026-999999'] }), /vulnerability set/);
console.log('OpenSSL: exact source/patch/ELF/APK/image binding, inventory preservation and tamper rejection passed');
