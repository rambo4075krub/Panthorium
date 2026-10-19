'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MediaStudioService } = require('../services/mediaStudioService');

(async () => {
  const user = { sub: randomUUID(), roles: [], permissions: ['chat'] };
  const sourceId = randomUUID(), foreignId = randomUUID();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ0AAAAASUVORK5CYII=', 'base64');
  let body = png, contentType = 'image/png', calls = 0, prompts = 0;
  const service = new MediaStudioService({
    files: {
      bucket: 'test-private', ensureConfigured() {},
      async download(owner, id) {
        assert.equal(owner, user.sub);
        if (id !== sourceId) throw Object.assign(new Error('file_not_found'), { code: 'file_not_found', status: 404 });
        return { id, body, contentType };
      }
    },
    providers: { vertex: { project: 'test-project' }, vertexPublisherConfigured: () => true, vertexAccessToken: async () => 'test-token' },
    gateway: { complete: async () => { prompts++; return { ok: true, text: 'Animate this image with a slow camera movement.' }; } },
    jobSecret: 'image-to-video-test-only',
    vertexFetch: async (url, options) => {
      calls++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.instances[0].image.mimeType, 'image/png');
      assert.equal(payload.instances[0].image.bytesBase64Encoded, png.toString('base64'));
      assert.equal(payload.parameters.sampleCount, 1);
      assert.equal(payload.parameters.durationSeconds, 4);
      return { ok: true, json: async () => ({ name: 'projects/test-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/owned-image' }) };
    }
  });
  const request = { user, prompt: 'ทำให้รูปนี้เคลื่อนไหว', durationSeconds: 4, confirmed: true, sourceFileId: sourceId };
  await assert.rejects(service.startGeneration({ ...request, confirmed: false }), /generation_confirmation_required/);
  await assert.rejects(service.startGeneration({ ...request, sourceFileId: foreignId }), /file_not_found/);
  await assert.rejects(service.startGeneration({ ...request, sourceFileId: 'https://example.test/image.png' }), /invalid_source_file_id/);
  body = Buffer.from('<script>bad</script>');
  await assert.rejects(service.startGeneration(request), /video_source_image_required/);
  body = png; contentType = 'image/svg+xml';
  await assert.rejects(service.startGeneration(request), /video_source_image_required/);
  assert.equal(prompts, 0, 'invalid and cross-account sources fail before paid prompt preparation');
  assert.equal(calls, 0, 'invalid sources never submit to Veo');
  contentType = 'image/png';
  const result = await service.startGeneration(request);
  assert.equal(result.status, 'running');
  assert.equal(calls, 1);
  assert.equal(prompts, 1);
  const job = service.readGenerationJob(result.jobToken, user.sub);
  assert.match(job.operationName, /owned-image$/);
  const expired = service.signGenerationJob({ ...job, expiresAt: Date.now() - 3600000 });
  assert.throws(() => service.readGenerationJob(expired, user.sub), /generation_job_expired/);
  assert.equal(service.readGenerationJob(expired, user.sub, { allowExpired: true }).jobId, job.jobId);
  assert.throws(() => service.readGenerationJob(expired, randomUUID(), { allowExpired: true }), /generation_job_forbidden/);
  assert.throws(() => service.readGenerationJob(expired + 'tampered', user.sub, { allowExpired: true }), /invalid_generation_job/);
  console.log('PASS owned image → video provider request; unauthorized/malformed sources blocked before generation');
})().catch(error => { console.error(error); process.exitCode = 1; });
