'use strict';
const express = require('express');
const path = require('node:path');
const directory = require('../search/directory');

function createWebSearchRouter(service) {
  const router = express.Router();
  const root = path.join(__dirname, '..', 'search');
  router.get(['/search', '/search/view'], (_req, res) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'"
    });
    res.sendFile(path.join(root, 'index.html'));
  });
  for (const file of ['app.js', 'voice.js', 'directory.js', 'style.css', 'great-wave.webp', 'gloock.ttf', 'Gloock-OFL.txt', 'opensearch.xml']) {
    router.get('/search/' + file, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      if (file === 'opensearch.xml') res.type('application/opensearchdescription+xml');
      res.sendFile(path.join(root, file));
    });
  }
  router.post('/api/search/read', express.json({ limit: '4kb' }), async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (typeof req.body?.url !== 'string' || req.body.url.length > 2048) return res.status(400).json({ error: 'invalid_url' });
    try {
      const page = await service.execute('web.read', { url: req.body.url }, 'public-search:' + req.ip);
      res.status(page.available ? 200 : page.error === 'web_rate_limited' ? 429 : 422).json(page.available
        ? { title: page.title, url: page.url, content: page.content, truncated: page.truncated }
        : { error: page.error, message: page.message });
    } catch (error) { next(error); }
  });
  router.post('/api/search', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, express.json({ limit: '4kb' }), async (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'json_required' });
    const body = req.body;
    if (typeof body?.query !== 'string' || !body.query.trim() || body.query.length > 300 ||
        /[\u0000-\u001f\u007f]/.test(body.query) || Object.keys(body).some(key => !['query', 'scope'].includes(key)) ||
        (body.scope !== undefined && !['all', 'selected'].includes(body.scope))) {
      return res.status(400).json({ error: 'invalid_query' });
    }
    try {
      const query = body.query.trim();
      const selected = directory.match(query);
      if (body.scope === 'selected') return res.json({ selected, results: [], status: 'selected' });
      const web = await service.execute('web.search', { query, limit: 12 }, 'public-search:' + req.ip);
      const partial = Boolean(web.issues?.length);
      let status = 'ok', httpStatus = 200;
      if (!web.available) {
        status = web.error === 'web_no_results' ? 'empty' : 'unavailable';
        if (status === 'unavailable') httpStatus = web.error === 'web_rate_limited' ? 429 : 503;
      } else if (partial) status = 'partial';
      res.status(httpStatus).json({ selected, results: web.results || [], status, error: web.error,
        unavailableSources: (web.issues || []).map(issue => issue.source) });
    } catch (error) { next(error); }
  }, (error, _req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'query_too_large' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    next(error);
  });
  return router;
}
module.exports = { createWebSearchRouter };
