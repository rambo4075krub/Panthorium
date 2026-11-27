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
    const token = text[0];
    const explicit = /^(?:[a-z][a-z\d+.-]*:|\/\/|www\.|localhost(?:[/:]|$))/iu.test(token);
    if (explicit || /^[^\s:/?#]+\.[^\s./:?#]+(?:[/:?#]|$)/u.test(token) || token.includes('@')) {
      const url = address(token, explicit);
      if (url) return {address:url};
    }
  }
  // Never transmit a pasted private address or credential-bearing URL as part of a keyword query.
  for (const token of text) if (/^(?:[a-z][a-z\d+.-]*:\/\/|\/\/)/iu.test(token)) searchUrl(token.startsWith('//') ? 'https:' + token : token, true);
  if (query.length > 300 || !query) throw Error('web_invalid_query');
  const terms = text.join(' ');
  return {query, terms, sites, words:words(terms), brand:compact(terms),
    groups:text.filter(s => /^[\p{Script=Thai}]+$/u.test(s) && !stop.has(s)).map(compact)};
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
  const heading = compact(domainToUnicode(url.hostname) + ' ' + path + ' ' + (entry.title || ''));
  const body = heading + ' ' + compact(entry.excerpt || '');
  const terms = intent.words;
  const present = terms.filter(word => body.includes(compact(word))).length;
  if (local && (!body.includes(compact(local.place)) || !body.includes(compact(local.word)))) return null;
  // For a Thai topic and place, matching just the place produces unrelated businesses and articles.
  if (intent.groups.length > 1 && intent.groups.length <= 3 && !intent.groups.every(group => body.includes(group))) return null;
  if (terms.length > 1 && present < Math.ceil(terms.length / 2)) return null;
  const exactSite = compact(domainToUnicode(parse(domain, suffixOptions).domainWithoutSuffix || '')) === intent.brand;
  const exactTitle = title === intent.brand;
  return (terms.length ? 9 * (1 - present / terms.length) : 0) -
    (exactSite ? 6 : 0) - (exactTitle ? 2 : 0) - (exactSite && url.pathname === '/' ? 3 : 0) -
    (terms.length ? 2 * terms.filter(word => heading.includes(compact(word))).length / terms.length : 0);
}
module.exports = { parseQuery, searchUrl, addressResult, matchesSite, siteGroup, relevance, words };
