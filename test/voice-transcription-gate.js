const assert = require('node:assert/strict');
const express = require('express');
const { AuthService } = require('../services/authService');
const { createApiRouter } = require('../routes/api');

(async () => {
  let transcripts = 0, profiles = [], matched = false;
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'voice-gate-test-key', accessTokenTtl: '1h' }, audit });
  const user = { id: 'owner', username: 'owner', roles: ['administrator'], permissions: ['chat'] };
  const biometrics = { gateEnabled: true, list: async () => profiles, verify: async () => ({ matched }) };
  const sentinel = { providers: { transcribeAudio: async () => { transcripts += 1; return { text: 'hello' }; } } };
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createApiRouter(sentinel, auth, audit, {}, {}, {}, {}, {}, {}, biometrics));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/speech/transcribe`;
    const request = () => fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.signAccessToken(user)}` },
      body: JSON.stringify({ audio: `data:audio/webm;base64,${Buffer.alloc(4000).toString('base64')}` })
    });
    assert.equal((await request()).status, 403, 'unenrolled audio must not reach STT');
    profiles = [{ profileId: 'p1' }];
    assert.equal((await request()).status, 403, 'unknown speaker must not reach STT');
    assert.equal(transcripts, 0);
    matched = true;
    assert.equal((await request()).status, 200, 'enrolled speaker may use STT');
    assert.equal(transcripts, 1);
    biometrics.gateEnabled = false;
    profiles = [];
    assert.equal((await request()).status, 200, 'staging enrollment mode must preserve existing voice');
    assert.equal(transcripts, 2);
    console.log('voice transcription gate tests passed');
  } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
