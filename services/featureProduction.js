'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {fail} = require('./onlineToolModel');
const {filmGraph, sequenceSeconds} = require('./filmStudioModel');
const {LIMITS, dayStart} = require('./creativeStudioRepository');

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tomorrow = () => new Date(dayStart().getTime() + 86400000);
const producing = ['running', 'waiting_quota'];
// Google Cloud on-demand output list prices, checked 2026-11-26. Video uses 720p with audio.
// https://cloud.google.com/vertex-ai/generative-ai/pricing
function rates(studio) {
  const imageModel = studio.imageConfig().model;
  const videoModel = String(process.env.PANTHORIUM_VEO_MODEL || 'veo-3.1-generate-001').trim();
  const imageUSD = {'gemini-2.5-flash-image': 0.039, 'gemini-3.1-flash-image': 0.067}[imageModel] ?? null;
  const videoUSD =
    {
      'veo-3.1-generate-001': 0.4,
      'veo-3.0-generate-001': 0.4,
      'veo-3.1-fast-generate-001': 0.1,
      'veo-3.0-fast-generate-001': 0.1
    }[videoModel] ?? null;
  return {imageModel, videoModel, imageUSD, videoUSD};
}
function analyze(project, assets, price) {
  const needed = new Set();
  let images = 0,
    videos = 0,
    videoSeconds = 0,
    seconds = 0,
    readySeconds = 0,
    ready = 0,
    empty = 0,
    next = null;
  for (const ep of project.body.episodes) {
    const length = sequenceSeconds(ep);
    if (!length) {
      empty++;
      continue;
    }
    seconds += length;
    const target = 'episode:' + ep.id;
    const graph = filmGraph(project, ep.id, assets, 'estimate', target);
    if (graph.status[target].ready) {
      ready++;
      readySeconds += length;
      continue;
    }
    if (!next) {
      const shot = ep.footage ? null : ep.shots.find((s) => !graph.status['clip:' + s.id]?.ready);
      next = {episode: ep.id, target: shot ? 'clip:' + shot.id : target};
    }
    graph.targets.forEach((t, i) => {
      if (needed.has(t.key)) return;
      needed.add(t.key);
      const step = graph.steps[i];
      if (step.pluginId === 'image') images++;
      if (step.pluginId === 'video') {
        videos++;
        videoSeconds += step.input.durationSeconds;
      }
    });
  }
  const outputUSD =
    (images && price.imageUSD == null) || (videos && price.videoUSD == null)
      ? null
      : Math.round((images * (price.imageUSD || 0) + videoSeconds * (price.videoUSD || 0)) * 1000) / 1000;
  return {
    seconds,
    readySeconds,
    ready,
    empty,
    total: project.body.episodes.length,
    images,
    videos,
    videoSeconds,
    outputUSD,
    price,
    next
  };
}
function describe(row) {
  if (!row) return null;
  return {
    status: row.status,
    reason: row.reason,
    revision: row.revision,
    job: row.job_id,
    nextAt: row.next_at
  };
}
class FeatureProduction {
  constructor(film) {
    this.film = film;
    this.studio = film.studio;
    this.projects = film.projects;
  }
  async project(user, key, revision) {
    const p = await this.film.project(user, key, revision);
    if (p.body.format !== 'feature') fail('feature_project_required');
    return p;
  }
  async quota(owner) {
    const row = (
      await this.projects.db().query(
        `SELECT COUNT(*) FILTER (WHERE NOT (idempotency_key LIKE 'feature:%' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(data->'steps') s WHERE s->>'pluginId'<>'film-assemble')))::int AS jobs,
      COALESCE(SUM((SELECT count(*) FROM jsonb_array_elements(data->'steps') step WHERE step->>'pluginId' IN ('image','video'))),0)::int AS used
      FROM panthorium_studio_jobs WHERE owner_id=$1 AND created_at >= $2`,
        [owner, dayStart()]
      )
    ).rows[0];
    return {
      limit: LIMITS.dailyMediaSteps,
      remaining: Math.max(0, LIMITS.dailyMediaSteps - row.used),
      jobsRemaining: Math.max(0, LIMITS.dailyJobs - row.jobs),
      resetAt: tomorrow()
    };
  }
  async assets(user, p) {
    const state = await this.studio.repository.filmState(user.sub, p.id);
    if (!Object.keys(state.assets).length) return state;
    const owned = new Set((await this.studio.files.listAll(user.sub)).map((file) => file.id));
    for (const [key, item] of Object.entries(state.assets))
      if (!owned.has(item.file.id)) delete state.assets[key];
    return state;
  }
  async inspect(user, key) {
    const p = await this.project(user, key);
    const [state, quota, run] = await Promise.all([
      this.assets(user, p),
      this.quota(user.sub),
      this.projects
        .db()
        .query('SELECT * FROM panthorium_feature_runs WHERE project=$1 AND owner_id=$2', [key, user.sub])
    ]);
    const summary = analyze(p, state.assets, rates(this.studio));
    const token = hash([
      key,
      p.revision,
      summary.images,
      summary.videos,
      summary.videoSeconds,
      summary.price
    ]);
    const script = await this.film.scripts.status(user.sub, key);
    const progress = describe(run.rows[0]);
    if (progress && progress.revision !== p.revision) {
      progress.status = 'paused';
      progress.reason = 'revision_conflict';
    }
    const uncertainJob = state.last?.status === 'needs_review' ? state.last.id : null;
    return {summary, quota, token, run: progress, uncertainJob, script, revision: p.revision};
  }
  async control(user, key, input) {
    const current = await this.studio.principal(user);
    if (input.action === 'pause') {
      await this.project(current, key);
      const changed = await this.projects
        .db()
        .query(
          "UPDATE panthorium_feature_runs SET status='paused',reason='manual' WHERE project=$1 AND owner_id=$2 AND status IN ('running','waiting_quota') RETURNING *",
          [key, current.sub]
        );
      return {run: describe(changed.rows[0])};
    }
    if (input.action !== 'start' || input.confirmed !== true) fail('generation_confirmation_required', 409);
    const {summary, token, uncertainJob} = await this.inspect(current, key);
    if (uncertainJob && input.reviewed !== true) fail('feature_review_required', 409);
    if (input.token !== token) fail('film_quote_changed', 409);
    if (!summary.next) fail('feature_no_work', 409);
    for (const [plugin, n] of [
      ['image', summary.images],
      ['video', summary.videos]
    ]) {
      if (!n) continue;
      await this.studio.assertAllowed(current, plugin);
      const reason = this.studio.available(plugin);
      if (reason) fail(reason, 503);
    }
    const principal = {
      sub: current.sub,
      roles: current.roles,
      permissions: current.permissions,
      accountVersion: current.accountVersion
    };
    return this.projects.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['feature-run:' + key]);
      const script = (
        await c.query('SELECT status,episode FROM panthorium_feature_scripts WHERE project=$1', [key])
      ).rows[0];
      if (script && (['running', 'generating'].includes(script.status) || script.episode))
        fail('film_job_active', 409);
      const old = (
        await c.query('SELECT * FROM panthorium_feature_runs WHERE project=$1 FOR UPDATE', [key])
      ).rows[0];
      const p = await this.projects.project(c, current.sub, key, true);
      if (p.revision !== input.revision) fail('revision_conflict', 409);
      if (old && producing.includes(old.status) && old.revision === p.revision) return {run: describe(old)};
      const previous = old?.job_id ? await this.studio.repository.get(current.sub, old.job_id) : null;
      if (previous && ['queued', 'running'].includes(previous.status)) fail('film_job_active', 409);
      if (
        (old?.reason === 'studio_submission_uncertain' || previous?.status === 'needs_review') &&
        input.reviewed !== true
      )
        fail('feature_review_required', 409);
      const budget = {
        images: summary.images,
        videos: summary.videos,
        videoSeconds: summary.videoSeconds,
        price: summary.price,
        reviewedJob: uncertainJob
      };
      const result = await c.query(
        `INSERT INTO panthorium_feature_runs(project,owner_id,revision,run_id,principal,budget,status)
        VALUES($1,$2,$3,$4,$5,$6,'running') ON CONFLICT(project) DO UPDATE SET
        revision=excluded.revision,run_id=excluded.run_id,principal=excluded.principal,budget=excluded.budget,
        batch=0,job_id=NULL,status='running',reason=NULL,next_at=now() RETURNING *`,
        [key, current.sub, p.revision, randomUUID(), principal, budget]
      );
      return {run: describe(result.rows[0])};
    });
  }
  async tick() {
    return this.projects.tx(async (c) => {
      const row = (
        await c.query(`SELECT * FROM panthorium_feature_runs WHERE status IN ('running','waiting_quota')
        AND next_at<=now() ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED`)
      ).rows[0];
      if (!row) return false;
      const update = async (status, reason = null, delay = 10000) =>
        c.query('UPDATE panthorium_feature_runs SET status=$2,reason=$3,next_at=$4 WHERE project=$1', [
          row.project,
          status,
          reason,
          new Date(Date.now() + delay)
        ]);
      try {
        const user = await this.studio.principal(row.principal);
        const p = await this.project(user, row.project, row.revision);
        if (row.job_id) {
          const job = await this.studio.repository.get(user.sub, row.job_id);
          if (!job || ['failed', 'needs_review'].includes(job.status)) {
            await update(
              'paused',
              job?.status === 'needs_review'
                ? 'studio_submission_uncertain'
                : job?.error || 'studio_job_not_found'
            );
            return true;
          }
          if (job.status !== 'completed') {
            await update('running');
            return true;
          }
        }
        const key = 'feature:' + row.run_id + ':' + row.batch;
        // Recover a queue insertion committed immediately before a coordinator restart.
        let job = await this.studio.repository.byRequest(user.sub, key);
        const budget = {...row.budget};
        if (!job) {
          const {assets, last} = await this.assets(user, p);
          if (last && ['queued', 'running'].includes(last.status)) {
            await update('running');
            return true;
          }
          if (last?.status === 'needs_review' && last.id !== budget.reviewedJob) {
            await update('paused', 'studio_submission_uncertain');
            return true;
          }
          const s = analyze(p, assets, rates(this.studio));
          if (!s.next) {
            await update(s.empty ? 'needs_script' : 'complete');
            return true;
          }
          if (Object.keys(s.price).some((k) => s.price[k] !== budget.price[k])) {
            await update('paused', 'film_quote_changed');
            return true;
          }
          const q = await this.quota(user.sub);
          let target = s.next.target;
          let graph = filmGraph(p, s.next.episode, assets, key, target);
          const paid = graph.steps.filter((step) => ['image', 'video'].includes(step.pluginId)).length;
          if (paid && (!q.jobsRemaining || !q.remaining)) {
            await update('waiting_quota', 'studio_daily_limit', +tomorrow() - Date.now());
            return true;
          }
          if (paid > q.remaining) {
            target = graph.targets[0].key;
            graph = filmGraph(p, s.next.episode, assets, key, target);
          }
          const counts = units(graph.steps);
          if (Object.keys(counts).some((k) => counts[k] > budget[k])) {
            await update('paused', 'film_quote_changed');
            return true;
          }
          const film = {
            project: p.id,
            episode: s.next.episode,
            revision: p.revision,
            target,
            targets: graph.targets
          };
          await this.studio.start({user, idempotencyKey: key, confirmed: true, steps: graph.steps, film});
          job = await this.studio.repository.byRequest(user.sub, key);
        }
        const spent = units(job.steps);
        for (const k of Object.keys(spent)) budget[k] -= spent[k];
        await c.query(
          "UPDATE panthorium_feature_runs SET budget=$2,job_id=$3,batch=batch+1,status='running',reason=NULL,next_at=now()+interval '5 seconds' WHERE project=$1",
          [row.project, budget, job.id]
        );
      } catch (e) {
        const reason = e.code || e.message;
        if (reason === 'studio_daily_limit')
          await update('waiting_quota', reason, +tomorrow() - Date.now());
        else if (['studio_active_limit', 'film_job_active', 'system_busy'].includes(reason))
          await update('running', reason, 30000);
        else if (Number.isInteger(e.status)) await update('paused', String(reason).slice(0, 100));
        else throw e;
      }
      return true;
    });
  }
}
function units(steps) {
  return {
    images: steps.filter((s) => s.pluginId === 'image').length,
    videos: steps.filter((s) => s.pluginId === 'video').length,
    videoSeconds: steps.reduce((n, s) => n + (s.pluginId === 'video' ? s.input.durationSeconds : 0), 0)
  };
}
module.exports = {FeatureProduction, analyze, rates};
