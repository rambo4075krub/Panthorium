// Build the pinned Debian zlib baseline with the reviewed upstream state reset.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(directory, 'source.lock.json')));
const work = fs.mkdtempSync('/tmp/panthorium-zlib-build-');
const output = '/opt/zlib';
const digest = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
const run = (command, args, cwd = work, env = process.env) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit', timeout: 600000 });
const capture = (command, args, cwd = work) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 30000 }).trim();
const check = (filename, sha) => assert.equal(digest(fs.readFileSync(filename)), sha, `Integrity failure: ${filename}`);
assert.equal(lock.version, '1.3.1');
assert.equal(lock.debianPackageVersion, '1:1.3.dfsg+really1.3.1-1+panthorium1');
assert.equal(capture('dpkg', ['--print-architecture']), lock.runtimeAbi.architecture);
assert.equal(capture('gcc', ['-dumpmachine']), lock.runtimeAbi.multiarch);
fs.mkdirSync(output, { recursive: true });

async function download(item, filename) {
  assert.match(item.url, /^https:\/\/deb\.debian\.org\/debian\/pool\/main\/z\/zlib\/zlib_[^/]+$/);
  const response = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, `Source HTTP ${response.status}`);
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length; assert.ok(total <= 2000000, 'Source archive exceeds bound'); chunks.push(chunk);
  }
  fs.writeFileSync(filename, Buffer.concat(chunks)); check(filename, item.sha256);
}
const descriptor = path.join(work, 'source.dsc');
await download(lock.sourceDescriptor, descriptor);
for (const archive of lock.archives) {
  assert.equal(path.basename(archive.url), archive.file);
  assert.ok(fs.readFileSync(descriptor, 'utf8').includes(archive.sha256), 'Archive absent from pinned descriptor');
  const filename = path.join(work, archive.file);
  await download(archive, filename);
  const prefix = archive.file.endsWith('.orig.tar.gz') ? lock.archiveRoot : 'debian';
  for (const entry of capture('tar', ['-tf', filename]).split('\n')) {
    assert.ok((entry === prefix || entry.startsWith(prefix + '/')) && !entry.split('/').includes('..'));
  }
  assert.ok(!capture('tar', ['-tvf', filename]).split('\n').some(line => /^[lh]/.test(line)), 'Archive links forbidden');
  run('tar', ['-xf', filename, '--no-same-owner', '-C', prefix === 'debian' ? path.join(work, lock.archiveRoot) : work]);
}
const source = path.join(work, lock.archiveRoot);
assert.ok(fs.readFileSync(path.join(source, 'zlib.h'), 'utf8').includes('#define ZLIB_VERSION "1.3.1"'));
const series = fs.readFileSync(path.join(source, 'debian/patches/series'), 'utf8').split('\n')
  .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
assert.deepEqual(series, lock.debianPatchSeries, 'Debian patch baseline changed');
for (const name of series) {
  assert.match(name, /^[A-Za-z0-9_./+-]+$/); assert.ok(!name.split('/').includes('..'));
  run('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-i', path.join(source, 'debian/patches', name)], source);
}
for (const file of lock.patchedFiles) check(path.join(source, file.path), file.beforeSha256);
for (const patch of lock.patches) {
  check(path.join(directory, patch.upstreamPatchFile), patch.upstreamPatchSha256);
  const filename = path.join(directory, patch.file); check(filename, patch.sha256);
  run('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-i', filename], source);
}
for (const file of lock.patchedFiles) check(path.join(source, file.path), file.sha256);

const libraryDirectory = `/usr/lib/${lock.runtimeAbi.multiarch}`;
const buildFlags = {
  ...process.env, CC: 'gcc',
  CFLAGS: '-O2 -fPIC -Wall -D_REENTRANT -DUNALIGNED_OK -fstack-protector-strong -D_FORTIFY_SOURCE=2',
  LDFLAGS: '-Wl,-z,relro,-z,now', uname: 'GNU'
};
run('./configure', ['--shared', '--prefix=/usr', '--libdir=' + libraryDirectory], source, buildFlags);
run('make', ['-j', '2'], source, buildFlags);
// Only the unmodified upstream test suite is run; no custom CVE fixtures.
run('make', ['check'], source, buildFlags);
const library = path.join(source, lock.runtimeAbi.library);
assert.equal(fs.readFileSync(library).subarray(0, 4).toString('hex'), '7f454c46');
assert.ok(capture('readelf', ['-d', library]).includes(`[${lock.runtimeAbi.soname}]`), 'SONAME changed');
const symbols = capture('nm', ['-D', '--defined-only', library]).split('\n')
  .map(line => line.replace(/^[a-fA-F0-9]+ [A-Za-z] /, '')).sort().join('\n') + '\n';
assert.equal(digest(symbols), lock.runtimeAbi.exportedSymbolsSha256, 'Exported distro ABI changed');
const linked = capture('ldd', [library]);
assert.ok(!/not found|libubsan|libasan/i.test(linked));
assert.ok([...linked.matchAll(/^\s*([^ /\s]+)\s+=>/gm)].every(match => match[1] === 'libc.so.6'), 'Unexpected runtime dependency');
const dependencies = capture('dpkg-shlibdeps', ['-O', '-e' + library], source);
assert.match(dependencies, /^shlibs:Depends=libc6 \(>= [0-9.]+\)$/);

const root = path.join(work, 'package');
const libraryPath = `${libraryDirectory}/${lock.runtimeAbi.library}`;
fs.mkdirSync(path.dirname(root + libraryPath), { recursive: true });
fs.copyFileSync(library, root + libraryPath);
fs.symlinkSync(lock.runtimeAbi.library, root + libraryDirectory + '/' + lock.runtimeAbi.soname);
const manifest = {
  ...lock, architecture: lock.runtimeAbi.architecture,
  sourceLockSha256: digest(fs.readFileSync(path.join(directory, 'source.lock.json'))),
  library: { path: libraryPath, sha256: digest(fs.readFileSync(library)) },
  exportedSymbolsSha256: digest(symbols), linkedLibraries: linked,
  tests: ['unmodified upstream make check (static and shared)'],
  limitations: ['The specific error-recovery condition was reviewed statically; no custom vulnerability reproduction was run.']
};
const share = path.join(root, 'usr/local/share/panthorium'); fs.mkdirSync(share, { recursive: true });
fs.writeFileSync(path.join(share, 'zlib-source.json'), JSON.stringify(manifest, null, 2) + '\n');
const docs = path.join(root, 'usr/share/doc/zlib1g'); fs.mkdirSync(docs, { recursive: true });
fs.copyFileSync(path.join(source, 'debian/copyright'), path.join(docs, 'copyright'));
fs.copyFileSync(path.join(share, 'zlib-source.json'), path.join(docs, 'source-provenance.json'));
fs.mkdirSync(path.join(docs, 'patches'));
for (const patch of lock.patches) {
  for (const name of [patch.file, patch.upstreamPatchFile]) {
    fs.copyFileSync(path.join(directory, name), path.join(docs, 'patches', path.basename(name)));
  }
}
fs.mkdirSync(path.join(root, 'DEBIAN'));
fs.writeFileSync(path.join(root, 'DEBIAN/control'), `Package: zlib1g\nVersion: ${lock.debianPackageVersion}\nSource: zlib (${lock.debianPackageVersion})\nArchitecture: ${lock.runtimeAbi.architecture}\nMulti-Arch: same\nMaintainer: Panthorium\nSection: libs\nPriority: required\nDepends: ${dependencies.slice('shlibs:Depends='.length)}\nProvides: libz1\nConflicts: zlib1 (<= 1:1.0.4-7)\nBreaks: libxml2 (<< 2.7.6.dfsg-2), texlive-binaries (<< 2023.20230311.66589-8)\nDescription: zlib with reviewed Panthorium state-reset backport\n Upstream 1.3.1 and the Debian source baseline are retained.\n The local revision adds a hash-pinned gzwrite error-state reset.\n`);
fs.writeFileSync(path.join(root, 'DEBIAN/shlibs'), 'libz 1 zlib1g (>= 1:1.2.3.3.dfsg-1)\n');
fs.writeFileSync(path.join(root, 'DEBIAN/triggers'), 'activate-noawait ldconfig\n');
function regularFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = path.posix.join(prefix, entry.name);
    if (name === 'DEBIAN') return [];
    if (entry.isDirectory()) return regularFiles(path.join(directory, entry.name), name);
    return entry.isFile() ? [name] : [];
  });
}
fs.writeFileSync(path.join(root, 'DEBIAN/md5sums'), regularFiles(root)
  .map(name => digest(fs.readFileSync(path.join(root, name)), 'md5') + '  ' + name).join('\n') + '\n');
run('dpkg-deb', ['--root-owner-group', '--build', root, path.join(output, 'zlib1g-panthorium.deb')]);
fs.copyFileSync(path.join(share, 'zlib-source.json'), path.join(output, 'zlib-source.json'));
console.log(`Built ${lock.debianPackageVersion}; verified library SHA256 ${manifest.library.sha256}`);
