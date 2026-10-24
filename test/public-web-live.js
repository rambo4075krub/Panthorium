'use strict';
// Opt-in network smoke: no AI requests, API keys, billing or paid providers.
const assert = require('node:assert/strict');
const { PublicWebService } = require('../services/publicWebService');
async function main() {
  if (process.env.PANTHORIUM_TEST_PUBLIC_WEB_LIVE !== '1') {
    console.log('Public-source live smoke skipped; set PANTHORIUM_TEST_PUBLIC_WEB_LIVE=1 to call free public sources.'); return;
  }
  const service = new PublicWebService();
  const search = await service.execute('web.search', { query: 'Bangkok', language: 'en' }, 'live-smoke');
  console.log(JSON.stringify({ operation:'search', available:search.available, error:search.error, sources:search.sources?.map(source=>source.url), issues:search.issues?.map(issue=>issue.error) }));
  assert.equal(search.available, true, 'At least one free search source should be available');
  const read = await service.execute('web.read', { url: 'https://www.example.com/' }, 'live-smoke');
  console.log(JSON.stringify({ operation:'read', available:read.available, error:read.error, sources:read.sources?.map(source=>source.url) }));
  assert.equal(read.available, true, 'Public HTTPS page should be readable');
  assert.match(read.content, /Example Domain/i);
  const weather = await service.execute('weather.get', { location: 'กรุงเทพมหานคร', language: 'th' }, 'live-smoke');
  console.log(JSON.stringify({ operation:'weather', available:weather.available, error:weather.error, location:weather.location, updatedAt:weather.updatedAt, periods:weather.periods?.length, sources:weather.sources?.map(source=>source.url) }));
  assert.equal(weather.available, true, 'Free Bangkok forecast should be available');
  assert.equal(weather.kind, 'forecast_not_observation');
  assert(weather.periods.length > 0);
  console.log('Live free search, HTML read and MET Norway forecast passed with the production pinned HTTPS transport');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
