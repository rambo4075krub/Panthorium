// Preserve the complete Debian patch baseline, then add reviewed parser fixes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceLockBytes = fs.readFileSync(path.join(directory, 'source.lock.json'));
const lock = JSON.parse(sourceLockBytes);
const noble = process.argv[2] === '--ubuntu-noble';
assert.deepEqual(process.argv.slice(2), noble ? ['--ubuntu-noble'] : []);
const release = fs.readFileSync('/etc/os-release', 'utf8');
if (noble) {
  assert.match(release, /^ID=ubuntu$/m);
  assert.match(release, /^VERSION_ID="24\.04"$/m);
}
const minimumLibc = noble ? '2.39' : '2.41';
const work = fs.mkdtempSync('/tmp/panthorium-libsndfile-build-');
const output = '/opt/libsndfile';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const run = (cmd, args, cwd = work) => execFileSync(cmd, args, { cwd, stdio: 'inherit', timeout: 600000 });
const capture = (cmd, args, cwd = work) => execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout: 30000 }).trim();
const check = (file, sha) => assert.equal(digest(fs.readFileSync(file)), sha, `Integrity failure: ${file}`);
assert.equal(lock.version, '1.2.2');
assert.equal(lock.debianPackageVersion, '1.2.2-2+deb13u1+panthorium1');
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(output, { recursive: true });

for (const archive of lock.archives) {
  assert.match(archive.url, /^https:\/\/deb\.debian\.org\/debian\/pool\/main\/libs\/libsndfile\/libsndfile_[^/]+$/);
  assert.equal(path.basename(archive.url), archive.file);
  const response = await fetch(archive.url, { signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, `Source HTTP ${response.status}`);
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length; assert.ok(total <= 2000000, 'Source archive exceeds bound'); chunks.push(chunk);
  }
  const filename = path.join(work, archive.file);
  fs.writeFileSync(filename, Buffer.concat(chunks)); check(filename, archive.sha256);
  // Verified archives also have strict path and link constraints before extraction.
  const entries = capture('tar', ['-tf', filename]).split('\n');
  const prefix = archive.file.endsWith('.orig.tar.gz') ? lock.archiveRoot : 'debian';
  for (const entry of entries) assert.ok((entry === prefix || entry.startsWith(prefix + '/')) && !entry.split('/').includes('..'));
  assert.ok(!capture('tar', ['-tvf', filename]).split('\n').some(line => /^[lh]/.test(line)), 'Archive links forbidden');
  run('tar', ['-xf', filename, '--no-same-owner', '-C', prefix === 'debian' ? path.join(work, lock.archiveRoot) : work]);
}
const source = path.join(work, lock.archiveRoot);
assert.ok(fs.readFileSync(path.join(source, 'CMakeLists.txt'), 'utf8').includes('project(libsndfile VERSION 1.2.2)'));
const series = fs.readFileSync(path.join(source, 'debian/patches/series'), 'utf8').trim().split('\n');
assert.deepEqual(series, lock.debianPatchSeries, 'Debian patch baseline changed');
for (const name of series) {
  assert.match(name, /^[A-Za-z0-9_./+-]+$/); assert.ok(!name.split('/').includes('..'));
  run('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-i', path.join(source, 'debian/patches', name)], source);
}
for (const patch of lock.patches) {
  const filename = path.join(directory, patch.file); check(filename, patch.sha256);
  run('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-i', filename], source);
}
for (const file of lock.patchedFiles) check(path.join(source, file.path), file.sha256);

function buildAndTest(name, sanitizer) {
  const build = path.join(work, name);
  const flags = sanitizer ? ['-fsanitize=undefined', '-fno-sanitize-recover=all', '-g']
    : ['-O2', '-fstack-protector-strong', '-D_FORTIFY_SOURCE=2'];
  run('cmake', ['-S', source, '-B', build, ...lock.configure, '-DCMAKE_C_FLAGS=' + flags.join(' '), '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,relro,-z,now']);
  run('cmake', ['--build', build, '-j', '2']);
  const parser = path.join(build, 'parser-regression');
  run('gcc', [...flags, '-I', path.join(source, 'include'), path.join(directory, 'parser-regression.c'), '-L', build, '-Wl,-rpath,' + build, '-lsndfile', '-o', parser]);
  for (const name of ['mat4-invalid', 'mat4-valid', 'ima-read']) run(parser, [name]);
  const close = path.join(build, 'ima-close-regression');
  run('gcc', [...flags, '-ffunction-sections', '-fdata-sections', '-Wl,--gc-sections', '-I', path.join(source, 'include'), '-I', path.join(source, 'src'), '-I', path.join(build, 'src'), path.join(directory, 'ima-close-regression.c'), '-o', close]);
  run(close, []);
  return build;
}
// Sanitizer runtimes/build artifacts never enter the packaged application image.
buildAndTest('sanitized', true);
const maintainerTests = path.join(work, 'maintainer-tests');
run('cmake', ['-S', source, '-B', maintainerTests, ...lock.configure, '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_TESTING=ON']);
run('cmake', ['--build', maintainerTests, '-j', '2']);
run('ctest', ['--test-dir', maintainerTests, '--output-on-failure', '-j', '2']);
const build = buildAndTest('release', false);
const library = path.join(build, 'libsndfile.so.1.0.37');
assert.equal(fs.readFileSync(library).subarray(0, 4).toString('hex'), '7f454c46');
const linked = capture('ldd', [library]);
assert.ok(!/not found|libubsan|libasan/i.test(linked));
const libraries = [...linked.matchAll(/^\s*([^ /\s]+)\s+=>/gm)].map(match => match[1]);
assert.ok(libraries.every(name => ['libc.so.6', 'libm.so.6'].includes(name)), `Unexpected library: ${linked}`);

const architecture = capture('dpkg', ['--print-architecture']);
const multiarch = capture('gcc', ['-dumpmachine']);
assert.match(architecture, /^[a-z0-9]+$/); assert.match(multiarch, /^[a-z0-9_-]+$/);
const root = path.join(work, 'package');
const libraryPath = `/usr/lib/${multiarch}/libsndfile.so.1.0.37`;
fs.mkdirSync(path.dirname(root + libraryPath), { recursive: true });
fs.copyFileSync(library, root + libraryPath);
fs.symlinkSync('libsndfile.so.1.0.37', path.join(path.dirname(root + libraryPath), 'libsndfile.so.1'));
const share = path.join(root, 'usr/local/share/panthorium'); fs.mkdirSync(share, { recursive: true });
const manifest = { ...lock, sourceLockSha256: digest(sourceLockBytes), architecture, library: { path: libraryPath, sha256: digest(fs.readFileSync(library)) }, linkedLibraries: linked, tests: ['UBSan MAT4 invalid/valid', 'UBSan IMA read/close', 'upstream CTest suite', 'release MAT4 invalid/valid', 'release IMA read/close'] };
fs.writeFileSync(path.join(share, 'libsndfile-source.json'), JSON.stringify(manifest, null, 2) + '\n');
const docs = path.join(root, 'usr/share/doc/libsndfile1'); fs.mkdirSync(docs, { recursive: true });
fs.copyFileSync(path.join(source, 'debian/copyright'), path.join(docs, 'copyright'));
fs.writeFileSync(path.join(docs, 'source-provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.mkdirSync(path.join(docs, 'patches'));
for (const patch of lock.patches) fs.copyFileSync(path.join(directory, patch.file), path.join(docs, 'patches', path.basename(patch.file)));
fs.mkdirSync(path.join(root, 'DEBIAN'));
fs.writeFileSync(path.join(root, 'DEBIAN/control'), `Package: libsndfile1\nVersion: ${lock.debianPackageVersion}\nSource: libsndfile (${lock.debianPackageVersion})\nArchitecture: ${architecture}\nMulti-Arch: same\nMaintainer: Panthorium\nSection: libs\nPriority: optional\nDepends: libc6 (>= ${minimumLibc})\nDescription: Panthorium reviewed libsndfile build\n Preserves the Debian security baseline and adds hash-pinned parser backports.\n External codecs and command-line programs are disabled.\n`);
function regularFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = path.posix.join(prefix, entry.name);
    if (name === 'DEBIAN') return [];
    if (entry.isDirectory()) return regularFiles(path.join(directory, entry.name), name);
    return entry.isFile() ? [name] : [];
  });
}
const sums = regularFiles(root).map(name => crypto.createHash('md5').update(fs.readFileSync(path.join(root, name))).digest('hex') + '  ' + name);
fs.writeFileSync(path.join(root, 'DEBIAN/md5sums'), sums.join('\n') + '\n');
run('dpkg-deb', ['--root-owner-group', '--build', root, path.join(output, 'libsndfile1-panthorium.deb')]);
fs.copyFileSync(path.join(share, 'libsndfile-source.json'), path.join(output, 'libsndfile-source.json'));
console.log(`Built ${lock.debianPackageVersion}; verified library SHA256 ${manifest.library.sha256}`);
