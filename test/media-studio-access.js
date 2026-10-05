const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { AuthService } = require('../services/authService');
const { MediaStudioService, isAccountUser, normalizeSrt, MediaStudioError } = require('../services/mediaStudioService');
const { createMediaStudioRouter } = require('../routes/mediaStudio');
const catalog = require('../voice-window-catalog');

(async () => {
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'media-studio-access-test-secret', accessTokenTtl: '1h' }, audit });
  const adminId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const admin = { id: adminId, sub: adminId, roles: ['administrator'], permissions: ['chat', 'settings', 'system:read'] };
  const user = { id: userId, sub: userId, roles: [], permissions: ['chat', 'system:read'] };
  const guest = auth.guest().principal;
  const mediaId = crypto.randomUUID();
  assert.equal(isAccountUser(admin), true);
  assert.equal(isAccountUser(user), true, 'registered User accounts can use account-scoped media features');
  assert.equal(isAccountUser(guest), false, 'Guest has no private Cloud Files account');

  const mediaApp = catalog.apps.find(app => app.id === 'media-studio');
  const browserApp = catalog.apps.find(app => app.id === 'browser');
  for (const app of [mediaApp, browserApp]) {
    assert.equal(catalog.allowed(app, admin), true, app.id + ' is available to Admin');
    assert.equal(catalog.allowed(app, user), true, app.id + ' is available to User');
    assert.equal(catalog.allowed(app, guest), false, app.id + ' is hidden from Guest');
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panthorium-media-test-'));
  const owners = [];
  let listCalls = 0;
  const files = {
    async list(userId) { owners.push(userId); listCalls += 1; return { files: [{ id: mediaId, name: 'sample.mp4', contentType: 'video/mp4', size: 3 }] }; },
    async download(userId, fileId) { owners.push(userId); assert.equal(fileId, mediaId); return { id: fileId, name: 'sample.mp4', contentType: 'video/mp4', body: Buffer.from('vid') }; },
    async upload(userId, name, contentType, body) { owners.push(userId); return { id: crypto.randomUUID(), name, contentType, size: body.length }; }
  };
  const providerCalls = [];
  const providers = { async transcribeAudio(audio, contentType, language) { providerCalls.push({ audio: audio.length, contentType, language }); return { text: 'สวัสดี Panthorium', provider: 'test-provider' }; } };
  const runner = async (binary, args) => {
    if (binary === 'ffprobe-test') return { stdout: '5' };
    await fs.writeFile(args.at(-1), Buffer.from(args.includes('libopus') ? 'ogg-audio' : 'rendered-mp4'));
    return { stdout: '', stderr: '' };
  };
  const service = new MediaStudioService({ files, providers, audit, runner, tempRoot, ffmpeg: 'ffmpeg-test', ffprobe: 'ffprobe-test' });
  try {
    await assert.rejects(() => service.videoFiles(guest), error => error instanceof MediaStudioError && error.status === 403);
    assert.equal(listCalls, 0, 'Guest denial happens before reading Cloud Files');

    const result = await service.transcribe({ user, fileId: mediaId, language: 'th' });
    assert.equal(result.text, 'สวัสดี Panthorium');
    assert.equal(providerCalls[0].language, 'th-TH');
    assert.equal(owners.every(owner => owner === user.sub), true, 'all source and output file calls are account scoped');

    const rendered = await service.render({ user: admin, fileId: mediaId, startSeconds: 0, endSeconds: 3, captionsSrt: '1\n00:00:00,000 --> 00:00:02,000\nHello <b>world</b>', aspect: 'vertical' });
    assert.equal(rendered.ok, true);
    assert.equal(rendered.captionsIncluded, true);
    assert.equal(rendered.aspect, 'vertical');
    assert.equal(owners.at(-1), admin.sub, 'Admin output stays in Admin Cloud Files');

    const normalized = normalizeSrt('1\n00:00:00,000 --> 00:00:02,000\nHello <b>world</b>', 3);
    assert.match(normalized, /Hello world/);
    assert.doesNotMatch(normalized, /<b>/);
    assert.throws(() => normalizeSrt('1\n00:00:00,000 --> 00:00:09,000\nNo', 3), error => error.code === 'caption_time_out_of_range');

    const app = express(); app.use(express.json());
    app.use('/api/media', createMediaStudioRouter(auth, service));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const getFiles = principal => fetch(base + '/api/media/files', { headers: principal ? { Authorization: 'Bearer ' + auth.signAccessToken(principal) } : {} });
    try {
      assert.equal((await getFiles(null)).status, 401, 'unauthenticated request is denied');
      assert.equal((await getFiles(admin)).status, 200, 'Admin route works');
      assert.equal((await getFiles(user)).status, 200, 'standard User route works without settings permission');
      assert.equal((await getFiles(guest)).status, 403, 'Guest route is denied');
      assert.equal((await fetch(base + '/api/media/transcribe', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.signAccessToken(guest), 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: mediaId }) })).status, 403);
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log('Media Studio: Admin and User can process only their own Cloud Files; Guest and anonymous access are denied');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
