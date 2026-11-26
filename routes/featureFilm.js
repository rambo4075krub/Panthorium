'use strict';

const express = require('express');
const {randomBytes, createHash} = require('node:crypto');
const {fail, id} = require('../services/onlineToolModel');
const {FEATURE_SEQUENCES} = require('../services/filmStudioModel');
const cookieName = 'pt_film_download';
const cookiePath = (key) => '/api/online-tools/film-exports/' + key + '/file';
const digest = (value) => createHash('sha256').update(value).digest('hex');

// Only the server holds the session credential. A short-lived, single-download cookie lets
// the OS download a large private file without loading it into the JavaScript heap.
function downloadGrants() {
  const grants = new Map();
  return {
    issue(q, res, key, artifact) {
      const now = Date.now();
      for (const [k, v] of grants)
        if (v.expires <= now || (v.key === key && v.sid === q.user.sid)) grants.delete(k);
      if (grants.size >= 1024) fail('system_busy', 503);
      const value = randomBytes(32).toString('hex');
      grants.set(digest(value), {
        key,
        sid: q.user.sid,
        authorization: q.get('Authorization'),
        artifact,
        expires: now + 120000
      });
      const href = cookiePath(key);
      res.cookie(cookieName, value, {
        httpOnly: true,
        sameSite: 'strict',
        secure: q.secure || process.env.NODE_ENV === 'production',
        maxAge: 120000,
        path: href
      });
      return {href};
    },
    redeem(q, _res, next) {
      if (q.method !== 'GET') return _res.sendStatus(405);
      const value = (q.headers.cookie || '').match(/(?:^|;\s*)pt_film_download=([a-f0-9]{64})(?:;|$)/)?.[1];
      const key = value && digest(value);
      const grant = key && grants.get(key);
      if (!grant || grant.key !== q.params.key || grant.expires <= Date.now())
        return _res.status(401).json({ok: false, error: 'authentication_required'});
      grants.delete(key);
      q.headers.authorization = grant.authorization;
      q.featureArtifact = grant.artifact;
      next();
    }
  };
}
function mountFeature(r, film, grants, route, limit) {
  const parse = express.json({type: 'application/vnd.panthorium.film+json', limit: '22mb'});
  r.post(
    '/film/feature-drafts',
    limit(12),
    parse,
    route(async (q) => {
      if (q.body?.body?.format !== 'feature') fail('feature_project_required');
      return {project: await film.projects.create(q.toolOwner, {...q.body, kind: 'film'})};
    })
  );
  r.put(
    '/film/:key/draft',
    limit(35),
    parse,
    route(async (q) => {
      const input = q.body || {};
      const old = await film.project(q.user, q.params.key, input.revision);
      if (
        input.meta?.format !== 'feature' ||
        !Array.isArray(input.order) ||
        input.order.length > FEATURE_SEQUENCES ||
        !Array.isArray(input.changes) ||
        input.changes.length > input.order.length
      )
        fail('invalid_feature_sequence');
      const order = input.order.map(id);
      const changed = new Map(input.changes.map((e) => [id(e?.id), e]));
      if (changed.size !== input.changes.length || [...changed.keys()].some((k) => !order.includes(k)))
        fail('invalid_feature_sequence');
      const parts = new Map(old.body.episodes.map((e) => [e.id, e]));
      const episodes = order.map((k) => changed.get(k) || parts.get(k));
      if (episodes.some((e) => !e)) fail('invalid_feature_sequence');
      const saved = await film.projects.update(q.toolOwner, old.id, {
        revision: input.revision,
        title: input.title,
        body: {...input.meta, episodes}
      });
      return {revision: saved.revision};
    })
  );
  r.get(
    '/film/:key/feature/overview',
    route((q) => film.production.inspect(q.user, q.params.key))
  );
  r.post(
    '/film/:key/feature/control',
    limit(12),
    route(async (q) => {
      const result = await film.production.control(q.user, q.params.key, q.body || {});
      if (q.body?.action === 'start') film.wakeProduction();
      return result;
    })
  );
  r.get(
    '/film/:key/feature/export',
    route((q) => film.exports.status(q.user, q.params.key))
  );
  r.post(
    '/film/:key/feature/export',
    limit(6),
    route((q) => film.exports.start(q.user, q.params.key, q.body || {}))
  );
  r.post('/film/:key/feature/download', limit(8), async (q, res, next) => {
    try {
      const output = await film.exports.downloadable(q.user, q.params.key);
      const billing = film.studio.files.entitlements;
      if (billing && Number((await billing.state(q.toolOwner)).remaining?.downloadBytes || 0) < output.size)
        fail('quota_exceeded:downloadBytes', 402);
      res.json({ok: true, ...grants.issue(q, res, q.params.key, output.artifact)});
    } catch (e) {
      next(e);
    }
  });
  r.get('/film-exports/:key/file', async (q, res, next) => {
    try {
      const output = await film.exports.downloadable(q.user, q.params.key);
      if (q.featureArtifact !== output.artifact) fail('feature_export_unavailable', 409);
      await film.studio.files.entitlements?.consume(q.toolOwner, {downloadBytes: output.size});
      res.clearCookie(cookieName, {path: cookiePath(q.params.key)});
      res.download(output.file, output.name, {acceptRanges: false, cacheControl: false}, (e) => {
        if (e && !res.headersSent) next(e);
      });
    } catch (e) {
      next(e);
    }
  });
}
module.exports = {mountFeature, downloadGrants};
