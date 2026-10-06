const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { AuthService } = require('../services/authService');
const { MediaStudioService, isAccountUser, normalizeSrt, MediaStudioError } = require('../services/mediaStudioService');
const { createMediaStudioRouter } = require('../routes/mediaStudio');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const catalog = require('../voice-window-catalog');

(async () => {
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'media-studio-access-test-secret', accessTokenTtl: '1h' }, audit });
  const adminId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const admin = { id: adminId, sub: adminId, roles: ['administrator'], permissions: ['chat', 'settings', 'system:read'] };
  const user = { id: userId, sub: userId, roles: [], permissions: ['chat', 'system:read'] };
  const otherUser = { id: otherUserId, sub: otherUserId, roles: [], permissions: ['chat'] };
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
  const saved = new Map();
  let listCalls = 0;
  const files = {
    bucket: 'panthorium-test-files',
    ensureConfigured() {},
    async list(userId) { owners.push(userId); listCalls += 1; return { files: [{ id: mediaId, name: 'sample.mp4', contentType: 'video/mp4', size: 3 }, ...(saved.get(userId) || [])] }; },
    async download(userId, fileId) { owners.push(userId); assert.equal(fileId, mediaId); return { id: fileId, name: 'sample.mp4', contentType: 'video/mp4', body: Buffer.from('vid') }; },
    async upload(userId, name, contentType, body) { owners.push(userId); const file = { id: crypto.randomUUID(), name, contentType, size: body.length }; saved.set(userId, [...(saved.get(userId) || []), file]); return file; }
  };
  const providerCalls = [];
  const providers = {
    vertex: { project: 'panthorium-test-project' },
    vertexConfigured() { return true; },
    async vertexAccessToken() { return 'test-access-token'; },
    async transcribeAudio(audio, contentType, language) { providerCalls.push({ audio: audio.length, contentType, language }); return { text: 'สวัสดี Panthorium', provider: 'test-provider' }; }
  };
  const gateway = { async complete({ sessionId }) {
    if (String(sessionId).startsWith('media-edit-plan:')) return { ok: true, text: JSON.stringify({ startSeconds: 1, endSeconds: 4, aspect: 'vertical', captionsSrt: '', name: 'planned-clip.mp4', summary: 'เลือกช่วง 1 ถึง 4 วินาที' }), provider: 'test-sentinel', model: 'sentinel-test' };
    if (String(sessionId).startsWith('media-video-prompt:')) return { ok: true, text: 'Cinematic close-up of a steaming cup of coffee at sunrise, warm amber light, slow camera push-in.', provider: 'test-sentinel', model: 'sentinel-test' };
    throw new Error('unexpected gateway session');
  } };
  const runner = async (binary, args) => {
    if (binary === 'ffprobe-test') return { stdout: '5' };
    await fs.writeFile(args.at(-1), Buffer.from(args.includes('libopus') ? 'ogg-audio' : 'rendered-mp4'));
    return { stdout: '', stderr: '' };
  };
  let pollCount = 0;
  const vertexRequests = [];
  const vertexFetch = async (url, options) => {
    vertexRequests.push({ url, body: JSON.parse(options.body) });
    if (url.includes(':predictLongRunning')) return { ok: true, status: 200, async json() { return { name: 'projects/panthorium-test-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/op_test-1' }; } };
    pollCount += 1;
    if (pollCount === 1) return { ok: true, status: 200, async json() { return { done: false }; } };
    return { ok: true, status: 200, async json() { return { done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from('generated-mp4').toString('base64') }] } }; } };
  };
  const service = new MediaStudioService({ files, providers, gateway, audit, jobSecret: 'media-studio-job-test-secret', vertexFetch, runner, tempRoot, ffmpeg: 'ffmpeg-test', ffprobe: 'ffprobe-test' });
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

    const planned = await service.planEdit({ user, fileId: mediaId, instruction: 'ทำเป็นคลิปแนวตั้งช่วงที่พูดถึงสินค้า' });
    assert.equal(planned.plan.startSeconds, 1);
    assert.equal(planned.plan.endSeconds, 4);
    assert.equal(planned.plan.aspect, 'vertical');
    const aiEdited = await service.aiEdit({ user, fileName: 'sample.mp4', instruction: 'ตัดเป็นคลิปสั้นแนวตั้ง' });
    assert.equal(aiEdited.file.contentType, 'video/mp4');
    assert.equal(owners.at(-1), user.sub, 'AI edit output remains in the current user Cloud Files');

    await assert.rejects(() => service.startGeneration({ user, prompt: 'กาแฟยามเช้า', confirmed: false }), error => error instanceof MediaStudioError && error.code === 'generation_confirmation_required');
    const generation = await service.startGeneration({ user, prompt: 'กาแฟดริปที่เชียงใหม่ยามเช้า', durationSeconds: 4, aspectRatio: '9:16', confirmed: true });
    assert.equal(generation.status, 'running');
    assert.match(generation.prompt, /Cinematic close-up/);
    assert.equal(vertexRequests[0].body.parameters.aspectRatio, '9:16');
    assert.equal(vertexRequests[0].body.parameters.durationSeconds, 4);
    assert.equal('storageUri' in vertexRequests[0].body.parameters, false, 'Veo output is returned to the server for direct import to account Cloud Files');
    assert.equal((await service.generationStatus({ user, jobToken: generation.jobToken })).status, 'running');
    await assert.rejects(() => service.generationStatus({ user: otherUser, jobToken: generation.jobToken }), error => error instanceof MediaStudioError && error.code === 'generation_job_forbidden');
    const finished = await service.generationStatus({ user, jobToken: generation.jobToken });
    assert.equal(finished.status, 'completed');
    assert.equal(finished.file.contentType, 'video/mp4');
    assert.ok(finished.file.name.endsWith('.mp4'));
    assert.equal(owners.at(-1), user.sub, 'generated output is uploaded only to the requesting account');
    const completedAgain = await service.generationStatus({ user, jobToken: generation.jobToken });
    assert.equal(completedAgain.file.id, finished.file.id, 'polling a completed generation does not create duplicate Cloud Files');

    const registry = new ToolRegistry({ mediaStudio: service });
    const aiEditTool = registry.get('media.video.ai_edit');
    const generateTool = registry.get('media.video.generate');
    assert.equal(aiEditTool.requiresConfirmation, true);
    assert.equal(aiEditTool.mutates, true);
    assert.equal(generateTool.requiresConfirmation, true);
    const agent = new AgentService({ tools: registry, audit });
    const unconfirmed = await agent.execute({ user, toolId: 'media.video.generate', args: { prompt: 'กาแฟยามเช้า' } });
    assert.equal(unconfirmed.error, 'confirmation_required', 'Sentinel cannot start paid video generation before explicit confirmation');

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
      assert.equal((await fetch(base + '/api/media/capabilities', { headers: { Authorization: 'Bearer ' + auth.signAccessToken(user) } })).status, 200);
      const deniedPlan = await fetch(base + '/api/media/plan-edit', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.signAccessToken(guest), 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: mediaId, instruction: 'ตัดต่อ' }) });
      assert.equal(deniedPlan.status, 403, 'Guest cannot request AI plans against Cloud Files');
      const unconfirmedGeneration = await fetch(base + '/api/media/generate', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.signAccessToken(user), 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'กาแฟยามเช้า' }) });
      assert.equal(unconfirmedGeneration.status, 409, 'API generation requires an explicit confirmation flag');
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log('Media Studio: Admin and User can process only their own Cloud Files; Guest and anonymous access are denied');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
