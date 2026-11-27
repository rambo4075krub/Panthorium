'use strict';
const { Parser, DomUtils, parseDocument } = require('htmlparser2');
const { setTimeout: delay } = require('node:timers/promises');
const robotsParser = require('robots-parser');
const { PublicWebHttp, publicUrl } = require('./publicWebHttp');
const { parseQuery, addressResult, searchUrl, matchesSite, siteGroup, relevance } = require('./webSearchQuery');
const { placeQuery, placeWebsites } = require('./webSearchPlaces');
const { findSitePages } = require('./webSearchSitemap');
const BOT = 'PanthoriumPublicWeb';
const MESSAGES = {
  web_rate_limited: 'โควตาการอ่านข้อมูลฟรีถึงขีดจำกัดชั่วคราว กรุณาลองใหม่ภายหลัง ระบบจะไม่ใช้บริการเสียเงินแทน',
  web_access_restricted: 'แหล่งข้อมูลนี้จำกัดการเข้าถึง อาจต้องเข้าสู่ระบบหรือสมัครบริการ ระบบอ่านข้อมูลนี้แบบฟรีไม่ได้',
  web_payment_required: 'แหล่งข้อมูลนี้ต้องชำระเงินหรือสมัครสมาชิก ระบบใช้เฉพาะข้อมูลที่เข้าถึงได้ฟรี',
  web_robots_denied: 'เว็บไซต์นี้ไม่อนุญาตให้ระบบอ่านหน้าเว็บดังกล่าวโดยอัตโนมัติ',
  web_robots_unavailable: 'ยังตรวจสอบสิทธิ์การอ่านอัตโนมัติของเว็บไซต์นี้ไม่ได้ จึงยังไม่อ่านเนื้อหา',
  web_unsupported_content: 'ระบบอ่านได้เฉพาะหน้า HTML ข้อความ และ JSON ขนาดจำกัด ยังอ่านไฟล์หรือหน้าเว็บที่ต้องรัน JavaScript นี้ไม่ได้',
  web_invalid_url: 'กรุณาตรวจสอบที่อยู่เว็บไซต์และลองอีกครั้ง',
  web_unsafe_url: 'ลิงก์นี้ไม่ใช่หน้า HTTPS สาธารณะที่ระบบอนุญาตให้อ่าน',
  web_unsafe_address: 'ลิงก์นี้ชี้ไปยังเครือข่ายภายในหรือที่อยู่ที่ระบบไม่อนุญาตให้อ่าน',
  web_credentials_not_allowed: 'ลิงก์นี้มีข้อมูลกุญแจหรือโทเคน ระบบอ่านเฉพาะลิงก์สาธารณะที่ไม่ต้องใช้ข้อมูลรับรอง',
  web_empty_content: 'ยังไม่พบข้อความสาธารณะที่อ่านได้จากหน้านี้ อาจต้องใช้ JavaScript หรือเข้าสู่ระบบ',
  web_invalid_query: 'กรุณาใช้คำค้นไม่เกิน 300 ตัวอักษร หรือวางที่อยู่เว็บไซต์สาธารณะ',
  web_no_results: 'ไม่พบผลลัพธ์ในแหล่งค้นหาฟรีที่ระบบรองรับ ไม่ได้หมายความว่าไม่มีข้อมูลบนอินเทอร์เน็ต คุณส่งลิงก์สาธารณะมาให้อ่านได้',
  weather_location_unavailable: 'ยังหาพิกัดสถานที่นี้จากแหล่งฟรีไม่ได้ กรุณาระบุชื่อเมือง จังหวัดหรือประเทศให้ชัดเจน',
  weather_date_unavailable: 'แหล่งข้อมูลฟรีนี้ยังไม่มีพยากรณ์สำหรับวันที่ขอ',
  web_unavailable: 'ขณะนี้เข้าถึงข้อมูลจากแหล่งฟรีไม่ได้ กรุณาลองใหม่ภายหลัง หรือส่งลิงก์สาธารณะอื่น ระบบจะไม่ใช้บริการเสียเงินแทน'
};
function unavailable(error) {
  const code = String(error?.message || error || 'web_unavailable');
  return { available: false, freeOnly: true, error: code.startsWith('web_') || code.startsWith('weather_') ? code : 'web_unavailable',
    message: MESSAGES[code] || MESSAGES.web_unavailable, sources: [] };
}
function clean(value, max = 700) { return String(value || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function extractHtml(html) {
  const stack = [], text = [], title = [], scripts = [];
  let restricted = false, restrictionReason = null;
  const parser = new Parser({
    onopentag(name, attrs) {
      const parent = stack.at(-1);
      const hidden = parent?.hidden || ['title', 'script', 'style', 'noscript', 'template', 'svg', 'nav', 'footer', 'form', 'iframe'].includes(name) ||
        Object.hasOwn(attrs, 'hidden') || attrs['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || '');
      stack.push({ name, hidden, json: name === 'script' && /ld\+json/i.test(attrs.type || ''), jsonText: '' });
      if (name === 'meta' && /^(?:robots|panthoriumpublicweb)$/i.test(attrs.name || '') && /(?:noai|noindex|nosnippet|none)/i.test(attrs.content || '')) { restricted = true; restrictionReason = 'web_robots_denied'; }
      if (name === 'input' && attrs.type === 'password') { restricted = true; restrictionReason = 'web_access_restricted'; }
      if (name === 'meta' && /^(?:article:published_time|date)$/i.test(attrs.property || attrs.name || '')) scripts.push({ publishedAt: clean(attrs.content, 80) });
    },
    ontext(value) {
      const current = stack.at(-1);
      if (current?.json) current.jsonText += value;
      if (stack.some(entry => entry.name === 'title')) title.push(value);
      if (!current?.hidden && !stack.some(entry => entry.name === 'head')) text.push(value);
    },
    onclosetag() {
      const current = stack.pop();
      if (current?.json && /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(current.jsonText)) { restricted = true; restrictionReason = 'web_payment_required'; }
      if (current && ['p','div','article','section','li','br','h1','h2','h3'].includes(current.name)) text.push('\n');
    }
  }, { decodeEntities: true });
  parser.end(html);
  const content = text.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  // Never use embedded full-article data to bypass a visible subscription/login gate.
  if (/(?:subscribe to (?:continue|read|unlock)|sign in to (?:continue reading|read this)|verify you are human|checking your browser|สมัครสมาชิกเพื่ออ่าน|เข้าสู่ระบบเพื่ออ่าน|ชำระเงินเพื่ออ่าน)/i.test(content)) restricted = true;
  return { title: clean(title.join(' '), 240), content: content.slice(0, 6500), truncated: content.length > 6500, restricted,
    restrictionReason, publishedAt: scripts.find(item => item.publishedAt)?.publishedAt || null };
}
function infoboxWebsite(html) {
  if (typeof html !== 'string') return '';
  const document = parseDocument(html);
  const tables = DomUtils.findAll(node => node.name === 'table' && /\binfobox\b/u.test(node.attribs.class || ''), document.children);
  for (const table of tables) {
    for (const row of DomUtils.findAll(node => node.name === 'tr', table.children)) {
      const cells = row.children.filter(node => node.name === 'th' || node.name === 'td');
      if (!cells[1] || !/^(?:เว็บไซต์(?:ทางการ)?|(?:official )?web\s?site)$/iu.test(DomUtils.textContent(cells[0]).trim())) continue;
      for (const link of DomUtils.findAll(node => node.name === 'a', cells[1].children)) {
        const href = link.attribs.href || '';
        if (!/^(?:https?:)?\/\//iu.test(href)) continue;
        try { return searchUrl(href.startsWith('//') ? 'https:' + href : href).href; } catch {}
      }
    }
  }
  return '';
}
class PublicWebService {
  constructor({ http = new PublicWebHttp(), now = Date.now, enabled = process.env.PANTHORIUM_PUBLIC_WEB_ENABLED !== 'false', upstream = {} } = {}) {
    this.http = http; this.now = now; this.enabled = enabled;
    this.cache = upstream.cache || new Map(); this.inflight = upstream.inflight || new Map(); this.hosts = upstream.hosts || new Map();
    this.limits = new Map(); this.active = 0;
  }
  boundedSet(map, key, value, max = 128) {
    if (!map.has(key) && map.size >= max) map.delete(map.keys().next().value);
    map.set(key, value);
  }
  throttle(userId) {
    const minute = Math.floor(this.now() / 60000);
    for (const key of ['global', `user:${userId || 'unknown'}`]) {
      const limit = key === 'global' ? 60 : 12;
      const entry = this.limits.get(key);
      if (entry?.minute === minute && entry.count >= limit) throw new Error('web_rate_limited');
    }
    for (const key of ['global', `user:${userId || 'unknown'}`]) {
      const entry = this.limits.get(key);
      this.boundedSet(this.limits, key, { minute, count: entry?.minute === minute ? entry.count + 1 : 1 }, 1024);
    }
  }
  async execute(toolId, args, userId) {
    if (!this.enabled) return unavailable('web_unavailable');
    try {
      const intent = toolId === 'web.search' ? parseQuery(args.query) : null;
      if (intent?.address) {
        return { freeOnly:true, untrusted:true, available:true, coverage:'direct_address',
          results:[addressResult(intent.address)], sources:[], issues:[], message:'ที่อยู่ที่ผู้ใช้ระบุ ยังไม่ได้อ่านเนื้อหาจากเว็บไซต์' };
      }
      this.throttle(userId);
      if (this.active >= 4) throw new Error('web_rate_limited');
      this.active++;
      try {
        const context = { signal: AbortSignal.timeout(20000), requests: 0 };
        const result = toolId === 'web.search' ? await this.search(args, context, intent) : toolId === 'web.read' ? await this.read(args, context) :
          toolId === 'weather.get' ? await this.weather(args, context) : unavailable('web_unavailable');
        return { freeOnly: true, untrusted: true, ...result };
      } finally { this.active--; }
    } catch (error) { return unavailable(error); }
  }
  async request(value, context, ttl = 300000, paced = false) {
    const url = publicUrl(value);
    const key = url.href, now = this.now(), cached = this.cache.get(key);
    if (cached && cached.expires > now) return cached.response;
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (++context.requests > 8 || context.signal.aborted) throw new Error('web_timeout');
    const pending = (async () => {
      let budget = paced ? 2500 : 0;
      let host = this.hosts.get(url.hostname);
      while (host && (host.busy || host.until > this.now())) {
        const wait = Math.max(80, host.until - this.now());
        if (wait > budget) throw new Error('web_rate_limited');
        budget -= wait;
        await delay(wait, undefined, {signal:context.signal});
        host = this.hosts.get(url.hostname);
      }
      // Reserve the host only when the preceding request and its one-second interval have finished.
      this.boundedSet(this.hosts, url.hostname, { ...host, until: this.now() + 1000, busy: true });
      try {
        return await this.fetchResponse(key, context, ttl, cached);
      } finally {
        const state = this.hosts.get(url.hostname);
        if (state) state.busy = false;
      }
    })();
    this.inflight.set(key, pending);
    try { return await pending; } finally { this.inflight.delete(key); }
  }
  async fetchResponse(key, context, ttl, cached) {
    const url = new URL(key);
    let response = await this.http.get(key, { signal: context.signal,
      headers: cached?.response.headers['last-modified'] ? { 'If-Modified-Since': cached.response.headers['last-modified'] } : {} });
    if (response.status === 429 || response.status === 503) {
      const raw = response.headers['retry-after'];
      const delay = /^\d+$/.test(raw || '') ? Number(raw) * 1000 : Date.parse(raw) - this.now();
      this.boundedSet(this.hosts, url.hostname, { ...this.hosts.get(url.hostname), until: this.now() + Math.max(60000, Number.isFinite(delay) ? delay : 0) });
      throw new Error('web_rate_limited');
    }
    if (response.status === 402) throw new Error('web_payment_required');
    if ([401,403,407,451].includes(response.status)) throw new Error('web_access_restricted');
    if (response.status === 304 && cached) response = { ...cached.response, headers: { ...cached.response.headers, ...response.headers } };
    const expiresHeader = Date.parse(response.headers.expires);
    const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers['cache-control'] || '');
    const expires = Number.isFinite(expiresHeader) ? expiresHeader : this.now() + (maxAge ? Number(maxAge[1]) * 1000 : ttl);
    const retrievedAt = response.retrievedAt || new Date(this.now()).toISOString();
    response = { ...response, url: key, retrievedAt };
    if (((response.status >= 200 && response.status < 300) || [404,410].includes(response.status)) && !/no-store|private/i.test(response.headers['cache-control'] || '')) {
      this.boundedSet(this.cache, key, { response, expires: Math.max(this.now() + 1000, expires) }, 64);
    }
    return response;
  }
  async json(value, context, ttl = 300000) {
    // Built-in free API endpoints only. Redirects may not escape to a paid or credentialed endpoint.
    const origin = new URL(value).origin;
    for (let hop = 0; hop < 3; hop++) {
      const response = await this.request(value, context, ttl, true);
      if ([301,302,303,307,308].includes(response.status)) {
        const next = publicUrl(new URL(response.headers.location, value).href);
        if (next.origin !== origin) throw new Error('web_access_restricted');
        value = next.href; continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error('web_unavailable');
      if (!/application\/(?:[\w.+-]*\+)?json/i.test(response.headers['content-type'] || '') && !(origin === 'https://api.duckduckgo.com' && /^application\/x-javascript/i.test(response.headers['content-type'] || ''))) throw new Error('web_unsupported_content');
      try { return { data: JSON.parse(response.text), response }; } catch { throw new Error('web_unavailable'); }
    }
    throw new Error('web_unavailable');
  }
  async wikipedia(query, language, context, includeEntity = false) {
    const params = new URLSearchParams({ action:'query', format:'json', formatversion:'2', generator:'search', gsrsearch:query,
      gsrlimit:'5', gsrnamespace:'0', prop:'extracts|info|coordinates', exintro:'1', explaintext:'1', exsentences:'2', exlimit:'5', inprop:'url', redirects:'1' });
    if (includeEntity) { params.set('prop', 'extracts|info|pageprops'); params.set('ppprop', 'wikibase_item'); }
    const { data, response } = await this.json(`https://${language}.wikipedia.org/w/api.php?${params}`, context);
    if (data.error) throw new Error(['ratelimited','maxlag'].includes(data.error.code) ? 'web_rate_limited' : 'web_unavailable');
    return { response, pages: (data.query?.pages || []).sort((a,b) => (a.index || 0) - (b.index || 0)) };
  }
  async searchIndex(query, context) {
    const params = new URLSearchParams({ q: query });
    const { data, response } = await this.json(`https://api.mwmbl.org/api/v2/search/?${params}`, context);
    if (!Array.isArray(data.results)) throw new Error('web_unavailable');
    return data.results.slice(0, 40).map(entry => ({
      title: entry?.title, url: entry?.url, excerpt: entry?.content, retrievedAt: response.retrievedAt
    }));
  }
  async purili(query, context, page) {
    const params = new URLSearchParams({q:query, exact:'1', page:String(page)});
    const {data,response} = await this.json('https://puri.li/api/search?' + params, context);
    if (!Array.isArray(data.results)) throw Error('web_unavailable');
    const entries = data.results.slice(0,40).map(entry => ({title:entry?.title, url:entry?.url,
      excerpt:entry?.description, retrievedAt:response.retrievedAt}));
    return {entries, nextPage:data.hasNext === true && data.page === page && page < 1000 ? page + 1 : null};
  }
  async instantAnswers(query, context) {
    const params = new URLSearchParams({ q:query, format:'json', no_html:'1', no_redirect:'1', skip_disambig:'1' });
    const { data, response } = await this.json(`https://api.duckduckgo.com/?${params}`, context);
    const entries = [{ Text: data.AbstractText, FirstURL: data.AbstractURL, title: data.Heading }, ...(data.Results || [])];
    for (const topic of data.RelatedTopics || []) entries.push(...(topic.Topics || [topic]));
    return entries.filter(entry => entry.Text && entry.FirstURL).slice(0, 8).map(entry => ({
      title: entry.title || entry.Text, url: entry.FirstURL, excerpt: entry.Text, retrievedAt: response.retrievedAt
    }));
  }
  async officialWebsites(query, pages, language, context) {
    const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\s_]+/gu, ' ').trim();
    let page = pages.find(p => typeof p.title === 'string' && normalize(p.title) === normalize(query));
    if (!page) {
      if (query.length > 100 || /[|"<>:[\]]/u.test(query) || query.split(/\s+/u).length > 6) return [];
      // Wikipedia resolves exact brand aliases and redirects such as "Thai PBS" to the organization.
      const params = new URLSearchParams({action:'query',format:'json',formatversion:'2',titles:query,redirects:'1',prop:'pageprops',ppprop:'wikibase_item'});
      const {data} = await this.json('https://' + language + '.wikipedia.org/w/api.php?' + params, context);
      const candidate = data.query?.pages?.[0];
      if (!candidate || candidate.missing || candidate.ns !== 0 || !candidate.title) return [];
      page = candidate;
    }
    if (/^Q[1-9]\d{0,12}$/.test(page.pageprops?.wikibase_item || '')) {
      const id = page.pageprops.wikibase_item;
      const params = new URLSearchParams({action:'wbgetclaims',entity:id,property:'P856',format:'json'});
      const {data,response} = await this.json('https://www.wikidata.org/w/api.php?' + params, context);
      if (data.error) throw Error('web_unavailable');
      const claims = (data.claims?.P856 || []).filter(c => c.rank !== 'deprecated' && !c.qualifiers?.P582 && c.mainsnak?.snaktype === 'value');
      const usable = claims.flatMap(c => {
        try { return [{rank:c.rank, url:searchUrl(c.mainsnak.datavalue.value).href}]; } catch { return []; }
      });
      const preferred = usable.filter(c => c.rank === 'preferred');
      if (usable.length) return (preferred.length ? preferred : usable).slice(0,2).map(c => ({
        title:page.title, url:c.url, excerpt:'เว็บไซต์ที่ Wikidata ระบุสำหรับ ' + page.title, official:true, source:'Wikidata',
        recordUrl:'https://www.wikidata.org/wiki/' + id, retrievedAt:response.retrievedAt
      }));
    }
    if (!Number.isInteger(page.pageid) || page.pageid < 1) return [];
    const params = new URLSearchParams({action:'parse',pageid:page.pageid,section:'0',prop:'text',formatversion:'2',format:'json'});
    const {data,response} = await this.json('https://' + language + '.wikipedia.org/w/api.php?' + params, context);
    const site = infoboxWebsite(data.parse?.text);
    return site ? [{title:page.title,url:site,official:true,source:'Wikipedia',
      excerpt:'เว็บไซต์ที่ระบุในข้อมูลของ ' + page.title, recordUrl:'https://' + language + '.wikipedia.org/?curid=' + page.pageid,
      retrievedAt:response.retrievedAt}] : [];
  }
  async search({query, language, limit = 6, page = 1}, context, intent = parseQuery(query)) {
    language ||= /[\u0e00-\u0e7f]/.test(query) ? 'th' : 'en';
    // Mwmbl accepts ordinary terms. Apply site operators ourselves to every returned URL.
    const local = !intent.sites.length && placeQuery(intent.terms);
    const indexQuery = intent.sites.length ? [intent.terms, ...intent.sites.map(site => site.hostname)].join(' ') : query;
    const providers = [];
    if (page === 1) providers.push({name:'Mwmbl',offset:0,stride:1.5,request:this.searchIndex(indexQuery,context)});
    let nextPage = null;
    providers.push({name:'Purili',offset:1,stride:1.5,request:this.purili(query,context,page).then(result => {
      nextPage = result.nextPage;
      return result.entries;
    })});
    if (page === 1 && !intent.sites.length) {
      const wiki = this.wikipedia(query, language, context, true);
      providers.push(
        {name:'DuckDuckGo Instant Answers',offset:3,stride:3,request:this.instantAnswers(query, context)},
        {name:'Wikipedia',offset:3,stride:4,request:wiki.then(({pages,response}) => pages.map(page => ({
          title:page.title,url:page.fullurl || 'https://' + language + '.wikipedia.org/?curid=' + Number(page.pageid),
          excerpt:page.extract,license:'https://creativecommons.org/licenses/by-sa/4.0/',retrievedAt:response.retrievedAt
        })))},
        {name:'Wikidata',offset:-20,stride:2,request:wiki.then(({pages}) => this.officialWebsites(query,pages,language,context), () => [])}
      );
    }
    const replies = await Promise.allSettled(providers.map(provider => provider.request));
    const issues = [], ranked = [];
    for (const [index, reply] of replies.entries()) {
      const {name,offset,stride} = providers[index];
      if (reply.status === 'rejected') {
        issues.push({...unavailable(reply.reason),source:name});
        continue;
      }
      for (const [position,entry] of reply.value.entries()) {
        let url;
        try { url = searchUrl(entry.url); } catch { continue; }
        if (typeof entry.title !== 'string' || !entry.title.trim()) continue;
        if (intent.sites.length && !intent.sites.some(site => matchesSite(url,site))) continue;
        const wikiLanguage = /^([^.]+)(?:\.m)?\.wikipedia\.org$/.exec(url.hostname)?.[1];
        if (wikiLanguage && (url.searchParams.get('redlink') === '1' ||
            (url.searchParams.has('action') && url.searchParams.get('action') !== 'view'))) continue;
        const score = entry.official ? 0 : relevance(intent,url,entry,local);
        if (score === null) continue;
        ranked.push({rank:offset + position * stride + score + (wikiLanguage && wikiLanguage !== language ? 8 : 0),
          domain:siteGroup(url.hostname), result:{
            title:clean(entry.title,160), url:url.href, excerpt:clean(entry.excerpt,400), source:entry.source || name,
            retrievedAt:entry.retrievedAt, ...(entry.official ? {kind:'official'} : {}),
            ...(entry.license ? {license:entry.license} : {}), ...(entry.recordUrl ? {recordUrl:entry.recordUrl} : {})
          }});
      }
    }
    const results = [], seen = new Map(), domains = new Map();
    for (const {domain,result} of ranked.sort((a,b) => a.rank - b.rank)) {
      const previous = seen.get(result.url);
      if (previous) {
        if (result.license && !previous.license && previous.kind !== 'official') Object.assign(previous,result);
        continue;
      }
      if (results.length >= limit || (!intent.sites.length && (domains.get(domain) || 0) >= 3)) continue;
      seen.set(result.url,result);
      domains.set(domain,(domains.get(domain) || 0) + 1);
      results.push(result);
    }
    if (page === 1 && intent.sites.length === 1 && intent.words.length && results.length < Math.min(limit,5) && !context.signal.aborted) {
      try {
        for (const page of await findSitePages(this,intent,context)) {
          if (seen.has(page.url) || results.length >= limit) continue;
          const result = {title:clean(page.title,160),url:page.url,excerpt:page.excerpt,source:page.source,retrievedAt:page.retrievedAt};
          seen.set(result.url,result); results.push(result);
        }
      } catch { /* Independently indexed links are still usable if the site has no readable map. */ }
    }
    if (page === 1 && local && results.length < Math.min(5,limit) && context.requests <= 5) {
      try {
        const listings = await placeWebsites(this,local,context);
        const placesFirst = new Map();
        for (const entry of [...listings,...results]) if (!placesFirst.has(entry.url)) placesFirst.set(entry.url,entry);
        results.splice(0,results.length,...Array.from(placesFirst.values()).slice(0,limit));
      } catch (error) { issues.push({...unavailable(error),source:'Wikivoyage'}); }
    }
    if (!results.length) {
      const indexAvailable = replies.some((reply,i) => reply.status === 'fulfilled' && providers[i].name !== 'Wikidata');
      return {...unavailable(indexAvailable ? 'web_no_results' : issues[0]?.error),coverage:'limited_free_sources',nextPage,issues};
    }
    return {available:true, coverage:'limited_free_sources',message:'ผลจากดัชนีเว็บและแหล่งอ้างอิงสาธารณะ',
      results,sources:results.map(({excerpt,...source}) => source),nextPage,issues};
  }
  async robotRules(url, context) {
    const robotsUrl = `${url.origin}/robots.txt`;
    let target = robotsUrl;
    for (let hop = 0; hop < 4; hop++) {
      let response;
      try { response = await this.request(target, context, 3600000, true); }
      catch (error) { if (error.message === 'web_rate_limited') throw error; throw Error('web_robots_unavailable'); }
      if ([404,410].includes(response.status)) return null;
      if ([301,302,303,307,308].includes(response.status) && response.headers.location) {
        target = publicUrl(new URL(response.headers.location,target).href).href;
        continue;
      }
      if (response.status !== 200 || !/^text\/plain/i.test(response.headers['content-type'] || '')) break;
      return robotsParser(robotsUrl,response.text);
    }
    throw Error('web_robots_unavailable');
  }
  checkCrawlDelay(url, rules) {
    const delay = rules?.getCrawlDelay(BOT);
    // Respect requested delay without making the conversation wait indefinitely.
    if (Number(delay) > 0) {
      const state = this.hosts.get(url.hostname);
      if (state?.lastPageAt && this.now() - state.lastPageAt < Number(delay)*1000) throw new Error('web_rate_limited');
    }
  }
  async robots(url, context) {
    const rules = await this.robotRules(url,context);
    if (rules?.isAllowed(url.href,BOT) === false) throw Error('web_robots_denied');
    this.checkCrawlDelay(url,rules);
  }
  async read({ url: value }, context) {
    for (let hop = 0; hop < 4; hop++) {
      const url = publicUrl(value);
      await this.robots(url, context);
      // robots and page fetch are a single user read, allow the second request while keeping host cooldowns.
      const state = this.hosts.get(url.hostname);
      if (state && state.until <= this.now() + 1000) state.until = this.now();
      const response = await this.request(url.href, context);
      const current = this.hosts.get(url.hostname); if (current) current.lastPageAt = this.now();
      if ([301,302,303,307,308].includes(response.status)) {
        if (!response.headers.location) throw new Error('web_unavailable');
        value = new URL(response.headers.location, url).href; continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error('web_unavailable');
      if (/noai|nosnippet|noindex|none/i.test(response.headers['x-robots-tag'] || '')) throw new Error('web_robots_denied');
      const type = response.headers['content-type'] || '';
      let page;
      if (/^(?:text\/html|application\/xhtml\+xml)/i.test(type)) page = extractHtml(response.text);
      else if (/^(?:text\/plain|application\/json)(?:;|$)/i.test(type)) page = { content:response.text.slice(0,6500), truncated:response.text.length > 6500, title:url.hostname };
      else throw new Error('web_unsupported_content');
      if (page.restricted) throw new Error(page.restrictionReason || 'web_access_restricted');
      if (!page.content.trim()) throw new Error('web_empty_content');
      return { available:true, ...page, url:url.href, retrievedAt:response.retrievedAt,
        sources:[{ title:page.title || url.hostname, url:url.href, retrievedAt:response.retrievedAt, publishedAt:page.publishedAt || null }] };
    }
    throw new Error('web_too_many_redirects');
  }
  async weather({ location, language, date, timeZone = 'Asia/Bangkok' }, context) {
    language ||= /[\u0e00-\u0e7f]/.test(location) ? 'th' : 'en';
    const { pages, response: geoResponse } = await this.wikipedia(location, language, context);
    const places = pages.filter(page => page.coordinates?.some(c => c.globe === 'earth' && Number.isFinite(c.lat) && Number.isFinite(c.lon)));
    const exact = places.filter(page => page.title.toLocaleLowerCase() === location.trim().toLocaleLowerCase());
    const selected = exact.length === 1 ? exact[0] : places.length === 1 ? places[0] : null;
    if (!selected) return places.length ? { available:false, error:'weather_location_ambiguous', message:'พบหลายสถานที่ กรุณาระบุสถานที่จากรายการให้ชัดเจน',
      candidates:places.map(page => ({ title:clean(page.title,200), url:publicUrl(page.fullurl).href })), sources:[] } : unavailable('weather_location_unavailable');
    const coordinates = selected.coordinates.find(c => c.globe === 'earth');
    const lat = Number(coordinates.lat.toFixed(4)), lon = Number(coordinates.lon.toFixed(4));
    if (Math.abs(lat)>90 || Math.abs(lon)>180) throw new Error('weather_location_unavailable');
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
    const { data, response } = await this.json(url, context, 1800000);
    const day = value => new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
    const target = date || day(this.now());
    const series = data.properties?.timeseries?.filter(item => day(item.time) === target) || [];
    if (!series.length) return unavailable('weather_date_unavailable');
    return { available:true, kind:'forecast_not_observation', location:clean(selected.title,200), latitude:lat, longitude:lon, date:target, timeZone,
      updatedAt:data.properties.meta.updated_at, retrievedAt:response.retrievedAt, units:data.properties.meta.units,
      periods:series.slice(0,24).map(item => ({ time:item.time, temperatureC:item.data.instant.details.air_temperature, humidityPercent:item.data.instant.details.relative_humidity, windSpeedMps:item.data.instant.details.wind_speed,
        ...(item.data.next_1_hours ? { next1Hours:item.data.next_1_hours } : item.data.next_6_hours ? { next6Hours:item.data.next_6_hours } : {}) })),
      attribution:'Data from MET Norway; selected forecast periods, summarized by Panthorium',
      sources:[{ title:'MET Norway', url, license:'https://creativecommons.org/licenses/by/4.0/', retrievedAt:response.retrievedAt },
        { title:clean(selected.title,200), url:publicUrl(selected.fullurl).href, retrievedAt:geoResponse.retrievedAt, source:'Wikipedia coordinates' }] };
  }
}
module.exports = { PublicWebService, extractHtml, unavailable };
