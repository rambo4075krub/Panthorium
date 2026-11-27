'use strict';
const assert = require('node:assert/strict');
const { parseQuery } = require('../services/webSearchQuery');

module.exports = async function externalWebSearch(fixture, response) {
  const direct = fixture(() => { throw Error('An address must not be sent to a search index'); });
  for (const [input,expected] of [
    ['nhs.uk','https://nhs.uk/'], ['http://www.python.org/downloads/','https://www.python.org/downloads/'],
    ['example.org:443/docs?v=2#usage','https://example.org/docs?v=2#usage'],
    ['เปิดเว็บ https://example.org/about/#team','https://example.org/about/#team'],
    ['ขอเว็บ example.org/' + 'p'.repeat(320),'https://example.org/' + 'p'.repeat(320)],
    ['หมอพร้อม.ไทย',new URL('https://หมอพร้อม.ไทย').href], ['site:docs.example.org','https://docs.example.org/']
  ]) {
    const result = await direct.service.execute('web.search',{query:input},'visitor');
    assert.equal(result.results[0].url,expected);
    assert.equal(result.results[0].kind,'address');
    assert.deepEqual(result.sources,[]);
  }
  for (const input of ['http://user:pass@example.org','https://portal.example.org/#access_token=private',
    'ดู https://portal.example.org/?access_token=private','ftp://files.example.org','https://127.0.0.1',
    'ขอเว็บ example.org/?access_token=private','เปิดเว็บไซต์ https://localhost/private',
    'site:localhost query','site:intranet.internal entry','example.org:8080/path']) {
    assert.equal((await direct.service.execute('web.search',{query:input},'visitor')).available,false,input);
  }
  assert.equal(direct.requests.length,0);
  assert.equal(direct.service.limits.size,0);
  assert.equal(parseQuery('Node.js').terms,'Node.js');
  for (const [query,name] of [['เว็บไซต์ทางการของการบินไทย','การบินไทย'],['ขอเว็บกรมสรรพากร','กรมสรรพากร'],
    ['ช่วยหาเว็บไซต์ของธนาคารแห่งประเทศไทยให้หน่อย','ธนาคารแห่งประเทศไทย'],['official website of OpenStreetMap','OpenStreetMap'],
    ['PRN official website','PRN']]) assert.equal(parseQuery(query).officialName,name);
  for (const query of ['เว็บไซต์คืออะไร','official website design tips','"official website of PRN"','site:example.org official website of PRN']) {
    assert.equal(parseQuery(query).officialName,'');
  }
  const topic = fixture(url => {
    if (url.hostname === 'puri.li') {
      assert.equal(url.searchParams.get('exact'),'1');
      return response({results:[
        {title:'ร้านหนังสือเชียงใหม่',url:'https://shop.example.org/books',description:'หนังสือเก่าและใหม่'},
        {title:'ร้านกาแฟ เชียงใหม่',url:'https://cafe.example.net/',description:'เมล็ดกาแฟในเชียงใหม่'}
      ]});
    }
    if (url.hostname === 'th.wikipedia.org') return response({query:{pages:[{pageid:1,title:'ท่าอากาศยานเชียงใหม่',extract:'สนามบินที่เชียงใหม่'}]}});
    return response({results:[]});
  });
  const local = await topic.service.execute('web.search',{query:'ร้านหนังสือ เชียงใหม่'},'visitor');
  assert.deepEqual(local.results.map(item => item.url),['https://shop.example.org/books']);
  assert.equal(local.results[0].source,'Purili');

  let time = Date.now();
  const liveClock = () => (time += 1200);
  const indexed = fixture(url => {
    if (url.hostname === 'puri.li') return response({results:[
      {title:'Blue Skies – site search',url:'https://catalog.example.org/az?s=Blue+Skies',description:'Search for Blue Skies'},
      {title:'Blue Skies – unrelated promotion',url:'https://offers.example.net/th/abc/4.html'},
      {title:'Hardware reference',url:'https://parts.example.com/component/10',description:'In the footer: Blue Skies'},
      {title:'Blue Skies passenger guide',url:'https://travel.example.org/guide/blue-skies',description:'Independent guide to Blue Skies travel'},
      {title:'Blue Skies route map',url:'https://maps.example.net/routes?q=Blue+Skies',description:'Network served by Blue Skies'}
    ]});
    return response({results:[],query:{pages:[]}});
  },liveClock);
  const broad = await indexed.service.execute('web.search',{query:'Blue Skies'},'visitor');
  const hits = broad.results.map(item => item.url);
  assert.equal(hits[0],'https://travel.example.org/guide/blue-skies');
  assert(hits.indexOf('https://maps.example.net/routes?q=Blue+Skies') < hits.indexOf('https://offers.example.net/th/abc/4.html'));
  assert.equal(hits.at(-1),'https://catalog.example.org/az?s=Blue+Skies');
  const targeted = await indexed.service.execute('web.search',{query:'site:catalog.example.org Blue Skies'},'visitor');
  assert.equal(targeted.results[0].url,'https://catalog.example.org/az?s=Blue+Skies');
  const places = fixture(url => {
    if (url.hostname === 'puri.li') return response({results:[
      {title:'ประสบการณ์ ร้านหนังสือ มาดริด',url:'https://traveler.example.com/madrid'},
      {title:'ร้านหนังสือออนไลน์',url:'https://download.example.com/app'}
    ]});
    if (url.searchParams.get('prop') === 'coordinates|langlinks') return response({query:{pages:[{coordinates:[{lat:40,lon:-3}],langlinks:[{title:'Madrid'}]}]}});
    if (url.hostname === 'en.wikivoyage.org') {
      if (url.searchParams.get('page') === 'Madrid') return response({parse:{pageid:72,revid:43,sections:[{index:'8',line:'Buy'}]}});
      assert.equal(url.searchParams.get('oldid'),'43');
      return response({parse:{text:'<div class="vcard"><span class="listing-name"><a class="external" href="https://books.example.org/">La Librería</a></span><span class="listing-content">An independent bookstore.</span></div><div class="vcard"><span class="listing-name"><a class="external" href="https://cafe.example.org/">Coffee shop</a></span></div><a class="external" href="https://other.example.org/">Advertising</a>'}});
    }
    return response({results:[],query:{pages:[]}});
  },liveClock);
  const madrid = await places.service.execute('web.search',{query:'ร้านหนังสือ มาดริด'},'visitor');
  assert.deepEqual(madrid.results.map(x=>x.url),['https://books.example.org/','https://traveler.example.com/madrid']);
  assert.equal(madrid.results[0].recordUrl,'https://en.wikivoyage.org/?curid=72#Buy');
  assert(places.requests.length <= 8);
  const official = fixture(url => {
    if (url.host === 'en.wikipedia.org') {
      if (url.searchParams.has('generator')) return response({query:{pages:[{pageid:1,ns:0,title:'Public Radio Network'}]}});
      if (url.searchParams.get('titles') === 'PRN') return response({query:{pages:[{pageid:1,ns:0,title:'Public Radio Network',pageprops:{wikibase_item:'Q123'}}]}});
    }
    if (url.hostname === 'www.wikidata.org') return response({claims:{P856:[
      {rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:'https://old.example.com/'}}},
      {rank:'preferred',mainsnak:{snaktype:'value',datavalue:{value:'http://prn.example.org/'}}}
    ]}});
    return response({results:[]});
  },liveClock);
  const named = await official.service.execute('web.search',{query:'เว็บไซต์ทางการของ PRN'},'visitor');
  assert.equal(named.broaderQuery,'PRN');
  assert.deepEqual(named.results.map(item=>item.url),['https://prn.example.org/']);
  assert(official.requests.every(item=>['en.wikipedia.org','www.wikidata.org'].includes(new URL(item.url).hostname)));
  const radio = await official.service.execute('web.search',{query:'PRN'},'visitor');
  assert.equal(radio.results[0].url,'https://prn.example.org/');
  assert.equal(radio.results[0].kind,'official');
  assert(!radio.results.some(item => item.url.includes('old.example.com')));
  const missing = fixture(url => url.hostname === 'puri.li' ? response({results:[{title:'Review of Acme',url:'https://independent.example.org/acme'}]}) : response({results:[],query:{pages:[]}}),liveClock);
  const alternative = await missing.service.execute('web.search',{query:'Acme official website'},'visitor');
  assert(!alternative.broaderQuery);
  assert.equal(alternative.results[0].url,'https://independent.example.org/acme');
  assert(!alternative.results[0].kind);
  const noisy = fixture(url => url.hostname === 'puri.li' ? response({results:[
    {title:'บทความภาพยนตร์',url:'https://cinema.example.org/review',description:'ภาคต่อของภาพยนตร์ที่ถ่ายในกรุง'},
    {title:'กรุงสันภาคอน',url:'https://catalog.example.org/search?q=กรุงสันภาคอน'}
  ]}) : response({results:[],query:{pages:[]}}),liveClock);
  const heardName = 'กรุงสันภาคอน';
  const unrelated = await noisy.service.execute('web.search',{query:'ขอเว็บ'+heardName},'visitor');
  assert.equal(unrelated.error,'web_no_results');
  assert.equal(unrelated.broaderQuery,heardName);
  const wider = await noisy.service.execute('web.search',{query:heardName},'visitor');
  assert(wider.results.some(item => item.url === 'https://cinema.example.org/review'));
  const box = fixture(url => {
    if (url.hostname === 'th.wikipedia.org' && url.searchParams.has('generator')) return response({query:{pages:[{pageid:17,title:'หน่วยงานทดลอง',pageprops:{wikibase_item:'Q18'}}]}});
    if (url.searchParams.get('action') === 'parse') return response({parse:{text:'<a href="https://wrong.example.org/">Sponsor</a><table class="infobox"><tr><th>เว็บไซต์</th><td><a href="http://dept.example.org">ต้นทาง</a></td></tr></table>'}});
    return response({results:[]});
  },liveClock);
  const organization = await box.service.execute('web.search',{query:'หน่วยงานทดลอง'},'visitor');
  assert.equal(organization.results[0].url,'https://dept.example.org/');
  assert.equal(organization.results[0].recordUrl,'https://th.wikipedia.org/?curid=17');

  const scoped = fixture(url => {
    if (url.hostname === 'api.mwmbl.org') return response({results:[
      {title:'CSS grid',url:'https://docs.example.org/guide/grid'},
      {title:'CSS grid',url:'https://docs.example.org.evil.com/'},
      {title:'CSS grid',url:'https://other.example.org/'}
    ]});
    if (url.hostname === 'puri.li') return response({results:[]});
    assert.equal(url.hostname,'docs.example.org');
    if (url.pathname === '/robots.txt') return response('User-agent: *\nDisallow: /private/\nSitemap: https://docs.example.org/maps.xml',200,'text/plain');
    if (url.pathname === '/maps.xml') return response('<sitemapindex><sitemap><loc>https://docs.example.org/pages.xml</loc></sitemap><sitemap><loc>https://other.example.org/map.xml</loc></sitemap></sitemapindex>',200,'application/xml');
    assert.equal(url.pathname,'/pages.xml');
    const paths=['/learn/css-grid','/private/css-grid','/other','https://other.example.org/css-grid'];
    return response('<urlset>'+paths.map(x=>'<url><loc>'+new URL(x,url).href+'</loc></url>').join('')+'</urlset>',200,'text/xml');
  },liveClock);
  const pages = await scoped.service.execute('web.search',{query:'site:docs.example.org CSS grid'},'visitor');
  assert.deepEqual(pages.results.map(x=>x.url),['https://docs.example.org/guide/grid','https://docs.example.org/learn/css-grid']);
  assert.equal(pages.results[1].source,'Sitemap');

  const continued = fixture(url => {
    assert.equal(url.hostname,'puri.li');
    assert.equal(url.searchParams.get('page'),'2');
    return response({page:2,hasNext:true,results:[
      {title:'CSS grid examples',url:'https://docs.example.org/advanced/css-grid'},
      {title:'CSS grid examples',url:'https://offsite.example.org/grid'}
    ]});
  });
  const following = await continued.service.execute('web.search',{query:'CSS grid site:docs.example.org',page:2},'visitor');
  assert.equal(following.nextPage,3);
  assert.deepEqual(following.results.map(x=>x.url),['https://docs.example.org/advanced/css-grid']);
  assert.equal(continued.requests.length,1);
  const many = fixture(() => response({results:Array.from({length:9},(_,n)=>({url:'https://docs.example.org/guide/grid-'+n,title:'Grid '+n}))}));
  const pagesOnOneHost = await many.service.execute('web.search',{query:'grid site:docs.example.org/guide',limit:9},'visitor');
  assert.equal(pagesOnOneHost.results.length,9);
};
