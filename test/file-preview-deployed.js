'use strict';
// Staging-only acceptance. Creates and removes two disposable accounts and
// their fixtures through public APIs. Never logs credentials, tokens or bodies.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { _internals } = require('../services/officeArtifactService');
(async () => {
  const origin = new URL(process.env.FILES_SMOKE_URL).origin;
  assert.ok(['https://panthorium-backend-staging-4ixtzhfyva-as.a.run.app', 'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app'].includes(origin), 'staging-only target');
  assert.ok(process.env.FILES_SMOKE_ADMIN_PASSWORD, 'staging test credential required');
  const sessions = [], users = [], fixtures = [];
  const call = (route, token, init = {}) => fetch(origin + route, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...(token ? {Authorization:'Bearer ' + token} : {}), ...init.headers } });
  async function json(route, token, body, expected = 200, method = 'POST') {
    const r = await call(route, token, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    assert.equal(r.status, expected, method + ' ' + route);
    const data = await r.json();
    const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    if (cookie) sessions.push(cookie);
    return data;
  }
  const admin = await json('/api/auth/login', null, { username:process.env.FILES_SMOKE_ADMIN_USERNAME || 'admin', password:process.env.FILES_SMOKE_ADMIN_PASSWORD });
  try {
    for (let i = 0; i < 2; i++) {
      const credentials = {username:'preview-' + crypto.randomBytes(8).toString('hex'), password:crypto.randomBytes(24).toString('base64url')};
      const result = await json('/api/auth/users', admin.accessToken, {...credentials, roles:[],permissions:['chat']}, 201);
      const user = {id:result.user.id}; users.push(user);
      user.token = (await json('/api/auth/login', null, credentials)).accessToken;
    }
    const guest = await json('/api/auth/guest', null, {});
    const owner = users[0].token;
    const cases = [
      ['preview.print.html', 'text/html', Buffer.from('<h1>Preview fixture</h1><table><tr><td>100</td></tr></table>')],
      ['preview.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', _internals.spreadsheetBuffer({title:'Preview',sheets:[{name:'Data',rows:[['Value'],[100]]}]})],
      ['preview.png', 'image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2e8AAAAASUVORK5CYII=', 'base64')]
    ];
    for (const [name, type, body] of cases) {
      const upload = await call('/api/files', owner, {method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),'X-File-Content-Type':type},body});
      assert.equal(upload.status,201,'fixture upload');
      const {file} = await upload.json(); fixtures.push(file.id);
      const preview = await call('/api/files/' + file.id + '/preview', owner);
      assert.equal(preview.status,200,'owned preview');
      assert.equal(preview.headers.get('cache-control'),'private, no-store');
      const bytes = Buffer.from(await preview.arrayBuffer());
      if (name.endsWith('.xlsx')) { assert.equal(preview.headers.get('x-panthorium-preview'),'office-text'); assert.match(bytes.toString(),/100/); }
      else assert.ok(bytes.equals(body), 'stored fixture is readable');
      assert.equal((await call('/api/files/' + file.id + '/preview', users[1].token)).status,404,'other account denied');
      assert.equal((await call('/api/files/' + file.id + '/preview', guest.accessToken)).status,403,'guest denied');
      const download = await call('/api/files/' + file.id, owner);
      assert.equal(download.status,402,'Free export quota remains enforced');
      assert.equal((await download.json()).error,'quota_exceeded:downloadBytes');
    }
    console.log('PASS staging real-bucket preview: Free account HTML/XLSX/image round trips, account isolation, Guest denial and export quota');
  } finally {
    let failed = false;
    for (const id of fixtures) { const r = await call('/api/files/' + id, users[0].token, {method:'DELETE'}); if (!r.ok) failed = true; }
    for (const user of users) { const r = await call('/api/auth/users/' + user.id, admin.accessToken, {method:'DELETE'}); if (!r.ok) failed = true; }
    for (const cookie of sessions) { const r = await call('/api/auth/logout', null, {method:'POST',headers:{Cookie:cookie}}); if (!r.ok) failed = true; }
    assert.equal(failed,false,'staging fixture/session cleanup');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
