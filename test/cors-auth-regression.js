process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'cors-auth-regression-secret';

const assert = require('assert');
const express = require('express');
const { createAuthRouter } = require('../routes/auth');

(async () => {
  const app = express();
  app.use(express.json());
  const authService = { audit: { record() {} }, async login() { return null; } };
  const failingSecurity = {
    async getActiveBlock() { throw new Error('security store unavailable'); },
    async evaluateLoginFailure() { throw new Error('security audit unavailable'); }
  };
  app.use('/api/auth', createAuthRouter(authService, { isProduction: false, refreshTokenDays: 30 }, failingSecurity));
  const crowdAuth = {
    async login(username, password) {
      return password === 'fixture-pass' ? { principal: { sub: username }, accessToken: 'fixture', refreshToken: 'fixture' } : null;
    }
  };
  const config = { isProduction: false, refreshTokenDays: 30 };
  const reset = { async resetPassword() {} };
  app.use('/crowd', createAuthRouter(crowdAuth, config, null, null, null, reset));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    });
    const data = await response.json();
    assert.equal(response.status, 401, 'security telemetry failure must preserve invalid-credentials status');
    assert.equal(data.error, 'invalid_credentials');
    const post = async (path, body) => {
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/crowd/' + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      await res.text();
      return res.status;
    };
    for (let group = 0; group < 8; group++) {
      const statuses = await Promise.all(Array.from({ length: 5 }, (_, i) =>
        post('login', { username: `member-${group}-${i}`, password: 'fixture-pass' })));
      assert.deepEqual(statuses, Array(5).fill(200), 'valid sign-ins from one address can continue');
    }
    assert.equal(await post('password/reset', { password: 'fixture-pass', confirmPassword: 'fixture-pass' }), 200);
    for (let i = 0; i < 19; i++) assert.equal(await post('login', { username: 'member', password: 'incorrect' }), 401);
    assert.equal(await post('login', { username: 'member', password: 'fixture-pass' }), 429,
      'the shared budget still counts recovery requests and failed authentication');
    console.log('CORS/auth regression test passed');
  } finally { server.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
