'use strict';
const {fail} = require('./onlineToolModel');
const firstUnplanned = (project) => project.body.episodes.filter((ep) => !ep.footage && !ep.shots.length);
const active = (status) => ['running', 'generating'].includes(status);
function publicState(row) {
  return row
    ? {
        status: row.status,
        reason: row.reason,
        remaining: row.remaining,
        episode: row.episode,
        revision: row.revision
      }
    : null;
}
class FeatureScriptQueue {
  constructor(film) {
    this.film = film;
    this.projects = film.projects;
    this.busy = false;
  }
  async status(owner, key) {
    return publicState(
      (
        await this.projects
          .db()
          .query(
            'SELECT status,reason,remaining,episode,revision FROM panthorium_feature_scripts WHERE project=$1 AND owner_id=$2',
            [key, owner]
          )
      ).rows[0]
    );
  }
  async control(user, key, input) {
    const current = await this.film.studio.principal(user);
    const p = await this.film.production.project(current, key, input.revision);
    if (input.action === 'pause') {
      await this.projects
        .db()
        .query(
          "UPDATE panthorium_feature_scripts SET status='paused',reason='manual' WHERE project=$1 AND owner_id=$2 AND status IN ('running','generating')",
          [key, current.sub]
        );
      return this.status(current.sub, key);
    }
    if (input.action !== 'start' || input.confirmed !== true) fail('generation_confirmation_required', 409);
    const pending = firstUnplanned(p);
    if (!pending.length) fail('feature_no_work', 409);
    if (p.revision !== input.revision || pending.length !== input.maxCalls) fail('film_quote_changed', 409);
    if (!p.body.feature.synopsis && !p.body.feature.screenplay && pending.some((ep) => !ep.story))
      fail('film_story_required');
    await this.projects.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['feature-run:' + key]);
      const locked = await this.projects.project(c, current.sub, key, true);
      if (locked.revision !== input.revision) fail('revision_conflict', 409);
      const media = (await c.query('SELECT status FROM panthorium_feature_runs WHERE project=$1', [key]))
        .rows[0];
      if (media && ['running', 'waiting_quota'].includes(media.status)) fail('film_job_active', 409);
      const old = (
        await c.query('SELECT * FROM panthorium_feature_scripts WHERE project=$1 FOR UPDATE', [key])
      ).rows[0];
      if (old && active(old.status) && old.revision === locked.revision) return;
      if (old?.episode) fail('film_job_active', 409);
      if (old?.reason === 'feature_script_review' && !input.reviewed) fail('feature_review_required', 409);
      const principal = {
        sub: current.sub,
        roles: current.roles,
        permissions: current.permissions,
        accountVersion: current.accountVersion
      };
      await c.query(
        `INSERT INTO panthorium_feature_scripts(project,owner_id,revision,principal,status,remaining) VALUES($1,$2,$3,$4,'running',$5)
        ON CONFLICT(project) DO UPDATE SET revision=excluded.revision,principal=excluded.principal,status='running',remaining=excluded.remaining,
        reason=NULL,episode=NULL,next_at=now()`,
        [key, current.sub, p.revision, principal, pending.length]
      );
    });
    this.wake();
    return this.status(current.sub, key);
  }
  wake() {
    void this.tick().catch(() => {});
  }
  async tick() {
    if (this.busy || !this.projects.pool) return;
    this.busy = true;
    let client,
      locked = false;
    try {
      client = await this.projects.pool.connect();
      locked = (
        await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended('feature-script-worker',0)) AS held"
        )
      ).rows[0].held;
      if (!locked) return;
      const row = (
        await client.query(`SELECT * FROM panthorium_feature_scripts WHERE (status IN ('running','generating') OR episode IS NOT NULL)
        AND next_at<=now() ORDER BY next_at LIMIT 1`)
      ).rows[0];
      if (!row) return;
      const done = async (revision) =>
        client.query(
          `UPDATE panthorium_feature_scripts SET revision=$2,episode=NULL,
        status=CASE WHEN status='paused' THEN 'paused' WHEN remaining=0 THEN 'complete' ELSE 'running' END,next_at=now()+interval '3 seconds'
        WHERE project=$1 AND episode=$3`,
          [row.project, revision, row.episode]
        );
      const stop = async (reason) =>
        client.query(
          "UPDATE panthorium_feature_scripts SET episode=NULL,status='paused',reason=$2 WHERE project=$1 AND revision=$3",
          [row.project, reason, row.revision]
        );
      let dispatched = false;
      try {
        const user = await this.film.studio.principal(row.principal);
        const p = await this.film.production.project(user, row.project);
        if (row.episode) {
          // A previous worker died after dispatch. Only an already-saved scene is safe to adopt.
          const saved = p.body.episodes.find((ep) => ep.id === row.episode);
          if (p.revision === row.revision + 1 && saved?.shots.length) {
            await client.query(
              "UPDATE panthorium_feature_scripts SET revision=$2,episode=NULL,status='paused',reason='feature_script_recovered' WHERE project=$1 AND episode=$3",
              [p.id, p.revision, row.episode]
            );
          } else await stop('feature_script_review');
          return;
        }
        if (p.revision !== row.revision) {
          await stop('revision_conflict');
          return;
        }
        const next = firstUnplanned(p)[0];
        if (!next || row.remaining < 1) {
          await client.query(
            "UPDATE panthorium_feature_scripts SET status='complete' WHERE project=$1 AND status='running' AND revision=$2",
            [p.id, p.revision]
          );
          return;
        }
        const marked = await client.query(
          "UPDATE panthorium_feature_scripts SET episode=$2,status='generating',remaining=remaining-1 WHERE project=$1 AND status='running' AND revision=$3 AND episode IS NULL RETURNING project",
          [p.id, next.id, p.revision]
        );
        if (!marked.rowCount) return;
        row.episode = next.id;
        dispatched = true;
        const count = Math.max(1, Math.min(8, Math.ceil((next.plannedSeconds || 16) / 8)));
        const result = await this.film.plan(user, p.id, {episode: next.id, revision: p.revision, count});
        await done(result.project.revision);
      } catch (e) {
        if (dispatched || Number.isInteger(e.status)) {
          await stop(
            dispatched && e.message !== 'revision_conflict'
              ? 'feature_script_review'
              : String(e.code || e.message).slice(0, 100)
          );
          return;
        }
        throw e;
      }
    } finally {
      try {
        if (locked)
          await client.query("SELECT pg_advisory_unlock(hashtextextended('feature-script-worker',0))");
      } finally {
        client?.release();
        this.busy = false;
      }
    }
  }
}
module.exports = {FeatureScriptQueue};
