import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const lock = JSON.parse(fs.readFileSync(new URL('./openssl-source.lock.json', import.meta.url)));
const binaries = {};
for (const name of ['libcrypto.so.3', 'libssl.so.3']) {
  const path = `/usr/lib/${name}`;
  const bytes = fs.readFileSync(path);
  if (bytes.subarray(0, 4).toString('hex') !== '7f454c46') throw new Error('OpenSSL library is not ELF');
  binaries[name] = { path, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
const runtimeVersion = execFileSync('/usr/bin/openssl', ['version'], { encoding: 'utf8' }).trim();
if (!runtimeVersion.startsWith('OpenSSL 3.5.9 ')) throw new Error('Unexpected installed OpenSSL release');
const testLogs = Object.fromEntries(['openssl-tests.log', 'openssl-security-tests.log'].map(name => {
  const bytes = fs.readFileSync(`/out/share/panthorium/${name}`);
  const text = bytes.toString('utf8');
  if (name === 'openssl-tests.log' ? !/All tests successful\.[\s\S]*Result: PASS/.test(text) :
      !text.includes('PASS: empty AAD retains authentication, context reuse clears stale AAD, invalid nonce lengths rejected')) {
    throw new Error(`OpenSSL test completion evidence missing: ${name}`);
  }
  return [name, crypto.createHash('sha256').update(bytes).digest('hex')];
}));
fs.writeFileSync('/out/share/panthorium/openssl-source.json', JSON.stringify({ ...lock, binaries, runtimeVersion, testLogs }, null, 2) + '\n');
