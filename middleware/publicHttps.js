'use strict';

const { isLoopback } = require('../services/securityIp');

const publicHosts = new Set(['panthorium.net', 'preview.panthorium.net']);

function publicHttpOrigin(req, trustProxy) {
  const host = (req.headers.host || '').toLowerCase().replace(/:(80|443)$/, '').replace(/\.$/, '');
  if (!publicHosts.has(host) || req.socket.encrypted) return null;
  // The notebook receives both HTTP and HTTPS over a loopback Cloudflare Tunnel.
  if (trustProxy && isLoopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https') return null;
  return 'https://' + host;
}

function redirectPublicHttp(trustProxy) {
  return (req, res, next) => {
    const origin = publicHttpOrigin(req, trustProxy);
    if (!origin) return next();
    const path = req.originalUrl.startsWith('/') ? req.originalUrl : '/';
    res.redirect(['GET', 'HEAD'].includes(req.method) ? 301 : 308, origin + path);
  };
}

module.exports = { publicHttpOrigin, redirectPublicHttp };
