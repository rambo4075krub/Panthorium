'use strict';
const https = require('node:https');
const dns = require('node:dns').promises;
const { isIP } = require('node:net');
const zlib = require('node:zlib');
const ipaddr = require('ipaddr.js');

const USER_AGENT = 'PanthoriumPublicWeb/1.0 (+https://github.com/rambo4075krub/Panthorium)';
const MAX_BYTES = 512 * 1024;
function publicAddress(address) {
  try {
    const ip = ipaddr.parse(address);
    // Reject mapped/translation/tunnel ranges as well as private and special-use IPs.
    return ip.range() === 'unicast' && (ip.kind() === 'ipv4' || ip.match(ipaddr.parse('2000::'), 3));
  } catch { return false; }
}
function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('web_invalid_url'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048 ||
      isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || host.endsWith('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) throw new Error('web_unsafe_url');
  // Public reading never accepts credentials, signed links or paid-provider keys.
  if ([...url.searchParams.keys()].some(key => /(?:key|token|secret|signature|password|credential|authorization)/i.test(key))) throw new Error('web_credentials_not_allowed');
  url.hash = '';
  return url;
}
class PublicWebHttp {
  constructor({ resolver = host => dns.lookup(host, { all: true, verbatim: true }), transport = https } = {}) {
    this.resolver = resolver; this.transport = transport;
  }
  async get(value, { signal, headers = {} } = {}) {
    const url = publicUrl(value);
    const deadline = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(8000)]);
    let records;
    // Also bound DNS: a hanging resolver must not occupy a tool slot forever.
    records = await new Promise((resolve, reject) => {
      const abort = () => reject(new Error('web_timeout'));
      if (deadline.aborted) return abort();
      deadline.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => this.resolver(url.hostname)).then(resolve, reject)
        .finally(() => deadline.removeEventListener('abort', abort));
    });
    if (!records?.length || records.some(record => !publicAddress(record.address))) throw new Error('web_unsafe_address');
    const selected = records[0];
    return new Promise((resolve, reject) => {
      const req = this.transport.request({
        protocol: 'https:', hostname: url.hostname, servername: url.hostname,
        path: url.pathname + url.search, method: 'GET', port: 443, agent: false, signal: deadline,
        // Pin the validated DNS result. No cookies, auth, user headers, proxy or ambient credentials.
        lookup: (_host, options, callback) => options?.all
          ? callback(null, [{ address: selected.address, family: isIP(selected.address) }])
          : callback(null, selected.address, isIP(selected.address)),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, text/plain, application/json', 'Accept-Encoding': 'gzip, deflate',
          ...(headers['If-Modified-Since'] ? { 'If-Modified-Since': headers['If-Modified-Since'] } : {}) }
      }, res => {
        let wireBytes = 0, bodyBytes = 0;
        const chunks = [];
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        if (encoding && !['gzip', 'deflate', 'identity'].includes(encoding)) {
          res.destroy(); reject(new Error('web_unsupported_encoding')); return;
        }
        const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : encoding === 'deflate' ? res.pipe(zlib.createInflate()) : res;
        const fail = error => { stream.destroy(); res.destroy(); req.destroy(); reject(error); };
        if (Number(res.headers['content-length']) > MAX_BYTES) { fail(new Error('web_response_too_large')); return; }
        res.on('data', chunk => { wireBytes += chunk.length; if (wireBytes > MAX_BYTES) fail(new Error('web_response_too_large')); });
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('web_response_aborted')));
        stream.on('error', reject);
        stream.on('data', chunk => {
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_BYTES) fail(new Error('web_response_too_large'));
          else chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), url: url.href }));
      });
      req.on('error', reject); req.end();
    });
  }
}
module.exports = { PublicWebHttp, publicUrl, publicAddress, USER_AGENT, MAX_BYTES };
