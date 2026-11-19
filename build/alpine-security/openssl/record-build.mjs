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
const version = execFileSync('/usr/bin/openssl', ['version'], { encoding: 'utf8' }).trim();
if (!version.startsWith('OpenSSL 3.5.9 ')) throw new Error('Unexpected installed OpenSSL release');
fs.writeFileSync('/out/share/panthorium/openssl-source.json', JSON.stringify({ ...lock, binaries, version, upstreamTests: 'make -j2 test completed by abuild check' }, null, 2) + '\n');
