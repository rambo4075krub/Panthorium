'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { AuthService } = require('../services/authService');
const { JsonAuthRepository } = require('../repositories/authRepository');
const { AuditService } = require('../services/auditService');
const { SecurityResponseService } = require('../services/securityResponseService');
const { canonicalIp, clientIp, requestIdentity } = require('../services/securityIp');
const { requireAuth } = require('../middleware/auth');
const { securityBlock } = require('../middleware/securityBlock');

async function sessionSuite(repository, auth) {
  const user = await repository.createUser({id:randomUUID(),username:'boundary-'+randomUUID(),passwordHash:'unused',roles:[],permissions:['chat'],createdAt:new Date().toISOString()});
  const first = await auth.issueSession(user);
  const second = await auth.issueSession(user);
  const token = auth.verifyAccessToken(first.accessToken);
  await auth.validateAccessSession(token);
  const rotated = await auth.refresh(first.refreshToken);
  assert.equal(auth.verifyAccessToken(rotated.accessToken).sid, token.sid, 'rotation preserves session identity');
  assert.equal(await auth.refresh(first.refreshToken), null, 'old refresh is single use');
  await auth.validateAccessSession(token);
  assert(await repository.revokeSession(token.sid));
  await assert.rejects(auth.validateAccessSession(token), /account_session_revoked/);
  await assert.rejects(auth.validateAccessSession(auth.verifyAccessToken(rotated.accessToken)), /account_session_revoked/);
  assert.equal(await auth.refresh(rotated.refreshToken), null);
  await auth.validateAccessSession(auth.verifyAccessToken(second.accessToken));
  await auth.revoke(second.refreshToken);
  await assert.rejects(auth.validateAccessSession(auth.verifyAccessToken(second.accessToken)), /account_session_revoked/);
  const race = await auth.issueSession(user);
  const consume = repository.consumeRefreshToken.bind(repository);
  repository.consumeRefreshToken = async hash => {
    const stored = await consume(hash);
    if (stored) await repository.revokeSession(stored.id);
    return stored;
  };
  await assert.rejects(auth.refresh(race.refreshToken), /account_session_revoked/, 'refresh cannot resurrect a revoked session');
  repository.consumeRefreshToken = consume;
  const concurrent = await auth.issueSession(user);
  const rotations = await Promise.all([auth.refresh(concurrent.refreshToken),auth.refresh(concurrent.refreshToken)]);
  assert.equal(rotations.filter(Boolean).length, 1);
  await assert.rejects(auth.validateAccessSession(auth.verifyAccessToken(auth.signAccessToken(user))), /account_session_revoked/, 'legacy access requires re-login');
}

async function aggregationSuite(audit) {
  for (let i=0;i<10;i++) await audit.record('auth.login_failed',{ip:i%2?'2001:0db8:0:0:0:0:0:20':'2001:db8::20'});
  for (let i=0;i<600;i++) await audit.record('http.request',{ip:'192.0.2.60',status:200});
  const alerts = await audit.securityAlerts();
  assert(alerts.alerts.some(a=>a.code==='LOGIN_BRUTE_FORCE' && a.ip==='2001:db8::20' && a.count===10));
  assert((await audit.summary()).total24h>=610);
  assert.equal(await audit.countLoginFailures('2001:db8::20'),10);
}

async function main() {
  assert.equal(canonicalIp('::ffff:c000:201'),'192.0.2.1');
  assert.equal(canonicalIp('2001:0DB8:0000:0000:0000:0000:0000:0020'),'2001:db8::20');
  for(const ip of ['127.1','123','fe80::1%eth0','1.2.3.4/32','1.2.3.4, 5.6.7.8']) assert.equal(canonicalIp(ip),'');
  const request=(peer,headers)=>({socket:{remoteAddress:peer},headers});
  assert.equal(clientIp(request('198.51.100.2',{'cf-connecting-ip':'192.0.2.9','x-forwarded-for':'127.0.0.1'}),true),'198.51.100.2');
  assert.equal(clientIp(request('127.0.0.1',{'cf-connecting-ip':'192.0.2.9','x-forwarded-for':'127.0.0.1'}),true),'192.0.2.9');
  assert.equal(clientIp(request('127.0.0.1',{'x-forwarded-for':'192.0.2.9'}),true),'127.0.0.1');
  assert.throws(()=>clientIp(request('127.0.0.1',{'cf-connecting-ip':'127.0.0.1'}),true),/invalid_proxy/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'security-boundaries-'));
  let server;
  try {
    const repository=new JsonAuthRepository(path.join(dir,'auth.json'));await repository.init();
    const audit=new AuditService(path.join(dir,'audit.jsonl'));
    const auth=new AuthService({repository,audit,config:{jwtSecret:'isolated-boundary-test-only',accessTokenTtl:'15m',refreshTokenDays:1}});
    await sessionSuite(repository,auth);await aggregationSuite(audit);
    const security=new SecurityResponseService({audit});await security.init();
    await assert.rejects(security.blockIp('::ffff:127.0.0.1'),/recovery_ip_protected/);
    await assert.rejects(security.blockIp('2001:db8::20',{requestIp:'2001:0db8:0:0:0:0:0:20'}),/cannot_block_own_ip/);
    await security.blockIp('192.0.2.9');
    const user=await repository.createUser({id:randomUUID(),username:'http',passwordHash:'unused'});
    const session=await auth.issueSession(user);
    const app=express();app.use(requestIdentity(true),securityBlock(security));
    app.get('/api/me',requireAuth(auth),(req,res)=>res.json({ok:true}));
    app.post('/api/auth/guest',(req,res)=>res.json({ok:true}));
    app.get('/api/health',(req,res)=>res.json({ok:true}));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base='http://127.0.0.1:'+server.address().port;
    const headers={authorization:'Bearer '+session.accessToken,'cf-connecting-ip':'192.0.2.9','x-forwarded-for':'198.51.100.8','forwarded':'for=198.51.100.8','x-real-ip':'198.51.100.8'};
    assert.equal((await fetch(base+'/api/me',{headers})).status,429);
    assert.equal((await fetch(base+'/api/auth/guest',{method:'POST',headers})).status,429);
    assert.equal((await fetch(base+'/api/health',{headers})).status,200);
    assert.equal((await fetch(base+'/api/me',{headers:{authorization:headers.authorization}})).status,200,'authenticated local recovery remains available');
    await repository.revokeSession(auth.verifyAccessToken(session.accessToken).sid);
    assert.equal((await fetch(base+'/api/me',{headers:{authorization:headers.authorization}})).status,401);
    security.getActiveBlock=async()=>{throw Error('database unavailable');};
    assert.equal((await fetch(base+'/api/me')).status,503,'block lookup fails closed');
    console.log('PASS security boundaries: stable sessions, revoke/refresh races, legacy login, full-window alerts, canonical IPs, proxy spoofing, guest block and local recovery');
  } finally { if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true}); }
}
module.exports={sessionSuite,aggregationSuite};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
