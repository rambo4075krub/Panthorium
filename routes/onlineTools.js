'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const {requireAuth, requirePermission} = require('../middleware/auth');
const {account} = require('../services/socialService');
function createOnlineToolsRouter(auth, tools, film) {
  const r = express.Router();
  const limit = (n) =>
    rateLimit({windowMs: 60000, limit: n, standardHeaders: true, legacyHeaders: false});
  const route = (fn) => async (req, res, next) => {
    try {
      res.json({ok: true, ...(await fn(req))});
    } catch (e) {
      next(e);
    }
  };
  const body = (req) => req.body || {};
  r.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.get(
    '/shared/:token',
    limit(120),
    route(async (q) => ({project: await tools.shared(q.params.token)}))
  );
  r.post(
    '/shared/:token/answers',
    limit(35),
    route((q) => tools.submit(q.params.token, body(q)))
  );
  r.use(
    requireAuth(auth),
    requirePermission('chat'),
    (q, _r, next) => {
      try {
        q.toolOwner = account(q.user);
        next();
      } catch (e) {
        next(e);
      }
    },
    limit(160)
  );
  if (film) {
    r.get('/film/:key/:episode', route(q => film.state(q.user,q.params.key,q.params.episode)));
    r.post('/film/:key/master', limit(3), async (q,res,next) => {
      const controller = new AbortController();
      res.once('close',() => { if (!res.writableFinished) controller.abort(); });
      const send = (file,name) => new Promise((resolve,reject) =>
        res.download(file,name,{acceptRanges:false,cacheControl:false},error => error ? reject(error) : resolve()));
      try { await film.download(q.user,q.params.key,body(q).revision,send,controller.signal); }
      catch(e) { if (!res.destroyed && !res.headersSent) next(e); }
    });
    r.post('/film/:key/plan', limit(5), route(q => film.plan(q.user,q.params.key,body(q))));
    r.post('/film/:key/quote', route(q => film.produce(q.user,q.params.key,body(q),false)));
    r.post('/film/:key/produce', limit(8), route(q => film.produce(q.user,q.params.key,body(q),true)));
  }
  r.get(
    '/projects',
    route(async (q) => ({items: await tools.list(q.toolOwner)}))
  );
  r.post(
    '/projects',
    route(async (q) => ({project: await tools.create(q.toolOwner, body(q))}))
  );
  r.get(
    '/projects/:key',
    route(async (q) => ({project: await tools.get(q.toolOwner, q.params.key)}))
  );
  r.put(
    '/projects/:key',
    route(async (q) => ({project: await tools.update(q.toolOwner, q.params.key, body(q))}))
  );
  r.delete(
    '/projects/:key',
    route((q) => tools.remove(q.toolOwner, q.params.key, body(q).revision))
  );
  r.put(
    '/projects/:key/share',
    route(async (q) => ({project: await tools.share(q.toolOwner, q.params.key, body(q))}))
  );
  r.get(
    '/projects/:key/members',
    route(async (q) => ({items: await tools.members(q.toolOwner, q.params.key)}))
  );
  r.delete(
    '/projects/:key/members/:member',
    route((q) => tools.revoke(q.toolOwner, q.params.key, q.params.member))
  );
  r.get(
    '/projects/:key/answers',
    route((q) => tools.answers(q.toolOwner, q.params.key, q.query.offset))
  );
  r.get('/projects/:key/responses.csv', async (q, res, next) => {
    try {
      const csv = await tools.answers(q.toolOwner, q.params.key, 0, true);
      res
        .set('Content-Disposition', 'attachment; filename="responses.csv"')
        .type('text/csv; charset=utf-8')
        .send(csv);
    } catch (e) {
      next(e);
    }
  });
  r.get(
    '/projects/:key/runs',
    route((q) => tools.runs(q.toolOwner, q.params.key, q.query.offset))
  );
  r.put(
    '/projects/:key/runs/:run',
    route((q) => tools.mark(q.toolOwner, q.params.key, q.params.run, body(q).done))
  );
  r.post(
    '/copy/:token',
    route(async (q) => ({project: await tools.copy(q.toolOwner, q.params.token, body(q).id)}))
  );
  r.get(
    '/join/:token',
    route(async (q) => ({invite: await tools.inviteInfo(q.params.token)}))
  );
  r.post(
    '/join/:token',
    route(async (q) => ({project: await tools.join(q.toolOwner, q.params.token)}))
  );
  r.use((e, _q, res, next) =>
    Number.isInteger(e.status) ? res.status(e.status).json({ok: false, error: e.message}) : next(e)
  );
  return r;
}
module.exports = {createOnlineToolsRouter};
