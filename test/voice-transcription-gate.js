const assert = require('node:assert/strict');
const express = require('express');
const { AuthService } = require('../services/authService');
const { createApiRouter } = require('../routes/api');

(async () => {
  let transcripts = 0, profiles = [], matched = false, transcribedText = 'hello', voiceScore = 0.74;
  process.env.BIOMETRIC_DIAGNOSTICS_ENABLED = '1';
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'voice-gate-test-key', accessTokenTtl: '1h' }, audit });
  const user = { id: 'owner', username: 'owner', roles: ['administrator'], permissions: ['chat'] };
  const biometrics = { gateEnabled: true, status: () => ({ configured: true, matchThreshold: 0.8 }), list: async () => profiles, verify: async () => ({ matched, score: voiceScore }) };
  const sentinel = { providers: { transcribeAudio: async () => { transcripts += 1; return { text: transcribedText }; } } };
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createApiRouter(sentinel, auth, audit, {}, {}, {}, {}, {}, {}, biometrics));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/speech/transcribe`;
    const navigationEndpoint = `http://127.0.0.1:${server.address().port}/api/speech/identity-navigation`;
    const payload = { audio: `data:audio/webm;base64,${Buffer.alloc(4000).toString('base64')}`, language: 'th-TH' };
    const request = url => fetch(url || endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.signAccessToken(user)}` },
      body: JSON.stringify(payload)
    });
    assert.equal((await request()).status, 403, 'unenrolled audio cannot use general STT');
    assert.equal(transcripts, 0, 'general STT is not called for an unenrolled owner');
    transcribedText = 'ลงทะเบียน';
    let navigation = await request(navigationEndpoint);
    assert.equal(navigation.status, 200, 'unenrolled owner can use the restricted identity phrase route');
    assert.equal((await navigation.json()).intent, 'register');
    transcribedText = 'เข้าสู่ระบบ';
    navigation = await request(navigationEndpoint);
    assert.equal((await navigation.json()).intent, 'login');
    transcribedText = 'ลบไฟล์ทั้งหมด';
    navigation = await request(navigationEndpoint);
    assert.equal(navigation.status, 403, 'restricted navigation rejects unrelated speech');
    assert.equal((await navigation.json()).error, 'voice_navigation_not_recognized');
    profiles = [{ profileId: 'p1' }];
    assert.equal((await request(navigationEndpoint)).status, 403, 'identity navigation closes after enrollment');
    assert.equal(transcripts, 3, 'a caller with an enrolled profile cannot use the identity-only STT path');
    process.env.BIOMETRIC_DIAGNOSTICS_ENABLED = '0';
    const hiddenDiagnostic = await request();
    assert.equal(hiddenDiagnostic.status, 403, 'unknown speaker must not reach general STT');
    assert.equal((await hiddenDiagnostic.json()).voiceDiagnostic, undefined, 'production mode omits similarity diagnostics');
    process.env.BIOMETRIC_DIAGNOSTICS_ENABLED = '1';
    const denied = await request();
    assert.equal(denied.status, 403, 'unknown speaker must not reach general STT');
    assert.deepEqual((await denied.json()).voiceDiagnostic, { score: 0.74, threshold: 0.8 }, 'staging reports match score and threshold without audio');
    assert.equal(transcripts, 3);
    matched = true;
    assert.equal((await request()).status, 200, 'enrolled speaker may use STT');
    assert.equal(transcripts, 4);
    biometrics.gateEnabled = false;
    profiles = [];
    assert.equal((await request()).status, 200, 'gate-off compatibility remains covered in the unit test');
    assert.equal(transcripts, 5);
    console.log('voice transcription gate tests passed');
  } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
