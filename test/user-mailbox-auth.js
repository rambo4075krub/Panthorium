'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const { newDb } = require('pg-mem');
const { AuthService } = require('../services/authService');
const { JsonAuthRepository } = require('../repositories/authRepository');
const { AccountAdminService } = require('../services/accountAdminService');
const { UserMailboxService } = require('../services/mailbox/service');
const { createUserMailboxRouter } = require('../routes/userMailbox');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-mailbox-auth-'));
  try {
    for (const productionPolicy of [false, true]) {
      const { Pool } = newDb().adapters.createPg();
      const pool = new Pool();
      const repository = new JsonAuthRepository(path.join(dir, productionPolicy + '.json'));
      await repository.init();
      const user = await repository.createUser({ id: randomUUID(), username: 'registered-user',
        email: 'registered@example.com', emailVerifiedAt: new Date().toISOString(),
        passwordHash: await bcrypt.hash('Mailbox-test-password', 4), roles: [], permissions: ['chat'] });
      const auth = new AuthService({ repository, config: { jwtSecret: randomBytes(32).toString('hex'),
        accessTokenTtl: '15m', refreshTokenDays: 1 }, audit: { record() {} } });
      if (productionPolicy) {
        const accounts = new AccountAdminService(auth, pool);
        auth.validateAccountPrincipal = principal => accounts.validate(principal);
        auth.accountPolicy = id => accounts.policy(id);
      }
      const session = await auth.login(user.username, 'Mailbox-test-password');
      assert(session);
      assert.equal(auth.verifyAccessToken(session.accessToken).email, undefined, 'real access tokens omit email');
      const service = new UserMailboxService({ pool, env: {
        USER_MAILBOX_ENABLED: '1', USER_MAILBOX_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        USER_MAILBOX_GOOGLE_CLIENT_ID: 'fixture-client', USER_MAILBOX_GOOGLE_CLIENT_SECRET: 'fixture-secret',
        USER_MAILBOX_PUBLIC_ORIGIN: 'https://panthorium.example'
      }, fetchImpl: async () => { throw Error('No provider traffic before consent'); } });
      const app = express(); app.use(express.json()); app.use('/api/mailbox', createUserMailboxRouter(auth, service));
      const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
      const base = 'http://127.0.0.1:' + server.address().port + '/api/mailbox/';
      const call = (route, token = session.accessToken, body) => fetch(base + route, {
        method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const changeUser = fields => repository.store.update(data => {
        Object.assign(data.users.find(row => row.id === user.id), fields); return data;
      });
      try {
        const status = await call('status'); assert.equal(status.status, 200);
        assert.equal((await status.json()).email, user.email, 'HTTP authentication hydrates the saved email');
        const connected = await call('connect', session.accessToken, { provider: 'google', email: 'spoof@example.com' });
        assert.equal(connected.status, 200);
        const url = new URL((await connected.json()).url);
        assert.equal(url.searchParams.get('login_hint'), user.email, 'request body cannot choose another account');
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert(!url.href.includes('fixture-secret'));
        const pending = await service.store.get({ sub: user.id }, 'oauth', url.searchParams.get('state'));
        assert.equal(pending.email, user.email);

        changeUser({ email: 'changed@example.com', emailVerifiedAt: null });
        const principal = await auth.validateAccountPrincipal({ ...auth.verifyAccessToken(session.accessToken),
          email: user.email, emailVerifiedAt: user.emailVerifiedAt });
        assert.equal(principal.email, 'changed@example.com');
        assert.equal(principal.emailVerifiedAt, null, 'stored verification overrides stale claims');
        const refused = await call('connect', session.accessToken, { provider: 'google', emailVerifiedAt: user.emailVerifiedAt });
        assert.equal(refused.status, 403); assert.equal((await refused.json()).error, 'mailbox_verified_email_required');
        changeUser({ email: null });
        assert.equal((await auth.validateAccountPrincipal(principal)).email, null);
        assert.equal((await call('status', '')).status, 401);
        assert.equal((await call('connect', auth.guest().accessToken, { provider: 'google' })).status, 403);

        if (productionPolicy) {
          await pool.query('INSERT INTO panthorium_account_policies(user_id,data) VALUES($1,$2)',
            [user.id, JSON.stringify({ credentialVersion: 1 })]);
        } else changeUser({ credentialVersion: 1 });
        const revoked = await call('connect', session.accessToken, { provider: 'google' });
        assert.equal(revoked.status, 401); assert.equal((await revoked.json()).error, 'account_session_revoked');
      } finally { await new Promise(resolve => server.close(resolve)); await pool.end(); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('Mailbox HTTP auth: real JWT, both account validators, current verified email, spoof refusal, guest and revoked-session denial passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
