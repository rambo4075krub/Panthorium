'use strict';
const { isIP } = require('node:net');
const ipaddr = require('ipaddr.js');

function canonicalIp(value) {
  if (typeof value !== 'string') return '';
  value = value.trim();
  if (!value || value.length > 64 || value.includes('%') || !isIP(value)) return '';
  return ipaddr.process(value).toString();
}
function isLoopback(value) {
  const ip = canonicalIp(value);
  return !!ip && ipaddr.parse(ip).range() === 'loopback';
}
// The notebook binds both backend and edge to loopback. Cloudflare Tunnel
// supplies CF-Connecting-IP; arbitrary X-Forwarded-For chains are never identity.
// Other deployments must establish an explicit proxy contract before enabling it.
function clientIp(req, trustProxy = false) {
  const peer = canonicalIp(req.socket?.remoteAddress);
  if (trustProxy && isLoopback(peer) && req.headers['cf-connecting-ip'] !== undefined) {
    const ip = canonicalIp(req.headers['cf-connecting-ip']);
    if (!ip || isLoopback(ip)) throw new Error('invalid_proxy_identity');
    return ip;
  }
  return peer;
}
function requestIdentity(trustProxy) {
  return (req, res, next) => {
    try {
      const ip = clientIp(req, trustProxy);
      Object.defineProperty(req, 'ip', { value: ip, configurable: true });
      Object.defineProperty(req, 'ips', { value: ip ? [ip] : [], configurable: true });
      next();
    } catch { res.status(400).json({ ok: false, error: 'invalid_proxy_identity' }); }
  };
}
module.exports = { canonicalIp, isLoopback, clientIp, requestIdentity };
