'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {fail} = require('./onlineToolModel');
const {withMaster} = require('./filmMaster');
const {sanitizeFilename} = require('./cloudFilesService');
const DAY = 86400000;
const signature = (parts) =>
  createHash('sha256')
    .update(JSON.stringify(parts.map((p) => [p.id, p.size, p.seconds])))
    .digest('hex');
const live = (row) => row?.status === 'ready' && Date.now() - new Date(row.updated_at).getTime() < DAY;

// Prepare the private file off the HTTP request. A restarted worker can repeat the lossless join.
class FeatureExports {
  constructor(film) {
    this.film = film;
    this.running = false;
    this.lastSweep = 0;
  }
  get root() {
    const stage = process.env.PANTHORIUM_DEPLOY_STAGE === 'staging' ? 'staging' : 'production';
    return path.join(this.film.studio.mediaStudio.tempRoot, 'panthorium-feature-exports', stage);
  }
  file(row) {
    return path.join(this.root, row.artifact + '.mp4');
  }
  async row(owner, key) {
    return (
      await this.film.projects
        .db()
        .query('SELECT * FROM panthorium_feature_exports WHERE project=$1 AND owner_id=$2', [key, owner])
    ).rows[0];
  }
  async status(user, key) {
    const p = await this.film.production.project(user, key);
    const row = await this.row(user.sub, key);
    if (!row || row.revision !== p.revision) return {status: 'none'};
    if (row.status === 'ready') {
      try {
        if (signature(await this.film.parts(user, p)) !== row.source_key) return {status: 'none'};
      } catch (e) {
        if (e.message === 'film_unfinished_parts') return {status: 'none'};
        throw e;
      }
    }
    const expired =
      row.status === 'ready' && (!live(row) || !(await fs.stat(this.file(row)).catch(() => null)));
    return {status: expired ? 'expired' : row.status, size: Number(row.size || 0), reason: row.reason};
  }
  async start(user, key, input) {
    const current = await this.film.studio.principal(user);
    const p = await this.film.production.project(current, key, input.revision);
    if (p.revision !== input.revision) fail('revision_conflict', 409);
    // Fail immediately on an unfinished sequence without allocating disk or starting a paid job.
    const sourceKey = signature(await this.film.parts(current, p));
    const principal = {
      sub: current.sub,
      roles: current.roles,
      permissions: current.permissions,
      accountVersion: current.accountVersion
    };
    await this.film.projects.tx(async (c) => {
      const locked = await this.film.projects.project(c, current.sub, key, true);
      if (locked.revision !== p.revision) fail('revision_conflict', 409);
      const old = (
        await c.query('SELECT * FROM panthorium_feature_exports WHERE project=$1 FOR UPDATE', [key])
      ).rows[0];
      if (
        old?.revision === p.revision &&
        old.source_key === sourceKey &&
        (['queued', 'running'].includes(old.status) ||
          (live(old) && (await fs.stat(this.file(old)).catch(() => null))))
      )
        return;
      await c.query(
        `INSERT INTO panthorium_feature_exports(project,owner_id,revision,artifact,principal,source_key,status)
        VALUES($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT(project) DO UPDATE SET revision=excluded.revision,
        artifact=excluded.artifact,principal=excluded.principal,source_key=excluded.source_key,status='queued',size=NULL,reason=NULL,updated_at=now()`,
        [key, current.sub, p.revision, randomUUID(), principal, sourceKey]
      );
    });
    this.wake();
    return this.status(current, key);
  }
  wake() {
    void this.tick().catch(() => {});
  }
  async sweep() {
    if (Date.now() - this.lastSweep < 3600000) return;
    this.lastSweep = Date.now();
    for (const item of await fs.readdir(this.root, {withFileTypes: true})) {
      if (item.isDirectory() && /^panthorium-film-[a-z0-9]{6}$/i.test(item.name)) {
        // The database session lock proves the previous export worker no longer owns this staging directory.
        await fs.rm(path.join(this.root, item.name), {recursive: true, force: true});
        continue;
      }
      if (!item.isFile() || !/^[0-9a-f-]{36}\.mp4$/.test(item.name)) continue;
      const filename = path.join(this.root, item.name);
      const stat = await fs.stat(filename).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > DAY + 3600000) await fs.rm(filename, {force: true});
    }
  }
  async tick() {
    if (this.running || !this.film.projects.pool) return;
    this.running = true;
    let client,
      locked = false;
    try {
      client = await this.film.projects.pool.connect();
      locked = (
        await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended('feature-master-worker',0)) AS held"
        )
      ).rows[0].held;
      if (!locked) return;
      await fs.mkdir(this.root, {recursive: true, mode: 0o700});
      await this.sweep();
      const row = (
        await client.query(
          "UPDATE panthorium_feature_exports SET status='running',updated_at=now() WHERE project=(SELECT project FROM panthorium_feature_exports WHERE status IN ('queued','running') ORDER BY updated_at LIMIT 1) RETURNING *"
        )
      ).rows[0];
      if (!row) return;
      try {
        const studio = this.film.studio;
        const user = await studio.principal(row.principal);
        const p = await this.film.production.project(user, row.project, row.revision);
        const parts = await this.film.parts(user, p);
        if (signature(parts) !== row.source_key) fail('film_quote_changed', 409);
        await withMaster({
          workRoot: this.root,
          media: studio.mediaStudio,
          files: studio.files,
          user,
          parts,
          title: p.title,
          send: async (file, name, size) => {
            const latest = await this.film.production.project(user, row.project, row.revision);
            if (signature(await this.film.parts(user, latest)) !== row.source_key)
              fail('film_quote_changed', 409);
            await fs.rename(file, this.file(row));
            const saved = await client.query(
              "UPDATE panthorium_feature_exports SET status='ready',size=$2,updated_at=now() WHERE artifact=$1",
              [row.artifact, size]
            );
            if (!saved.rowCount) await fs.rm(this.file(row), {force: true});
          }
        });
      } catch (e) {
        const reason = String(e.code || e.message || 'film_export_failed').slice(0, 100);
        const status = ['media_worker_busy', 'system_busy'].includes(reason) ? 'queued' : 'failed';
        await client.query(
          'UPDATE panthorium_feature_exports SET status=$2,reason=$3,updated_at=now() WHERE artifact=$1',
          [row.artifact, status, reason]
        );
      }
    } finally {
      try {
        if (locked)
          await client.query("SELECT pg_advisory_unlock(hashtextextended('feature-master-worker',0))");
      } finally {
        client?.release();
        this.running = false;
      }
    }
  }
  async downloadable(user, key) {
    const p = await this.film.production.project(user, key);
    const row = await this.row(user.sub, key);
    if (!live(row) || row.revision !== p.revision) fail('feature_export_unavailable', 409);
    if (signature(await this.film.parts(user, p)) !== row.source_key)
      fail('feature_export_unavailable', 409);
    const file = this.file(row);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.size !== Number(row.size)) fail('feature_export_unavailable', 409);
    return {
      file,
      name: sanitizeFilename(p.title).replace(/\.mp4$/i, '') + '.mp4',
      size: stat.size,
      artifact: row.artifact
    };
  }
}
module.exports = {FeatureExports};
