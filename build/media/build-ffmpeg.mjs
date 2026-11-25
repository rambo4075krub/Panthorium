// Build only reviewed release bytes and the reviewed upstream backport.
// The final image contains this provenance and actual binary hashes for its SBOM.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const lockName = process.argv[2] || 'ffmpeg-source.lock.json';
if (!['ffmpeg-source.lock.json', 'ffmpeg-speaker-source.lock.json'].includes(lockName)) {
  throw new Error('Unexpected FFmpeg build profile');
}
const lock = JSON.parse(fs.readFileSync(path.join(directory, lockName)));
const work = '/tmp/panthorium-ffmpeg-build';
const installed = '/opt/ffmpeg';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function checkFile(filename, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || hash(fs.readFileSync(filename)) !== expected) {
    throw new Error(`Integrity check failed: ${filename}`);
  }
}
function run(command, args, cwd = work) {
  execFileSync(command, args, { cwd, stdio: 'inherit', timeout: 35 * 60 * 1000 });
}

if (lock.name !== 'ffmpeg' || lock.version !== '9.1' ||
    !/^https:\/\/github\.com\/FFmpeg\/FFmpeg\/archive\/[a-f0-9]{40}\.tar\.gz$/.test(lock.source.url) ||
    lock.source.archiveRoot !== `FFmpeg-${lock.source.gitCommit}`) {
  throw new Error('Unexpected FFmpeg source lock');
}
fs.mkdirSync(work, { recursive: true });
const archive = path.join(work, 'source.tar.gz');
const response = await fetch(lock.source.url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`FFmpeg download returned HTTP ${response.status}`);
const chunks = [];
let total = 0;
for await (const chunk of response.body) {
  total += chunk.length;
  if (total > 40_000_000) throw new Error('FFmpeg source archive exceeds limit');
  chunks.push(chunk);
}
fs.writeFileSync(archive, Buffer.concat(chunks));
checkFile(archive, lock.source.sha256);

const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
for (const entry of entries.trim().split('\n')) {
  if (!entry.startsWith(lock.source.archiveRoot + '/') || entry.split('/').includes('..')) {
    throw new Error('Unexpected path in verified source archive');
  }
}
run('tar', ['-xzf', archive, '--no-same-owner']);
const source = path.join(work, lock.source.archiveRoot);
if (fs.readFileSync(path.join(source, 'RELEASE'), 'utf8').trim() !== lock.version) {
  throw new Error('Source release version differs from lock');
}
for (const patch of lock.patches) {
  const patchPath = path.join(directory, patch.file);
  checkFile(patchPath, patch.sha256);
  run('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-i', patchPath], source);
  for (const file of patch.patchedFiles) checkFile(path.join(source, file.path), file.sha256);
}
run('./configure', lock.configure, source);
const configuration = Object.fromEntries(['config.h', 'config_components.h'].map(name => [name, fs.readFileSync(path.join(source, name), 'utf8')]));
const macros = Object.fromEntries(Object.values(configuration).flatMap(text => [...text.matchAll(/^#define (CONFIG_[A-Z0-9_]+) ([01])$/gm)].map(match => [match[1], Number(match[2])])));
for (const [cve, names] of Object.entries(lock.excludedComponents)) {
  for (const name of names) {
    if (macros[name] !== 0) throw new Error(`${cve}: excluded component ${name} was not disabled`);
  }
}
// Keep CI memory usage bounded; adding more cores is not needed for this build.
run('make', ['-j2'], source);
run('make', ['install'], source);

const share = path.join(installed, 'share/panthorium');
fs.mkdirSync(path.join(share, 'ffmpeg-patches'), { recursive: true });
if (lockName === 'ffmpeg-source.lock.json') {
  const flags = execFileSync('pkg-config', ['--libs', '--static', 'libavcodec', 'libavutil'], {
    encoding: 'utf8', env: { ...process.env, PKG_CONFIG_PATH: `${installed}/lib/pkgconfig` }
  }).trim().split(/\s+/);
  const regression = path.join(work, 'test-encoder-geometry');
  run('cc', [`-I${installed}/include`, path.join(directory, 'test-encoder-geometry.c'), '-o', regression, ...flags]);
  const output = execFileSync(regression, [], { encoding: 'utf8', timeout: 30000 });
  fs.writeFileSync(path.join(share, 'ffmpeg-encoder-regression.log'), output);
  console.log(output.trim());
}
const manifest = { ...lock, binaries: {} };
const objects = execFileSync('ar', ['t', path.join(source, 'libavcodec/libavcodec.a')], { encoding: 'utf8' }).trim().split('\n').sort();
if (objects.some(name => /^(?:vaapi_hevc|vdpau_hevc|dxva2_hevc|ffv1enc_vulkan|vulkan_decode|lcevcdec)\.o$/.test(name))) {
  throw new Error('Excluded vulnerable component entered the codec archive');
}
manifest.compilation = {
  configuration: Object.fromEntries(Object.entries(configuration).map(([name, text]) => [name, hash(Buffer.from(text))])),
  excludedMacros: Object.fromEntries([...new Set(Object.values(lock.excludedComponents).flat())].sort().map(name => [name, macros[name]])),
  codecObjectsSha256: hash(Buffer.from(JSON.stringify(objects)))
};
for (const [name, content] of Object.entries(configuration)) fs.writeFileSync(path.join(share, `ffmpeg-${name}`), content);
fs.writeFileSync(path.join(share, 'ffmpeg-codec-objects.json'), JSON.stringify(objects, null, 2) + '\n');
for (const binary of ['ffmpeg', 'ffprobe']) {
  const filename = path.join(installed, 'bin', binary);
  manifest.binaries[binary] = { path: `/usr/local/bin/${binary}`, sha256: hash(fs.readFileSync(filename)) };
  // Fail if a new external library silently entered the dependency chain.
  const linked = execFileSync('ldd', [filename], { encoding: 'utf8' });
  if (/not found|libcjson|librist|libasound|libpulse|libSDL|libvulkan|libcuda/i.test(linked)) {
    throw new Error(`Unexpected native dependency: ${linked}`);
  }
  fs.writeFileSync(path.join(share, `${binary}-linked-libraries.txt`), linked);
}
manifest.buildConfiguration = execFileSync(path.join(installed, 'bin/ffmpeg'), ['-buildconf'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
});
fs.writeFileSync(path.join(share, 'ffmpeg-source.json'), JSON.stringify(manifest, null, 2) + '\n');
const licenseFile = lock.license === 'GPL-2.0-or-later' ? 'COPYING.GPLv2'
  : lock.license === 'LGPL-2.1-or-later' ? 'COPYING.LGPLv2.1' : null;
if (!licenseFile) throw new Error('Unexpected FFmpeg license');
fs.copyFileSync(path.join(source, licenseFile), path.join(share, `ffmpeg-${licenseFile}`));
for (const patch of lock.patches) {
  fs.copyFileSync(path.join(directory, patch.file), path.join(share, 'ffmpeg-patches', path.basename(patch.file)));
}
console.log(`Built FFmpeg ${lock.version}; source and binary provenance: ${share}/ffmpeg-source.json`);
