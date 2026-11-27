'use strict';
const { domainToUnicode } = require('node:url');
const { parse, getDomain } = require('tldts');
const { publicUrl } = require('./publicWebHttp');

const suffixOptions = { allowPrivateDomains:true };
const compact = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const segmenter = new Intl.Segmenter('th', {granularity:'word'});
const stop = new Set(['the','a','an','of','to','in','on','at','for','and','or','จาก','ใน','ที่','ของ','และ','หรือ','กับ','เว็บไซต์','เว็บไซต์ทางการ']);
function words(text) {
  return [...new Set(Array.from(segmenter.segment(text.normalize('NFKC').toLowerCase()), item => item.isWordLike ? item.segment : '')
    .filter(word => word && !stop.has(word)))].slice(0,32);
}
function searchUrl(value, keepFragment = false) {
  const original = new URL(value);
  if (original.protocol === 'http:' && !original.port) original.protocol = 'https:';
  const url = publicUrl(original.href);
  if (!keepFragment) {
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.*|fbclid|gclid|mibextid)$/iu.test(key)) url.searchParams.delete(key);
  }
  if (keepFragment && original.hash) {
    if (/(?:token|secret|signature|password|credential|authorization|api[_-]?key)\s*=/i.test(original.hash)) throw Error('web_credentials_not_allowed');
    url.hash = original.hash;
  }
  return url;
}
function address(text, explicit) {
  let parsed;
  const hostAndPort = /^[^/:?#]+\.[^/:?#]+:\d+(?:[/?#]|$)/u.test(text);
  try { parsed = new URL(text.startsWith('//') ? 'https:' + text : !hostAndPort && /^[a-z][a-z\d+.-]*:/iu.test(text) ? text : 'https://' + text); }
  catch { if (explicit) throw Error('web_unsafe_url'); return null; }
  const parts = parse(parsed.hostname, suffixOptions);
  if (explicit || parts.isIcann || parts.isPrivate || parts.isIp || parsed.username || parsed.password || /\.local(?:host)?$|\.internal$|\.invalid$|\.test$|^localhost$/i.test(parsed.hostname)) {
    return searchUrl(parsed.href, true);
  }
  return null;
}
function destination(token) {
  const explicit = /^(?:[a-z][a-z\d+.-]*:|\/\/|www\.|localhost(?:[/:]|$))/iu.test(token);
  return explicit || /^[^\s:/?#]+\.[^\s./:?#]+(?:[/:?#]|$)/u.test(token) || token.includes('@') ? address(token, explicit) : null;
}
// Interpret requests for a named site without changing quoted text, operators or ordinary questions.
function websiteName(query) {
  if (/["“”|]/u.test(query) || /\s[-+]\S|(?:^|\s)(?:intitle|inurl|filetype|before|after):/iu.test(query)) return '';
  const polite = query.replace(/^(?:ช่วย|กรุณา|please\s+)\s*/iu,'').replace(/\s*(?:ให้หน่อย|หน่อย|นะครับ|นะคะ|ครับ|ค่ะ)[.!]*$/u,'');
  const match = /^(?:(?:ขอ|หา|ค้นหา|เปิด)\s*)?(?:เว็บไซต์|เว็ปไซต์|เว็บ|เว็ป)\s*(?:อย่างเป็นทางการ|ทางการ|หลัก|ของ)\s*(?:ของ\s*)?(.+)$/u.exec(polite) ||
    /^(?:ขอ|เปิด)\s*(?:เว็บไซต์|เว็ปไซต์|เว็บ|เว็ป)\s*(.+)$/u.exec(polite) ||
    /^(?:เว็บไซต์|เว็ปไซต์|เว็บ|เว็ป)\s*((?:กรม|กระทรวง|มหาวิทยาลัย|ธนาคาร|สมาคม|บริษัท|การรถไฟ|การบิน)\S.*)$/u.exec(polite) ||
    /^(.+?)\s+(?:เว็บไซต์|เว็บ)(?:อย่างเป็นทางการ|ทางการ|หลัก)$/u.exec(polite) ||
    /^(?:(?:find|open|show)\s+(?:me\s+)?)?(?:the\s+)?official\s+(?:website|web\s?site|site)\s+(?:of|for)\s+(.+)$/iu.exec(polite) ||
    /^(.+?)\s+official\s+(?:website|web\s?site|site)$/iu.exec(polite);
  const name = match?.[1].trim();
  if (!name || /^(?:คือ|ที่|อย่างไร|อะไร|ของ$)/u.test(name)) return '';
  return name;
}
function parseQuery(value) {
  const query = String(value || '').trim();
  const sites = [], text = [];
  for (const token of query.split(/\s+/u)) {
    if (!/^site:/iu.test(token)) { text.push(token); continue; }
    const target = token.slice(5);
    if (!target || /[?#@]/u.test(target)) throw Error('web_unsafe_url');
    const url = address(target, true);
    sites.push(url);
  }
  if (sites.length && !text.length && sites.length === 1) return {address:sites[0]};
  if (!sites.length && text.length === 1) {
    const url = destination(text[0]);
    if (url) return {address:url};
  }
  // Never transmit a pasted private address or credential-bearing URL as part of a keyword query.
  for (const token of text) if (/^(?:[a-z][a-z\d+.-]*:\/\/|\/\/)/iu.test(token)) searchUrl(token.startsWith('//') ? 'https:' + token : token, true);
  const requestedName = sites.length ? '' : websiteName(query);
  if (requestedName && !/\s/u.test(requestedName)) {
    const url = destination(requestedName);
    if (url) return {address:url};
  }
  if (query.length > 300 || !query) throw Error('web_invalid_query');
  const officialName = requestedName.length <= 100 ? requestedName : '';
  const terms = officialName || text.join(' ');
  return {query, terms, officialName, sites, words:words(terms), brand:compact(terms),
    groups:terms.split(/\s+/u).filter(s => /^[\p{Script=Thai}]+$/u.test(s) && !stop.has(s)).map(compact)};
}
function addressResult(url) {
  return {kind:'address', title:domainToUnicode(url.hostname) + (url.pathname === '/' ? '' : url.pathname),
    url:url.href, source:'ที่อยู่ที่คุณระบุ', excerpt:'เปิดที่อยู่เว็บไซต์นี้ใน Panthorium Browser'};
}
function matchesSite(url, site) {
  return (url.hostname === site.hostname || url.hostname.endsWith('.' + site.hostname)) &&
    (site.pathname === '/' || url.pathname === site.pathname || url.pathname.startsWith(site.pathname.replace(/\/$/, '') + '/'));
}
function siteGroup(host) { return getDomain(host, suffixOptions) || host; }
function relevance(intent, url, entry, local) {
  const domain = siteGroup(url.hostname);
  const title = compact(entry.title || '');
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch {}
  // Some indexes contain other sites' on-demand search pages. Their titles echo
  // arbitrary terms even when the site has no corresponding article or product.
  const isSearchPath = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/?)?$/iu.test(path) ||
    /(?:^|\/)(?:search|search-results|results)(?:\.[a-z]+)?\/?$/iu.test(path);
  const searchListing = !intent.sites.length && isSearchPath && [...url.searchParams].some(([key,value]) =>
    /^(?:s|q|query|search|search_query|keywords?)$/iu.test(key) && /\p{L}/u.test(value));
  const location = compact(domainToUnicode(url.hostname) + ' ' + path);
  const heading = location + ' ' + title;
  const excerpt = compact(entry.excerpt || '');
  const body = heading + ' ' + excerpt;
  const terms = intent.words;
  const present = terms.filter(word => body.includes(compact(word))).length;
  if (local && (!body.includes(compact(local.place)) || !body.includes(compact(local.word)))) return null;
  // For a Thai topic and place, matching just the place produces unrelated businesses and articles.
  if (intent.groups.length > 1 && intent.groups.length <= 3 && !intent.groups.every(group => body.includes(group))) return null;
  if (terms.length > 1 && present < Math.ceil(terms.length / 2)) return null;
  const exactSite = compact(domainToUnicode(parse(domain, suffixOptions).domainWithoutSuffix || '')) === intent.brand;
  const exactTitle = title === intent.brand;
  const headingMatches = terms.filter(word => heading.includes(compact(word))).length;
  let evidencePenalty = 0;
  if (!intent.sites.length && terms.length && !exactSite && !exactTitle) {
    if (!headingMatches) evidencePenalty = 8;
    else if (!excerpt && path !== '/' && !terms.some(word => location.includes(compact(word)))) evidencePenalty = 18;
  }
  return (searchListing ? 36 : 0) + evidencePenalty + (terms.length ? 9 * (1 - present / terms.length) : 0) -
    (exactSite ? 6 : 0) - (exactTitle ? 2 : 0) - (exactSite && url.pathname === '/' ? 3 : 0) -
    (terms.length ? 2 * headingMatches / terms.length : 0);
}
module.exports = { parseQuery, searchUrl, addressResult, matchesSite, siteGroup, relevance, words };
