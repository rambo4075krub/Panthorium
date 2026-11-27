'use strict';
const { DomUtils, parseDocument } = require('htmlparser2');
const { searchUrl } = require('./webSearchQuery');

const topics = [
  {words:['ร้านหนังสือ'], section:'Buy', match:/\bbook\s*(?:shop|store)s?\b|\b(?:new|used|second[- ]hand) books\b/i},
  {words:['พิพิธภัณฑ์'], section:'See', match:/\bmuseums?\b/i},
  {words:['หอศิลป์','แกลเลอรี'], section:'See', match:/\b(?:art|galler(?:y|ies))\b/i},
  {words:['ตลาด'], section:'Buy', match:/\b(?:markets?|bazaar|souq)\b/i},
  {words:['ร้านอาหาร','ภัตตาคาร'], section:'Eat'},
  {words:['ร้านกาแฟ','คาเฟ่'], section:'Drink', match:/\bcoffee\b|caf[eé]/i},
  {words:['โรงแรมหรู'], section:'Sleep', match:/\bluxur(?:y|ious)\b|\bfive[- ]star\b|\b5[- ]star\b/i},
  {words:['โรงแรม','ที่พัก'], section:'Sleep'}
];
function placeQuery(query) {
  for (const topic of topics) for (const word of topic.words) {
    let place;
    if (query.startsWith(word)) place = query.slice(word.length).trim().replace(/^(?:ใน|ที่|แถว)\s*/u,'');
    else if (query.endsWith(word)) place = query.slice(0,-word.length).trim();
    if (place && place.length < 70 && /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'-]*$/u.test(place)) return {topic,word,place};
  }
  return null;
}
async function guidesApi(service, host, params, context) {
  return service.json('https://' + host + '/w/api.php?' +
    new URLSearchParams({format:'json',formatversion:'2',...params}),context,3600000);
}
const hasClass = (node,name) => (node.attribs?.class || '').split(/\s+/u).includes(name);
async function placeWebsites(service, {topic,word,place}, context) {
  let title = place;
  if (/[ก-๙]/u.test(place)) {
    const {data} = await guidesApi(service,'th.wikipedia.org',{action:'query',titles:place,redirects:'1',
      prop:'coordinates|langlinks',lllang:'en'},context);
    const area = data.query?.pages?.[0];
    if (!area?.coordinates?.length || !area.langlinks?.[0]?.title) return [];
    title = area.langlinks[0].title.replace(/ (?:province|district)$/iu,'');
  }
  const host = 'en.wikivoyage.org';
  const {data} = await guidesApi(service,host,{action:'parse',page:title,redirects:'1',prop:'sections|revid'},context);
  const guide = data.parse;
  const section = guide?.sections?.find(item => item.line === topic.section && /^\d+$/u.test(item.index));
  if (!section || !Number.isSafeInteger(guide.pageid) || guide.pageid < 1) return [];
  const revision = Number.isSafeInteger(guide.revid) ? {oldid:String(guide.revid)} : {pageid:String(guide.pageid)};
  const {data:article,response} = await guidesApi(service,host,{action:'parse',...revision,section:section.index,prop:'text'},context);
  if (typeof article.parse?.text !== 'string') return [];
  const doc = parseDocument(article.parse.text), results = [];
  const recordUrl = 'https://' + host + '/?curid=' + guide.pageid + '#' + topic.section;
  for (const listing of DomUtils.findAll(node => hasClass(node,'vcard'),doc.children)) {
    const name = DomUtils.findOne(node => hasClass(node,'listing-name'),listing.children);
    const link = name && DomUtils.findOne(node => node.name === 'a' && hasClass(node,'external'),name.children);
    if (!link) continue;
    const label = DomUtils.textContent(name).trim();
    const details = DomUtils.findOne(node => hasClass(node,'listing-content'),listing.children);
    if (!label || (topic.match && !topic.match.test(label + ' ' + (details ? DomUtils.textContent(details) : '')))) continue;
    let url;
    try { url = searchUrl(new URL(link.attribs.href,'https://' + host).href); } catch { continue; }
    if (url.hostname === host) continue;
    results.push({title:label.slice(0,160),url:url.href,source:'Wikivoyage',retrievedAt:response.retrievedAt,
      excerpt:word + ' · ' + place,recordUrl,license:'https://creativecommons.org/licenses/by-sa/4.0/'});
    if (results.length === 12) break;
  }
  return results;
}
module.exports = {placeQuery,placeWebsites};
