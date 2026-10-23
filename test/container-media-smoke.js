'use strict';
// Run inside the final image, with no network or credentials:
// docker run --rm --network none --entrypoint node IMAGE test/container-media-smoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const host = process.argv.includes('--allow-host-ffmpeg');
assert(!host || !process.env.CI, 'Host-only development mode is forbidden in CI');
const fixtures = path.join(__dirname, 'fixtures/container-media');
const fixtureManifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json')));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let ffmpeg = 'ffmpeg', ffprobe = 'ffprobe';
function command(binary, args, options = {}) {
  return execFileSync(binary, args, { timeout: 45000, maxBuffer: 12 * 1024 * 1024, ...options });
}
function jsonProbe(file) {
  return JSON.parse(command(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
}
function videoInfo(file, width, height) {
  const info = jsonProbe(file);
  const video = info.streams.find(stream => stream.codec_type === 'video');
  assert(video, `Missing video: ${file}`);
  assert.equal(video.width, width);
  assert.equal(video.height, height);
  return info;
}

async function main() {
  if (!host) {
    assert(process.getuid() !== 0, 'Container must run as its nonroot runtime user');
    const manifest = JSON.parse(fs.readFileSync('/usr/local/share/panthorium/ffmpeg-source.json'));
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/media/ffmpeg-source.lock.json')));
    for (const key of ['name', 'version', 'source', 'patches', 'configure', 'purl', 'cpe']) {
      assert.deepEqual(manifest[key], lock[key], `Provenance mismatch: ${key}`);
    }
    ({ path: ffmpeg } = manifest.binaries.ffmpeg);
    ({ path: ffprobe } = manifest.binaries.ffprobe);
    for (const binary of [ffmpeg, ffprobe]) {
      assert.equal(digest(fs.readFileSync(binary)), manifest.binaries[path.basename(binary)].sha256);
      const version = command(binary, ['-version'], { encoding: 'utf8' });
      assert.match(version, /version 9\.0\.2(?:\s|$)/);
      const links = command('ldd', [binary], { encoding: 'utf8' });
      assert.doesNotMatch(links, /not found|libcjson|librist|libasound|libpulse|libSDL|libvulkan|libcuda/i);
      console.log(version.split('\n')[0]);
      console.log(links.trim());
    }
    const config = spawnSync(ffmpeg, ['-buildconf'], { encoding: 'utf8' });
    assert.equal(config.status, 0);
    // FFmpeg shell-quotes configure values containing commas/spaces in -buildconf.
    // Compare complete option lines after removing only those enclosing quotes.
    const configFlags = (config.stdout + config.stderr).split('\n').map(line => line.trim())
      .filter(line => line.startsWith('--')).map(line => line.replace(/^(--[^=]+=)(['"])(.*)\2$/, '$1$3'));
    for (const flag of lock.configure) assert(configFlags.includes(flag), `Missing ${flag}`);
    const protocols = command(ffmpeg, ['-hide_banner', '-protocols'], { encoding: 'utf8' });
    const names = protocols.split('\n').map(line => line.trim()).filter(line => /^[a-z0-9_]+$/.test(line));
    assert(names.length > 0);
    assert(names.every(name => ['file', 'pipe'].includes(name)), `Unexpected protocols: ${names}`);
    const packages = command('apk', ['info'], { encoding: 'utf8' }).split('\n');
    for (const forbidden of ['cjson', 'librist', 'alsa-lib', 'pulseaudio', 'sdl2']) assert(!packages.includes(forbidden));
    for (const binary of ['npm', 'npx', 'yarn', 'yarnpkg']) assert(!fs.existsSync(`/usr/local/bin/${binary}`));
    assert(!fs.existsSync('/usr/local/lib/node_modules/npm'));
    const thaiFont = command('fc-match', ['-f', '%{family}', ':lang=th'], { encoding: 'utf8' });
    assert.match(thaiFont, /Noto.*Thai/i, `Missing Thai font: ${thaiFont}`);
    const network = spawnSync(ffmpeg, ['-v', 'error', '-i', 'http://127.0.0.1:9/never', '-f', 'null', '-'], { encoding: 'utf8', timeout: 3000 });
    assert.equal(network.signal, null, 'Network input must fail immediately, not time out');
    assert.notEqual(network.status, 0);
    assert.match(network.stderr, /Protocol not found|not on whitelist/i);
  } else {
    console.log('DEVELOPMENT ONLY: host FFmpeg functional matrix; image/provenance checks skipped');
  }
  for (const [name, expected] of Object.entries(fixtureManifest.files)) {
    const bytes = fs.readFileSync(path.join(fixtures, name));
    assert.equal(bytes.length, expected.bytes);
    assert.equal(digest(bytes), expected.sha256, `Changed fixture: ${name}`);
  }

  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;
  const { MediaStudioService } = require('../services/mediaStudioService');
  const { StudioEditorService } = require('../services/studioEditorService');
  const { CreativeStudioService } = require('../services/creativeStudioService');
  const user = { sub: crypto.randomUUID(), roles: ['user'], permissions: ['chat'] };
  const stored = new Map();
  const files = {
    async upload(owner, name, contentType, body) {
      assert.equal(owner, user.sub);
      const file = { id: crypto.randomUUID(), name, contentType, body: Buffer.from(body), size: body.length };
      stored.set(file.id, file);
      return file;
    },
    async readOwned(owner, id) { assert.equal(owner, user.sub); assert(stored.has(id)); return stored.get(id); }
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'container-media-smoke-'));
  let extracted = 0;
  const media = new MediaStudioService({ files, ffmpeg, ffprobe, tempRoot: directory, providers: {
    async transcribeAudio(audio, type) {
      assert.equal(type, 'audio/ogg');
      const file = path.join(directory, `audio-${extracted++}.ogg`);
      fs.writeFileSync(file, audio);
      const stream = jsonProbe(file).streams[0];
      assert.equal(stream.codec_name, 'opus');
      assert.equal(stream.channels, 1);
      const pcm = command(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
      assert(pcm.length >= 16000 * 4 * 0.6 && pcm.length <= 16000 * 4 * 1.5, 'Audio duration/resampling changed');
      return { text: 'synthetic audio', provider: 'local-test' };
    }
  } });
  try {
    const types = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', mpg: 'video/mpeg', ogv: 'video/ogg', '3gp': 'video/3gpp' };
    let count = 0;
    for (const name of Object.keys(fixtureManifest.files)) {
      const type = types[path.extname(name).slice(1)];
      if (!type) continue;
      const source = await files.upload(user.sub, name, type, fs.readFileSync(path.join(fixtures, name)));
      const result = await media.render({ user, fileId: source.id, startSeconds: 0, endSeconds: 0.5 });
      const output = path.join(directory, `render-${count++}.mp4`);
      fs.writeFileSync(output, result.file.body);
      const info = videoInfo(output, 128, 96);
      assert(info.streams.some(stream => stream.codec_name === 'h264'));
      assert(info.streams.some(stream => stream.codec_name === 'aac'));
      assert(Number(info.format.duration) >= 0.4 && Number(info.format.duration) <= 1.0);
      await media.transcribe({ user, fileId: source.id });
      console.log(`PASS container render + audio extraction: ${name}`);
    }
    assert.equal(count, 8, 'All seven container families and both WebM codecs must run');

    const source = [...stored.values()].find(file => file.name === 'h264-aac.mp4');
    const captions = '1\n00:00:00,000 --> 00:00:00,450\nHello สวัสดีภาษาไทย\n';
    const plain = await media.render({ user, fileId: source.id, startSeconds: 0, endSeconds: 0.5 });
    const captioned = await media.render({ user, fileId: source.id, startSeconds: 0, endSeconds: 0.5, captionsSrt: captions });
    assert.notEqual(digest(plain.file.body), digest(captioned.file.body), 'Caption render did not change video');
    for (const [aspect, width, height] of [['vertical', 720, 1280], ['square', 1080, 1080], ['widescreen', 1280, 720]]) {
      const result = await media.render({ user, fileId: source.id, startSeconds: 0, endSeconds: 0.5, aspect, captionsSrt: captions });
      const output = path.join(directory, `${aspect}.mp4`);
      fs.writeFileSync(output, result.file.body);
      videoInfo(output, width, height);
    }
    console.log('PASS container aspect conversion and English/Thai captions');

    const editor = new StudioEditorService({ files });
    const creative = new CreativeStudioService({ files });
    for (const [extension, type] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']]) {
      const bytes = fs.readFileSync(path.join(fixtures, `pattern.${extension}`));
      await creative.validateGeneratedImage(bytes, type, extension);
      const source = await files.upload(user.sub, `pattern.${extension}`, type, bytes);
      const input = { edit: { fileId: source.id, revision: digest(bytes), operations: [
        { type: 'rotate', degrees: 90 }, { type: 'flip', axis: 'horizontal' },
        { type: 'brightness', amount: 0.1 }, { type: 'crop', x: 0, y: 0, width: 64, height: 64 }
      ] } };
      const result = await editor.apply({ user, pluginId: 'image', input });
      const output = path.join(directory, `${extension}-edited.png`);
      fs.writeFileSync(output, result.files[0].body);
      videoInfo(output, 64, 64);
      assert.equal(result.files[0].contentType, 'image/png');
      console.log(`PASS container image validation + edit: ${extension}`);
    }
    console.log(host
      ? 'PASS host functional preflight: 8 video/audio fixtures, captions and 3 image formats; target-image checks NOT run'
      : 'PASS container media smoke: native provenance, ELF links, local-only protocols, 8 video/audio fixtures, captions and 3 image formats');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
