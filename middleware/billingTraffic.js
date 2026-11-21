'use strict';

const rateLimit = require('express-rate-limit');

function billingTraffic() {
  const options = { windowMs: 60000, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: 'billing_rate_limited' } };
  const keyGenerator = req => req.user.sub || req.user.id;
  return {
    // One upstream address can represent an entire venue or mobile carrier.
    ip: rateLimit({ ...options, max: 3600 }),
    write: rateLimit({ ...options, max: 10, keyGenerator }),
    read: rateLimit({ ...options, max: 60, keyGenerator })
  };
}

module.exports = { billingTraffic };
