'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { AuthService } = require('../services/authService');
const { JsonAuthRepository } = require('../repositories/authRepository');
const { JsonEmailOtpRepository } = require('../services/emailOtpRepository');
const { EmailOtpService } = require('../services/emailOtpService');
const { McpOAuthRepository } = require('../services/mcpOAuthRepository');
const { McpOAuthService, DEFAULT_REDIRECT } = require('../services/mcpOAuthService');
const { createAuthRouter } = require('../routes/auth');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-auth-regression-'));
  let server;
  try {
    const config = { jwtSecret: crypto.randomBytes(32).toString('hex'), accessTokenTtl: '15m', refreshTokenDays: 30, isProduction: false };
    const repository = new JsonAuthRepository(path.join(dir, 'auth.json')); await repository.init();
    const auth = new AuthService({ repository, config, audit: { record() {} } });
    const user = await auth.createEmailAccount('fixture@example.invalid', 'before-password-123', 'guest:fixture');
    const session = await auth.issueSession(user);
    const oauthRepository = new McpOAuthRepository({ required: false, allowMemory: true }); await oauthRepository.init();
    const oauth = new McpOAuthService({ repository: oauthRepository, authService: auth, baseUrl: 'https://fixture.example' });
    const client = await oauth.registerClient({ redirect_uris: [DEFAULT_REDIRECT] });
    const verifier = 'a'.repeat(64);
    const request = await oauth.beginAuthorize({ client_id: client.client_id, redirect_uri: DEFAULT_REDIRECT, response_type: 'code', code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), scope: 'panthorium:read' });
    const approval = await oauth.approveAuthorization({ requestId: request.requestId, user: auth.verifyAccessToken(session.accessToken) });
    const tokens = await oauth.exchangeToken({ grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: DEFAULT_REDIRECT, code: new URL(approval.redirectUrl).searchParams.get('code'), code_verifier: verifier });
    let otpCode;
    const otpRepository = new JsonEmailOtpRepository(path.join(dir, 'otp.json')); await otpRepository.init();
    const otp = new EmailOtpService({ repository: otpRepository, authService: auth, config, sender: async (_email, code) => { otpCode = code; } });
    await otp.requestReset('fixture@example.invalid');
    await otp.resetPassword('fixture@example.invalid', otpCode, 'after-password-456');
    assert.equal(await auth.refresh(session.refreshToken), null);
    assert.equal(await auth.login('fixture@example.invalid', 'before-password-123'), null);
    await assert.rejects(() => auth.validateAccountPrincipal(auth.verifyAccessToken(session.accessToken)), /account_session_revoked/);
    await assert.rejects(() => oauth.authenticate(tokens.access_token), /invalid_token/);
    await assert.rejects(() => oauth.exchangeToken({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token }), /invalid_grant/);
    const fresh = await auth.login('fixture@example.invalid', 'after-password-456');
    assert.equal((await auth.validateAccountPrincipal(auth.verifyAccessToken(fresh.accessToken))).sub, user.id);
    assert.equal((await auth.accountPolicy(user.id)).credentialVersion, 1);

    // A refresh inserted by an old in-flight issuance after reset is still old.
    const late = await auth.issueRefreshToken({ id: user.id, accountVersion: 0 });
    await assert.rejects(() => auth.refresh(late), /account_session_revoked/);
    await auth.revokeAllSessions(user.id, user.id);
    await assert.rejects(() => auth.validateAccountPrincipal(auth.verifyAccessToken(fresh.accessToken)), /account_session_revoked/);
    const managed = await auth.resetManagedUserPassword(user.id, 'managed-password-789', user.id);
    assert.equal(managed.id, user.id);
    assert.equal((await auth.accountPolicy(user.id)).credentialVersion, 3);

    // Pause login after it has loaded an old hash, then reset concurrently.
    const find = repository.findUserById.bind(repository);
    let reached, release;
    const loaded = new Promise(resolve => { reached = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    let pause = true;
    repository.findUserById = async id => {
      const found = await find(id);
      if (pause && id === user.id) { pause = false; reached(); await resume; }
      return found;
    };
    // The first read is the policy lookup; pause the following password read.
    auth.accountPolicy = async id => { const u = await find(id); return { credentialVersion: u.credentialVersion, sessionsRevokedAt: u.sessionsRevokedAt }; };
    const racingLogin = auth.login('fixture@example.invalid', 'managed-password-789');
    const rejectedLogin = assert.rejects(() => racingLogin, /account_session_revoked/);
    await loaded;
    await auth.resetVoiceAccountPassword(user.id, 'raced-password-012');
    release(); await rejectedLogin;
    repository.findUserById = find;
    auth.accountPolicy = id => repository.sessionPolicy(id);
    const promoted = await auth.updateManagedUserAccess(user.id, { roles: ['administrator'], permissions: ['chat', 'settings'] }, user.id);
    assert.deepEqual(promoted.roles, ['administrator'], 'JSON account policy permits ordinary administrator promotion');

    const app = express(); app.use(express.json(), cookieParser()); app.use('/api/auth', createAuthRouter(auth, config));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (body = {}, cookie, route = 'guest') => fetch(`${base}/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const rawId = crypto.randomUUID();
    const first = await call({ guestSessionId: rawId }); const firstData = await first.json();
    assert.notEqual(firstData.user.id, `guest:${rawId}`);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    assert.match(first.headers.get('set-cookie'), /HttpOnly/); assert.match(first.headers.get('cache-control'), /no-store/);
    const resumed = await (await call({ guestSessionId: crypto.randomUUID() }, cookie)).json();
    assert.equal(resumed.user.id, firstData.user.id); assert.equal(resumed.guestExpiresAt, firstData.guestExpiresAt, 'renewal must not extend absolute guest lifetime');
    const rawReplay = await (await call({ guestSessionId: firstData.user.id.slice(6) })).json();
    assert.notEqual(rawReplay.user.id, firstData.user.id);
    const tampered = await (await call({}, cookie.slice(0, -6) + 'aaaaaa')).json();
    assert.notEqual(tampered.user.id, firstData.user.id);
    const wrongAudience = await (await call({}, `pt_guest=${firstData.accessToken}`)).json();
    assert.notEqual(wrongAudience.user.id, firstData.user.id);
    const expired = jwt.sign({ sub: firstData.user.id, exp: Math.floor(Date.now() / 1000) - 1 }, config.jwtSecret, { issuer: 'panthorium', audience: 'panthorium-guest-resume-v2' });
    assert.equal(auth.verifyGuestResume(expired), null);
    const legacy = jwt.sign({ sub: firstData.user.id, roles: ['guest'], permissions: ['chat'] }, config.jwtSecret, { issuer: 'panthorium', audience: 'panthorium-ui', expiresIn: '15m' });
    assert.throws(() => auth.verifyAccessToken(legacy), /guest_session_revoked/);
    assert.equal(auth.verifyAccessToken(firstData.accessToken).sub, firstData.user.id);
    const otherWorker = new AuthService({ repository, config, audit: { record() {} } });
    assert.equal(otherWorker.verifyGuestResume(decodeURIComponent(cookie.slice('pt_guest='.length))).id, firstData.user.id.slice(6));
    const logout = await call({}, cookie, 'logout'); assert.match(logout.headers.get('set-cookie'), /pt_guest=;/);
    console.log('PASS auth security: OTP/admin/all-session revocation, UI and MCP tokens, reset/login race, late refresh, signed guest proof, fixed lifetime, legacy token rejection');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
