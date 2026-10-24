'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { gzipSync } = require('node:zlib');
const { PublicWebHttp, publicUrl, publicAddress, MAX_BYTES } = require('../services/publicWebHttp');
const { PublicWebService, extractHtml } = require('../services/publicWebService');
const { ToolRegistry } = require('../services/toolRegistry');
const { registerPublicWebTools } = require('../services/publicWebTools');
const now = Date.parse('2026-10-24T05:00:00Z');
const response = (data, status = 200, type = 'application/json', headers = {}) => ({ status, headers:{ 'content-type':type, ...headers }, text: typeof data === 'string' ? data : JSON.stringify(data) });
function fixture(handler, clock = () => now) {
  const requests = [];
  const service = new PublicWebService({ now:clock, http:{ async get(url, options) { requests.push({url,options}); return handler(new URL(url), options); } } });
  return { service, requests };
}
const wiki = {query:{pages:[{pageid:1,index:1,title:'Bangkok',fullurl:'https://en.wikipedia.org/wiki/Bangkok',extract:'Capital of Thailand',coordinates:[{lat:13.756331,lon:100.501765,globe:'earth'}]}]}};
async function main() {
  for (const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','172.16.0.1','192.168.1.1','0.0.0.0','224.0.0.1','::1','fc00::1','fe80::1','::ffff:7f00:1','64:ff9b::a00:1','2002:7f00:1::','2001:db8::1']) assert.equal(publicAddress(ip),false,ip);
  assert(publicAddress('8.8.8.8')); assert(publicAddress('2606:4700:4700::1111'));
  for (const url of ['http://example.org','file:///etc/passwd','https://127.0.0.1','https://[::1]','https://2130706433','https://0x7f000001','https://u:p@example.org','https://example.org:444','https://thing.internal','https://example.org/?api_key=secret','https://example.org/?X-Amz-Signature=x']) assert.throws(() => publicUrl(url),undefined,url);
  let connections=0;
  const blocked=new PublicWebHttp({resolver:async()=>[{address:'8.8.8.8'},{address:'127.0.0.1'}],transport:{request(){connections++;}}});
  await assert.rejects(blocked.get('https://example.org'),/web_unsafe_address/); assert.equal(connections,0);
  const controller = new AbortController();
  const hanging=new PublicWebHttp({resolver:()=>new Promise(()=>{}),transport:{request(){connections++;}}});
  const wait=hanging.get('https://example.org',{signal:controller.signal}); controller.abort();
  await assert.rejects(wait,/web_timeout/); assert.equal(connections,0);
  let options;
  function transport(body, headers={}) { return {request(input, callback) {
    options=input;
    const req=new EventEmitter(); req.destroy=()=>{};
    req.end=()=>queueMicrotask(()=>{const res=Readable.from([body]);res.statusCode=200;res.headers=headers;callback(res);});return req;
  }}; }
  const pinned=new PublicWebHttp({resolver:async()=>[{address:'8.8.8.8'}],transport:transport(gzipSync('public content'),{'content-encoding':'gzip'})});
  assert.equal((await pinned.get('https://example.org')).text,'public content');
  assert.equal(options.hostname,'example.org'); assert.equal(options.servername,'example.org');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
  options.lookup('example.org',{},(_error,address,family)=>{assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  options.lookup('example.org',{all:true},(_error,records)=>assert.deepEqual(records,[{address:'8.8.8.8',family:4}]));
  const bomb=new PublicWebHttp({resolver:async()=>[{address:'8.8.8.8'}],transport:transport(gzipSync('x'.repeat(MAX_BYTES+1)),{'content-encoding':'gzip'})});
  await assert.rejects(bomb.get('https://example.org'),/web_response_too_large/);
  const html=extractHtml('<title>A &amp; B</title><nav>menu</nav><p>Hello</p><script>steal()</script><div hidden>secret</div><p>world</p>');
  assert.equal(html.title,'A & B');assert.equal(html.content,'Hello\nworld');assert(!html.content.includes('secret'));
  assert(extractHtml('<script type="application/ld+json">{"isAccessibleForFree":false}</script><p>premium</p>').restricted);
  assert(extractHtml('<p>Subscribe to continue reading</p>').restricted);
  const free=fixture(url=> url.pathname==='/robots.txt' ? response('User-agent: *\nAllow: /',200,'text/plain') : response('<title>Public page</title><p>Useful facts</p><script>bad()</script>',200,'text/html'));
  const read=await free.service.execute('web.read',{url:'https://example.org/article'},'u1');
  assert.equal(read.available,true);assert.equal(read.content,'Useful facts');assert.equal(read.sources[0].url,'https://example.org/article');assert.equal(read.untrusted,true);assert.equal(read.freeOnly,true);
  await free.service.execute('web.read',{url:'https://example.org/article'},'u1');assert.equal(free.requests.length,2,'cache avoids both network calls');
  for (const [status,code] of [[402,'web_payment_required'],[401,'web_access_restricted'],[403,'web_access_restricted'],[429,'web_rate_limited']]) {
    const f=fixture(url=>url.pathname==='/robots.txt'?response('',404,'text/plain'):response('',status));
    const result=await f.service.execute('web.read',{url:'https://example.org/article'},'u1');assert.equal(result.available,false);assert.equal(result.error,code);assert.equal(f.requests.length,2);
  }
  const robots=fixture(()=>response('User-agent: *\nDisallow: /private',200,'text/plain'));
  assert.equal((await robots.service.execute('web.read',{url:'https://example.org/private'},'u1')).error,'web_robots_denied');assert.equal(robots.requests.length,1);
  const unknownRobots=fixture(()=>response('<html>challenge</html>',200,'text/html'));
  assert.equal((await unknownRobots.service.execute('web.read',{url:'https://example.org'},'u1')).error,'web_robots_unavailable');
  const redirect=fixture(url=>url.pathname==='/robots.txt'?response('',404,'text/plain'):response('',302,'text/plain',{location:'https://127.0.0.1/metadata'}));
  assert.equal((await redirect.service.execute('web.read',{url:'https://example.org'},'u1')).error,'web_unsafe_url');assert.equal(redirect.requests.length,2);
  const paying=fixture(url=>url.pathname==='/robots.txt'?response('',404,'text/plain'):response('<p>สมัครสมาชิกเพื่ออ่านบทความนี้</p>',200,'text/html'));
  const paid=await paying.service.execute('web.read',{url:'https://example.org'},'u1');assert.equal(paid.available,false);assert.equal(paid.content,undefined);
  const search=fixture(url=>url.hostname==='api.duckduckgo.com'?response({AbstractText:'Bangkok facts',AbstractURL:'https://en.wikipedia.org/wiki/Bangkok',Heading:'Bangkok'}):response(wiki));
  const found=await search.service.execute('web.search',{query:'Bangkok'},'u1');assert.equal(found.available,true);assert.equal(found.coverage,'limited_free_sources');assert(found.sources.length);assert(search.requests.every(item=>!item.url.includes('key=')));
  const empty=fixture(url=>response(url.hostname==='api.duckduckgo.com'?{}:{query:{pages:[]}}));
  assert.equal((await empty.service.execute('web.search',{query:'no match'},'u1')).error,'web_no_results');
  const weather=fixture(url=>url.hostname.endsWith('wikipedia.org')?response(wiki):response({properties:{meta:{updated_at:'2026-10-24T04:00:00Z',units:{air_temperature:'celsius'}},timeseries:[{time:'2026-10-24T06:00:00Z',data:{instant:{details:{air_temperature:30,wind_speed:2}},next_1_hours:{details:{precipitation_amount:1},summary:{symbol_code:'rain'}}}}]}}));
  const forecast=await weather.service.execute('weather.get',{location:'Bangkok'},'u1');assert.equal(forecast.available,true);assert.equal(forecast.kind,'forecast_not_observation');assert.equal(forecast.periods[0].temperatureC,30);assert(forecast.sources[0].license);assert(weather.requests[1].url.includes('lat=13.7563&lon=100.5018'));
  const ambiguous=fixture(()=>response({query:{pages:[...wiki.query.pages,{...wiki.query.pages[0],title:'Bangkok district'}]}}));
  assert.equal((await ambiguous.service.execute('weather.get',{location:'Bang'},'u1')).error,'weather_location_ambiguous');assert.equal(ambiguous.requests.length,1);
  assert.equal((await weather.service.execute('weather.get',{location:'Bangkok',date:'2099-01-01'},'u1')).error,'weather_date_unavailable');
  const disabled=new PublicWebService({enabled:false,http:{get(){throw Error('must not call');}}});assert.equal((await disabled.execute('web.search',{query:'x'},'u1')).available,false);
  const quota=fixture(()=>response({},429,'application/json',{'retry-after':'120'}));
  await quota.service.execute('web.search',{query:'a'},'u1');await quota.service.execute('web.search',{query:'b'},'u1');assert.equal(quota.requests.length,2,'backoff for both free hosts, no paid fallback');
  for(let i=0;i<12;i++)await empty.service.execute('web.search',{query:'no match'},'u1');
  assert.equal((await empty.service.execute('web.search',{query:'no match'},'u1')).error,'web_rate_limited');
  const registry=new ToolRegistry();registerPublicWebTools(registry,{service:free.service});
  assert(registry.get('web.search').validateArgs({query:'x',paid:true}));assert(registry.get('web.read').validateArgs({url:'https://example.org',headers:{authorization:'x'}}));
  assert(registry.get('weather.get').validateArgs({location:'Bangkok',date:'2026-02-31'}));assert(registry.get('weather.get').validateArgs({location:'Bangkok',timeZone:'not/a/zone'}));
  assert.equal(registry.get('web.search').requiresConfirmation,false);
  console.log('Public web: free-only failures, SSRF/DNS pinning, compressed limits, robots/paywalls, citations, caching, quotas and weather passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
