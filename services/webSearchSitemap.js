'use strict';
const { Parser } = require('htmlparser2');
const { searchUrl, matchesSite } = require('./webSearchQuery');

function sitemap(text) {
  const path = [], urls = [];
  let value = '';
  const parser = new Parser({
    onopentag(name) { path.push(name); if (name === 'loc') value = ''; },
    ontext(chunk) { if (path.at(-1) === 'loc' && value.length <= 2048) value += chunk; },
    onclosetag() {
      if (path.length === 3 && path[2] === 'loc' && value.trim() && value.length <= 2048 &&
          ((path[0] === 'urlset' && path[1] === 'url') || (path[0] === 'sitemapindex' && path[1] === 'sitemap'))) {
        urls.push({value:value.trim(), child:path[0] === 'sitemapindex'});
      }
      path.pop();
    }
  }, {xmlMode:true, decodeEntities:true});
  parser.end(text);
  return urls;
}
// Read only public maps for a host explicitly named in site:. Never spider the result pages.
async function findSitePages(service, intent, context) {
  const site = intent.sites[0], rules = await service.robotRules(site, context);
  const permitted = url => rules?.isAllowed(url.href, 'PanthoriumPublicWeb') !== false;
  const maps = [];
  function addMap(raw) {
    let url;
    try { url = searchUrl(raw); } catch { return; }
    if (url.origin === site.origin && !url.pathname.endsWith('.gz') && permitted(url) && !maps.includes(url.href)) maps.push(url.href);
  }
  for (const raw of rules?.getSitemaps() || []) addMap(raw);
  if (!maps.length) addMap(new URL('/sitemap.xml',site).href);
  const found = new Map();
  for (let i = 0; i < Math.min(3,maps.length) && found.size < 24; i++) {
    service.checkCrawlDelay(site, rules);
    const response = await service.request(maps[i], context, 3600000, true);
    const host = service.hosts.get(site.hostname);
    if (host) host.lastPageAt = service.now();
    if (response.status !== 200 || !/^(?:application|text)\/(?:[\w.+-]*\+)?xml\b/i.test(response.headers['content-type'] || '')) continue;
    for (const loc of sitemap(response.text)) {
      if (loc.child) { if (maps.length < 32) addMap(loc.value); continue; }
      let url, path;
      try { url = searchUrl(loc.value); path = decodeURIComponent(url.pathname).normalize('NFKC').toLowerCase(); } catch { continue; }
      if (url.origin !== site.origin || !matchesSite(url,site) || !permitted(url) || !intent.words.length) continue;
      const matched = intent.words.filter(word => path.includes(word)).length;
      if (!matched || matched < Math.ceil(intent.words.length * .7)) continue;
      const title = path.split('/').filter(Boolean).at(-1)?.replace(/[-_]+/g,' ') || url.hostname;
      found.set(url.href,{matched,title,url:url.href,excerpt:'พบคำค้นในที่อยู่หน้าที่เว็บไซต์ประกาศไว้',retrievedAt:response.retrievedAt,source:'Sitemap'});
      if (found.size >= 24) break;
    }
  }
  return [...found.values()].sort((a,b) => b.matched - a.matched);
}
module.exports = {findSitePages};
