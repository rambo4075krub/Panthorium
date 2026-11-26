'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const path = require('node:path');
const {normalizeFilm, sequenceSeconds} = require('../services/filmStudioModel');
const {analyze, rates} = require('../services/featureProduction');

async function verify({page, hub, owner, other, fixture: {film, calls}, service, pool, dir}) {
  film.studio.mediaStudio.tempRoot = dir;
  const button = (name) => hub.getByRole('button', {name, exact: true});
  const actor = {sub: owner, roles: ['user'], permissions: ['chat']};
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const api = (url, method = 'GET', body, type = 'application/json') =>
    page.evaluate(
      async ({url, method, body, type}) => {
        const resp = await fetch('/api/online-tools' + url, {
          method,
          headers: {Authorization: 'Bearer ' + OS.config.accessToken, 'Content-Type': type},
          ...(body ? {body: JSON.stringify(body)} : {})
        });
        return {status: resp.status, data: await resp.json()};
      },
      {url, method, body, type}
    );
  const save = async () => {
    await button('บันทึกโปรเจกต์').click();
    await hub.getByText('บันทึกโปรเจกต์แล้ว', {exact: true}).waitFor();
  };
  const projectByTitle = async (title) =>
    service.get(owner, (await service.list(owner)).find((x) => x.title === title).id);
  await button('สร้างหนังยาว 2–3 ชั่วโมง').click();
  await hub.getByLabel('ชื่อโปรเจกต์', {exact: true}).fill('แผนภาพยนตร์ 180 นาที');
  await hub.getByLabel('ความยาวเป้าหมาย').selectOption('180');
  assert(await hub.evaluate((n) => n.scrollWidth <= n.clientWidth + 1), 'mobile feature workspace fits');
  await hub.getByLabel('เรื่องย่อและความต่อเนื่อง').fill('พี่น้องกลับมาพบกันหลังจากแยกกันไปหลายปี');
  await hub.getByLabel('บทภาพยนตร์หลัก').fill('องก์แรก เปิดจดหมายจากบ้าน');
  await button('แบ่งโครงเป็น 3 องก์').click();
  await save();
  const outline = await projectByTitle('แผนภาพยนตร์ 180 นาที');
  assert.equal(outline.body.episodes.length, 169);
  assert.equal(
    outline.body.episodes.reduce((n, e) => n + e.plannedSeconds, 0),
    10800
  );
  assert.equal(new Set(outline.body.episodes.map((e) => e.act)).size, 3);
  await hub.getByLabel('กรองตามองก์').selectOption('3');
  await hub.getByLabel('เนื้อเรื่อง', {exact: true}).fill('สองพี่น้องกลับถึงบ้าน');
  await save();
  const updated = await service.get(owner, outline.id);
  assert(updated.body.episodes.find((e) => e.act === 3).story.includes('บ้าน'));
  // A feature draft larger than the generic 2 MB API can be saved through its authenticated delta route.
  const shot = () => ({
    id: randomUUID(),
    action: 'ก'.repeat(420),
    camera: '',
    emotion: '',
    dialogue: '',
    seconds: 4,
    characterIds: [],
    locationId: null
  });
  const seq = () => ({...updated.body.episodes[0], id: randomUUID(), shots: Array.from({length: 8}, shot)});
  const many = Array.from({length: 338}, seq);
  many.at(-1).shots.length = 4;
  const {episodes, ...meta} = updated.body;
  const payload = {
    title: updated.title,
    revision: updated.revision,
    meta,
    order: many.map((e) => e.id),
    changes: many
  };
  assert(Buffer.byteLength(JSON.stringify(payload)) > 2 * 1024 * 1024);
  assert.equal(
    (await api('/film/' + updated.id + '/draft', 'PUT', payload, 'application/vnd.panthorium.film+json'))
      .status,
    200
  );
  assert.equal(
    (await api('/film/' + updated.id + '/draft', 'PUT', payload, 'application/vnd.panthorium.film+json'))
      .status,
    409
  );
  const large = await service.get(owner, updated.id);
  assert.equal(
    large.body.episodes.reduce((n, e) => n + sequenceSeconds(e), 0),
    10800
  );
  const price = rates(film.studio);
  const estimate = analyze(large, {}, price);
  assert.equal(estimate.images, 2700);
  assert.equal(estimate.videos, 2700);
  assert.equal(estimate.videoSeconds, 10800);
  assert.equal(
    estimate.outputUSD,
    Math.round((2700 * price.imageUSD + 10800 * price.videoUSD) * 1000) / 1000
  );
  const tooLong = structuredClone(large.body);
  tooLong.episodes.at(-1).shots.push(shot());
  assert.throws(() => normalizeFilm(tooLong), /film_duration_exceeded/);
  await button('โปรเจกต์ทั้งหมด').click();
  await button('สร้างหนังยาว 2–3 ชั่วโมง').click();
  const title = 'ทดสอบหนังยาวจากฟุตเทจ';
  await hub.getByLabel('ชื่อโปรเจกต์', {exact: true}).fill(title);
  await save();
  await button('เนื้อเรื่อง').click();
  const original = path.join(dir, 'source-film.webm');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=teal:size=128x96:rate=2',
    '-t',
    '120',
    '-an',
    '-c:v',
    'libvpx',
    '-threads',
    '1',
    original
  ]);
  await hub.getByLabel('แนบวิดีโอจากอุปกรณ์').setInputFiles(original);
  await hub.getByLabel('สิ้นสุดที่วินาที').waitFor();
  assert.equal(Number(await hub.getByLabel('สิ้นสุดที่วินาที').inputValue()), 120);
  await save();
  let p = await projectByTitle(title);
  const source = p.body.episodes[0];
  assert(source.footage.fileId);
  // Start with API media quota exhausted by the previous real-browser film scenario.
  const paidBefore = [calls.images.length, calls.video.length];
  const extend = async (count) => {
    const additions = Array.from({length: count - p.body.episodes.length}, (_, i) => ({
      ...source,
      id: randomUUID(),
      title: 'ช่วงที่ ' + (p.body.episodes.length + i + 1)
    }));
    const {episodes, ...header} = p.body;
    header.feature = {...header.feature, minutes: count === 60 ? 120 : 180};
    const result = await api(
      '/film/' + p.id + '/draft',
      'PUT',
      {
        title: p.title,
        revision: p.revision,
        meta: header,
        order: [...episodes, ...additions].map((e) => e.id),
        changes: additions
      },
      'application/vnd.panthorium.film+json'
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
    p = await service.get(owner, p.id);
  };
  await extend(60);
  await button('โปรเจกต์ทั้งหมด').click();
  await button(title).click();
  await hub.getByText('งานที่ยังต้องสร้างจากบทที่บันทึกแล้ว', {exact: false}).waitFor();
  const q = await film.production.inspect(actor, p.id);
  assert.equal(q.summary.seconds, 7200);
  assert.equal(q.summary.outputUSD, 0);
  await assert.rejects(film.production.inspect({...actor, sub: other}, p.id), /project_not_found/);
  await assert.rejects(film.exports.start(actor, p.id, {revision: p.revision}), /film_unfinished_parts/);
  await assert.rejects(
    film.production.control(actor, p.id, {
      action: 'start',
      revision: p.revision,
      confirmed: true,
      token: 'wrong'
    }),
    /film_quote_changed/
  );
  const approval = {action: 'start', revision: p.revision, confirmed: true, token: q.token};
  await film.production.control(actor, p.id, approval);
  await film.production.control(actor, p.id, {action: 'pause'});
  await film.production.tick();
  assert.equal((await film.production.inspect(actor, p.id)).run.status, 'paused');
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM panthorium_studio_jobs WHERE idempotency_key LIKE 'feature:%'"
      )
    ).rows[0].n,
    0
  );
  page.once('dialog', (d) => d.accept());
  await button('เริ่มหรือทำต่อจากฉากค้าง').click();
  // Background worker continues with the editor closed. Two dispatchers cannot duplicate the scene.
  await button('โปรเจกต์ทั้งหมด').click();
  const {FilmStudioService} = require('../services/filmStudioService');
  const restarted = new FilmStudioService(service, film.studio);
  for (let attempt = 0; attempt < 8; attempt++) {
    await pool.query('UPDATE panthorium_feature_runs SET next_at=now() WHERE project=$1', [p.id]);
    await Promise.all([restarted.production.tick(), film.production.tick()]);
    await film.studio.tick({featureOnly: true});
    if ((await film.production.inspect(actor, p.id)).run.status === 'complete') break;
    await pause(100);
  }
  const done = await restarted.production.inspect(actor, p.id);
  assert.equal(done.run.status, 'complete', JSON.stringify(done.run));
  assert.equal(done.summary.ready, 60);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM panthorium_studio_jobs WHERE idempotency_key LIKE 'feature:%'"
      )
    ).rows[0].n,
    1
  );
  const output = async (seconds) => {
    await button(title).click();
    await button('รวมทั้งเรื่องเป็น MP4').click();
    const download = button('ดาวน์โหลดหนังทั้งเรื่อง');
    await download.waitFor({timeout: 90000});
    const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const dest = path.join(dir, 'feature-' + seconds + '.mp4');
    await file.saveAs(dest);
    const media = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_name,width,height,duration',
          '-of',
          'json',
          dest
        ],
        {encoding: 'utf8'}
      )
    );
    for (const stream of media.streams)
      assert(Math.abs(Number(stream.duration) - seconds) < 0.12, JSON.stringify(media));
    assert(Math.abs(media.format.duration - seconds) < 0.12);
    assert(media.streams.some((s) => s.codec_name === 'h264' && s.width === 1280 && s.height === 720));
    assert(media.streams.some((s) => s.codec_name === 'aac'));
    const used = await page.request.get(
      new URL('/api/online-tools/film-exports/' + p.id + '/file', page.url()).href
    );
    assert.equal(used.status(), 401, 'one-time download already redeemed');
    await button('โปรเจกต์ทั้งหมด').click();
    console.log('Verified native download ' + seconds + 's, 1280x720 H.264 and AAC');
  };
  await output(7200);
  await extend(90);
  assert.equal(
    (await film.exports.status(actor, p.id)).status,
    'none',
    'prior cut is not the new revision'
  );
  assert.equal((await film.production.inspect(actor, p.id)).summary.ready, 90);
  await output(10800);
  assert.deepEqual(
    [calls.images.length, calls.video.length],
    paidBefore,
    'imported footage never calls paid providers'
  );
  // Check the paid path separately. A depleted day is deferred, and a changed cut requires a new approval.
  const one = shot();
  one.action = 'เดินเข้าฉาก';
  one.seconds = 4;
  const ai = await service.create(owner, {
    id: randomUUID(),
    kind: 'film',
    title: 'ฉากจากบท',
    body: {...p.body, episodes: [{...source, id: randomUUID(), footage: null, shots: [one]}]}
  });
  let aiQuote = await film.production.inspect(actor, ai.id);
  assert.equal(aiQuote.quota.remaining, 0);
  assert.equal(aiQuote.summary.images, 1);
  assert.equal(aiQuote.summary.videos, 1);
  await film.production.control(actor, ai.id, {
    action: 'start',
    confirmed: true,
    revision: ai.revision,
    token: aiQuote.token
  });
  await film.production.tick();
  assert.equal((await film.production.inspect(actor, ai.id)).run.status, 'waiting_quota');
  ai.body.episodes[0].shots[0].action = 'เดินกลับบ้าน';
  const edited = await service.update(owner, ai.id, {
    title: ai.title,
    body: ai.body,
    revision: ai.revision
  });
  await pool.query(
    "UPDATE panthorium_studio_jobs SET created_at=created_at-interval '2 days' WHERE owner_id=$1",
    [owner]
  );
  await pool.query('UPDATE panthorium_feature_runs SET next_at=now() WHERE project=$1', [ai.id]);
  await restarted.production.tick();
  aiQuote = await film.production.inspect(actor, ai.id);
  assert.equal(aiQuote.run.status, 'paused');
  await assert.rejects(
    film.production.control(actor, ai.id, {
      action: 'start',
      confirmed: true,
      revision: ai.revision,
      token: q.token
    }),
    /film_quote_changed/
  );
  await film.production.control(actor, ai.id, {
    action: 'start',
    confirmed: true,
    revision: edited.revision,
    token: aiQuote.token
  });
  for (let i = 0; i < 20; i++) {
    await pool.query('UPDATE panthorium_feature_runs SET next_at=now() WHERE project=$1', [ai.id]);
    await pool.query(
      "UPDATE panthorium_studio_jobs SET next_run_at=now() WHERE idempotency_key LIKE 'feature:%'"
    );
    await restarted.production.tick();
    await film.studio.tick({featureOnly: true});
    if ((await film.production.inspect(actor, ai.id)).run.status === 'complete') break;
  }
  const aiDone = await film.production.inspect(actor, ai.id);
  assert.equal(aiDone.run.status, 'complete', JSON.stringify(aiDone.run));
  assert.equal(aiDone.summary.readySeconds, 4);
  assert.deepEqual([calls.images.length, calls.video.length], [paidBefore[0] + 1, paidBefore[1] + 1]);
  console.log(
    'Verified quota deferral, changed-script approval and resumed AI shot without duplicate provider calls'
  );
  const scripted = await service.create(owner, {
    id: randomUUID(),
    title: 'บทสามองก์ต่อเนื่อง',
    kind: 'film',
    body: outline.body
  });
  const beforePlanning = calls.plans;
  const beforeImages = calls.images.length,
    beforeVideos = calls.video.length;
  await page.reload();
  await button(scripted.title).click();
  const plan = button('ให้ Gemini วางช็อตทั้งเรื่อง');
  await plan.waitFor();
  page.once('dialog', (d) => d.accept());
  await plan.click();
  await button('โปรเจกต์ทั้งหมด').click();
  for (let i = 0; i < 190; i++) {
    await pool.query('UPDATE panthorium_feature_scripts SET next_at=now() WHERE project=$1', [scripted.id]);
    await restarted.scripts.tick();
    if ((await restarted.scripts.status(owner, scripted.id)).status === 'complete') break;
  }
  const storyboard = await service.get(owner, scripted.id);
  assert.equal(storyboard.body.episodes.length, 169);
  assert.equal(
    storyboard.body.episodes.reduce((n, e) => n + e.shots.length, 0),
    1350
  );
  assert.equal(
    storyboard.body.episodes.reduce((n, e) => n + sequenceSeconds(e), 0),
    10800
  );
  assert.equal(calls.plans - beforePlanning, 169);
  assert.equal(storyboard.body.characters.length, 1);
  assert.equal(storyboard.body.locations.length, 1);
  assert.deepEqual([calls.images.length, calls.video.length], [beforeImages, beforeVideos]);
  console.log(
    'Verified 169 background storyboard sequences, 1,350 shots and exactly 180 minutes from one screenplay with fixture Gemini; media waits for separate approval.'
  );
}
module.exports = {verify};
