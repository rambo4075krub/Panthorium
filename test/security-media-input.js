'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { MediaStudioService, runProcess } = require('../services/mediaStudioService');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'media-input-security-'));
  const user = { sub: crypto.randomUUID(), roles: [], permissions: ['chat'] };
  const fileId = crypto.randomUUID();
  let source, uploads = 0, transcriptions = 0, requests = 0;
  const server = http.createServer((req, res) => { requests += 1; res.writeHead(404); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const files = {
    async readOwned(owner, id) { assert.equal(owner, user.sub); assert.equal(id, fileId); return source; },
    async upload(owner, name, contentType, body) {
      assert.equal(owner, user.sub); assert.ok(body.length); uploads += 1;
      return { id: crypto.randomUUID(), name, contentType, size: body.length };
    }
  };
  const service = new MediaStudioService({ files, tempRoot: directory,
    providers: { async transcribeAudio() { transcriptions += 1; return { text: 'local smoke test' }; } } });
  try {
    // Actual encoders/probes, including format families advertised in the UI.
    const fixtures = [
      ['mp4', 'libx264', 'aac'], ['mov', 'libx264', 'aac'],
      ['webm', 'libvpx-vp9', 'libopus'], ['mkv', 'ffv1', 'pcm_s16le'],
      ['mpg', 'mpeg2video', 'mp2'], ['ogv', 'libtheora', 'libvorbis'],
      ['3gp', 'h263', 'aac']
    ];
    for (const [extension, videoCodec, audioCodec] of fixtures) {
      const output = path.join(directory, 'valid.' + extension);
      await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x96:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.6',
        '-threads', '1', '-c:v', videoCodec, '-c:a', audioCodec, output], { timeoutMs: 20000 });
      assert.ok(await service.durationSeconds(output) > 0, extension + ' remains readable');
      // The MIME label is deliberately identical: decoder selection must use
      // ffprobe's validated format, not an attacker-provided name or MIME.
      source = { id: fileId, name: 'valid.' + extension, contentType: 'video/mp4', body: await fs.readFile(output) };
      assert.equal((await service.render({ user, fileId, startSeconds: 0, endSeconds: 0.4 })).ok, true, extension + ' renders');
      assert.equal((await service.transcribe({ user, fileId })).text, 'local smoke test', extension + ' transcribes');
    }
    assert.equal(uploads, fixtures.length); assert.equal(transcriptions, fixtures.length);

    const localUrl = `http://127.0.0.1:${server.address().port}/segment.ts`;
    const dash = '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="static" mediaPresentationDuration="PT1S" minBufferTime="PT1S"><Period duration="PT1S"><AdaptationSet mimeType="video/mp4"><Representation id="0" bandwidth="10000" width="128" height="96" codecs="avc1.42c01e"><SegmentTemplate timescale="1" duration="1" startNumber="1" initialization="' + localUrl + '" media="' + localUrl + '?segment=$Number$" /></Representation></AdaptationSet></Period></MPD>';
    const invalidInputs = [
      dash,
      '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n' + localUrl + '\n#EXT-X-ENDLIST\n',
      "ffconcat version 1.0\nfile '" + path.join(directory, 'valid.mp4') + "'\n",
      '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n' + path.join(directory, 'valid.mp4') + '\n#EXT-X-ENDLIST\n',
      'not a media container'
    ];
    for (const text of invalidInputs) {
      // MIME and filename match video; content must still be denied.
      source = { id: fileId, name: 'untrusted.mp4', contentType: 'video/mp4', body: Buffer.from(text) };
      await assert.rejects(service.render({ user, fileId, startSeconds: 0, endSeconds: 0.4 }),
        error => error.status === 422, 'playlist or malformed content cannot reach decoding');
      await assert.rejects(service.transcribe({ user, fileId }), error => error.status === 422);
    }
    assert.equal(requests, 0, 'playlist input cannot make even a loopback network request');
    assert.equal(uploads, fixtures.length, 'invalid inputs produce no output');
    assert.equal(transcriptions, fixtures.length, 'invalid inputs never reach transcription provider');

    for (const metadata of [
      { format: { duration: '1', format_name: 'mov' }, streams: [{ codec_type: 'video', width: 16384, height: 16384 }] },
      { format: { duration: '90000', format_name: 'mov' }, streams: [{ codec_type: 'video', width: 640, height: 360 }] },
      { format: { duration: '1', format_name: 'mov' }, streams: [{ codec_type: 'audio', channels: 2, sample_rate: '48000' }] },
      { format: { duration: '1', format_name: 'dash' }, streams: [{ codec_type: 'video', width: 640, height: 360 }] }
    ]) {
      const bounded = new MediaStudioService({ runner: async () => ({ stdout: JSON.stringify(metadata) }) });
      await assert.rejects(bounded.durationSeconds('unused'), error => [413, 422].includes(error.status));
    }
    console.log('Media input security: 7 container formats, render/transcribe, playlist and network denial, metadata bounds passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
