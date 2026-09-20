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
    console.log('CORS/auth regression test passed');
  } finally { server.close(); }
})().catch((error) => { console.error(error); process.exit(1); });