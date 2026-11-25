'use strict';

const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const {PostgresCreativeStudioRepository} = require('../services/creativeStudioRepository');
const {FilmStudioService} = require('../services/filmStudioService');

// Only the external Gemini / Vertex responses are fixtures. Authentication, the project and job
// ledgers, dependency resolution, file storage, FFmpeg and the downloaded browser artifact are real.
async function fixture({studio, service, pool, dir}) {
  const clip = path.join(dir, 'fixture.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=s=96x64:c=blue:r=12',
    '-t',
    '4',
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
    clip
  ]);
  const video = (await fs.readFile(clip)).toString('base64');
  const image = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=s=48x48:c=red',
    '-frames:v',
    '1',
    '-threads',
    '1',
    '-c:v',
    'libwebp',
    '-f',
    'image2pipe',
    '-'
  ]).toString('base64');
  const calls = {images: [], video: [], plans: 0};
  const script = {
    characters: [{name: 'ดาว', description: 'ผมสั้น เสื้อสีเขียว'}],
    locations: [{name: 'สถานี', description: 'ชานชาลาริมทะเล'}],
    shots: [
      {
        characters: ['ดาว'],
        location: 'สถานี',
        action: 'ดาววิ่งตามรถไฟ',
        camera: 'ภาพกว้าง',
        emotion: 'กังวล',
        dialogue: 'รอด้วย',
        seconds: 4
      },
      {
        characters: ['ดาว'],
        location: 'สถานี',
        action: 'ดาวเปิดจดหมาย',
        camera: 'โคลสอัพ',
        emotion: 'ดีใจ',
        dialogue: '',
        seconds: 4
      }
    ]
  };
  const gateway = {
    complete: async (input) => {
      assert.equal(input.lockedProvider, 'gemini-live');
      if (input.sessionId.startsWith('film-plan:')) {
        calls.plans++;
        return {ok: true, text: JSON.stringify(script)};
      }
      return {ok: true, text: 'Animate the supplied image with the requested camera direction.'};
    }
  };
  const providers = {
    vertex: {project: 'film-fixture'},
    vertexPublisherConfigured: () => true,
    vertexAccessToken: async () => 'fixture'
  };
  const media = studio.mediaStudio;
  studio.gateway = gateway;
  media.gateway = gateway;
  studio.providers = providers;
  media.providers = providers;
  const json = (data) => ({ok: true, json: async () => data});
  studio.vertexFetch = async (_url, opts) => {
    const parts = JSON.parse(opts.body).contents[0].parts;
    calls.images.push(parts.slice(1).map((x) => x.inlineData.mimeType));
    return json({candidates: [{content: {parts: [{inlineData: {mimeType: 'image/webp', data: image}}]}}]});
  };
  media.vertexFetch = async (url, opts) => {
    if (url.endsWith(':predictLongRunning')) {
      const data = JSON.parse(opts.body);
      calls.video.push(data.instances[0].image.mimeType);
      return json({
        name:
          'projects/film-fixture/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/' +
          randomUUID()
      });
    }
    assert(url.endsWith(':fetchPredictOperation'));
    return json({done: true, response: {videos: [{mimeType: 'video/mp4', bytesBase64Encoded: video}]}});
  };
  studio.repository = new PostgresCreativeStudioRepository({pool});
  await studio.init();
  return {film: new FilmStudioService(service, studio), calls};
}
async function verify({page, hub, owner, other, fixture: {film, calls}, service, pool, dir}) {
  const b = (name) => hub.getByRole('button', {name, exact: true});
  const user = {sub: owner, roles: ['user'], permissions: ['chat']};
  const otherUser = {...user, sub: other};
  await hub.locator('[data-tool="video"]').click();
  await b('สร้างหนังและซีรีส์').click();
  await b('สร้างโปรเจกต์ใหม่').click();
  await hub.getByLabel('ชื่อโปรเจกต์', {exact: true}).fill('รถไฟสายสุดท้าย');
  await hub.getByLabel('ประเภท', {exact: true}).selectOption('series');
  await hub.getByLabel('เนื้อเรื่อง', {exact: true}).fill('ดาววิ่งตามรถไฟและพบจดหมายเมื่อรถไฟออก');
  await hub.getByLabel('สัดส่วนภาพ', {exact: true}).selectOption('9:16');
  page.once('dialog', (d) => d.accept());
  await b('สร้างจากเรื่องจนจบเป็น MP4').click();
  await hub.getByText('บันทึกคำสั่งแล้ว', {exact: false}).waitFor();
  const draft = (await service.list(owner)).find((x) => x.kind === 'film');
  const p = await service.get(owner, draft.id),
    ep = p.body.episodes[0],
    target = 'episode:' + ep.id;
  assert.equal(ep.shots.length, 2);
  assert.equal(calls.plans, 1);
  const first = await film.state(user, p.id, ep.id);
  assert.equal(first.job.total, 7);
  await assert.rejects(film.state(otherUser, p.id, ep.id), /project_not_found/);
  await assert.rejects(
    film.produce(user, p.id, {episode: ep.id, requestId: randomUUID(), revision: p.revision, target}, true),
    /generation_confirmation_required/
  );
  // Close the browser workspace, then drive the same durable worker as production.
  await b('โปรเจกต์ทั้งหมด').click();
  for (let attempt = 0; attempt < 20; attempt++) {
    await pool.query('UPDATE panthorium_studio_jobs SET next_run_at=now() WHERE id=$1', [first.job.id]);
    await film.studio.tick();
    const state = await film.state(user, p.id, ep.id);
    if (state.job.status === 'completed') break;
    assert(['queued', 'running'].includes(state.job.status), JSON.stringify(state.job));
  }
  const completed = await film.state(user, p.id, ep.id);
  assert.equal(completed.job.status, 'completed');
  assert.equal(completed.assets[target].ready, true);
  assert.deepEqual(calls.images, [[], [], ['image/jpeg', 'image/jpeg'], ['image/jpeg', 'image/jpeg']]);
  assert.deepEqual(calls.video, ['image/jpeg', 'image/jpeg']);
  const finished = await film.studio.repository.get(owner, first.job.id);
  const retry = {
    requestId: finished.idempotencyKey.split(':').at(-1),
    episode: ep.id,
    target,
    revision: p.revision,
    auto: true,
    confirmed: true
  };
  assert.equal((await film.produce(user, p.id, retry, true)).job.id, first.job.id);
  const second = await film.produce(user, p.id, {...retry, requestId: randomUUID()}, false);
  assert.deepEqual(second.quote, {images: 0, videos: 0, assemble: false, limit: 10});
  await b('รถไฟสายสุดท้าย').click();
  await b('วิดีโอ').click();
  const finalCard = hub.locator('.film-card').first();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    finalCard.getByRole('button', {name: 'ดาวน์โหลด MP4'}).click()
  ]);
  const output = path.join(dir, 'downloaded-film.mp4');
  await download.saveAs(output);
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,width,height',
        '-of',
        'json',
        output
      ],
      {encoding: 'utf8'}
    )
  );
  assert(Math.abs(Number(probe.format.duration) - 8) < 0.15, JSON.stringify(probe));
  assert(probe.streams.some((s) => s.codec_name === 'h264' && s.width === 720 && s.height === 1280));
  await b('สตอรีบอร์ด').click();
  await hub.locator('.film-preview img').first().waitFor();
  await hub.getByLabel('อารมณ์และสีหน้า').nth(1).fill('โล่งใจ');
  await b('บันทึกโปรเจกต์').click();
  await hub.getByText('บันทึกโปรเจกต์แล้ว', {exact: true}).waitFor();
  const changed = await film.state(user, p.id, ep.id);
  assert(changed.assets['clip:' + ep.shots[0].id].ready);
  assert(!changed.assets['frame:' + ep.shots[1].id].ready);
  assert(!changed.assets[target].ready);
  const latest = await service.get(owner, p.id);
  const redo = {target, requestId: randomUUID(), revision: latest.revision, episode: ep.id};
  const quote = await film.produce(user, p.id, redo, false);
  assert.deepEqual(quote.quote, {images: 1, videos: 1, assemble: true, limit: 10});
  await assert.rejects(
    film.produce(user, p.id, {...redo, confirmed: true, token: 'old'}, true),
    /film_quote_changed/
  );
  await hub.getByLabel('อารมณ์และสีหน้า').nth(1).fill('ดีใจ');
  await b('บันทึกโปรเจกต์').click();
  await hub.getByText('บันทึกโปรเจกต์แล้ว', {exact: true}).waitFor();
  await b('เพิ่มตอน').click();
  await b('ตัวละคร').click();
  assert.equal(await hub.getByLabel('ชื่อตัวละคร', {exact: true}).inputValue(), 'ดาว');
  await b('บันทึกโปรเจกต์').click();
  await hub.getByText('บันทึกโปรเจกต์แล้ว', {exact: true}).waitFor();
  const unsavedPart = await service.get(owner, p.id);
  await assert.rejects(
    film.download(user, p.id, unsavedPart.revision, () => assert.fail('unfinished master')),
    /film_unfinished_parts/
  );
  await b('เนื้อเรื่อง').click();
  await hub.getByLabel('เนื้อเรื่อง', {exact: true}).fill('ดาวกลับมาที่สถานีพร้อมจดหมายฉบับที่สอง');
  page.once('dialog', (d) => d.accept());
  await b('สร้างจากเรื่องจนจบเป็น MP4').click();
  await hub.getByText('บันทึกคำสั่งแล้ว', {exact: false}).waitFor();
  const next = (await service.get(owner, p.id)).body.episodes[1];
  const batch = (await film.state(user, p.id, next.id)).job;
  assert.equal(batch.total, 5, 'two shared references skip generation for episode two');
  for (let i = 0; i < 12; i++) {
    await pool.query('UPDATE panthorium_studio_jobs SET next_run_at=now() WHERE id=$1', [batch.id]);
    await film.studio.tick();
    if ((await film.state(user, p.id, next.id)).job.status === 'completed') break;
  }
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  const [master] = await Promise.all([
    page.waitForEvent('download'),
    b('ดาวน์โหลดทั้งเรื่องเป็น MP4').click()
  ]);
  const masterPath = path.join(dir, 'full-movie.mp4');
  await master.saveAs(masterPath);
  const duration = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', masterPath],
      {encoding: 'utf8'}
    )
  );
  assert(Math.abs(duration - 16) < 0.2, 'master runtime: ' + duration);
  const endProject = await service.get(owner, p.id);
  const endState = await film.state(user, p.id, ep.id);
  await film.studio.files.remove(owner, endState.assets[target].file.id);
  const restoreQuote = await film.produce(
    user,
    p.id,
    {revision: endProject.revision, episode: ep.id, target, requestId: randomUUID()},
    false
  );
  assert.deepEqual(restoreQuote.quote, {images: 0, videos: 0, assemble: true, limit: 10});
  await page.setViewportSize({width: 390, height: 844});
  assert(await hub.evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
  await hub.getByText('ส่งออกภาพยนตร์ทั้งเรื่องแล้ว', {exact: true}).waitFor();
  await page.goto(new URL('/#film-studio', page.url()).href);
  await page.getByRole('button', {name: 'รถไฟสายสุดท้าย', exact: true}).waitFor();
  console.log(
    'Film studio: one-click Thai series, shared references, WebP conversion, real 8-second vertical episodes and 16-second MP4 master, selective retakes, replay, privacy and phone layout passed.'
  );
}
module.exports = {fixture, verify};
