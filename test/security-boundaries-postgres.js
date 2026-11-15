'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { PostgresAuthRepository } = require('../repositories/authRepository');
const { AuthService } = require('../services/authService');
const { AuditService } = require('../services/auditService');
const { SecurityResponseService } = require('../services/securityResponseService');
const { closeDatabasePools } = require('../services/databasePool');
const { sessionSuite, aggregationSuite } = require('./security-boundaries');
(async()=>{
  if(!process.env.TEST_DATABASE_URL){if(process.env.CI)throw Error('TEST_DATABASE_URL required');console.log('SKIP security boundaries PostgreSQL');return;}
  const root=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});
  const schema='security_boundaries_'+randomBytes(10).toString('hex');
  try{
    await root.query(`CREATE SCHEMA "${schema}"`);
    const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema},public -c statement_timeout=15000`);
    const repository=new PostgresAuthRepository(url.href,'disable');await repository.init();
    const audit=new AuditService({databaseUrl:url.href,databaseSslMode:'disable'});await audit.init();
    const auth=new AuthService({repository,audit,config:{jwtSecret:'postgres-boundary-test-only',accessTokenTtl:'15m',refreshTokenDays:1}});
    await sessionSuite(repository,auth);await aggregationSuite(audit);
    const security=new SecurityResponseService({audit,databaseUrl:url.href,databaseSslMode:'disable'});await security.init();
    const pool=repository.pool;
    await pool.query("DELETE FROM panthorium_security_migrations WHERE name LIKE 'canonical-ip-v1-%'");
    await pool.query(`INSERT INTO panthorium_security_ip_blocks(ip,reason,source,expires_at) VALUES
      ('2001:db8::77','manual fixture','manual',NOW()+INTERVAL '30 minutes'),
      ('2001:0db8:0:0:0:0:0:77','automated fixture','automatic',NOW()+INTERVAL '60 minutes'),
      ('::ffff:c000:24d','mapped fixture','manual',NOW()+INTERVAL '30 minutes')`);
    await pool.query("INSERT INTO panthorium_audit_events(event,ip) VALUES('auth.login_failed','::ffff:c000:24d')");
    await audit.init();await security.init();await security.init();
    const blocks=await security.listBlocks();
    assert.equal(blocks.filter(b=>b.ip==='2001:db8::77').length,1);
    assert(new Date((await security.getActiveBlock('2001:0db8:0:0:0:0:0:77')).expiresAt).getTime()>Date.now()+55*60000,'merge retains longest block');
    assert(await security.getActiveBlock('192.0.2.77'));
    assert.equal((await pool.query("SELECT ip FROM panthorium_audit_events WHERE ip='192.0.2.77'")).rowCount,1);
    // Independent workers observe the same revocation; there is no token cache.
    const other=new PostgresAuthRepository(url.href,'disable');
    const user=(await repository.listUsers())[0],session=await auth.issueSession(user),principal=auth.verifyAccessToken(session.accessToken);
    await other.revokeSession(principal.sid);
    await assert.rejects(auth.validateAccessSession(principal),/account_session_revoked/);
    console.log('PASS PostgreSQL boundaries: refresh races, cross-worker revocation, uncapped aggregates and idempotent IPv4/IPv6 migration');
  }finally{await closeDatabasePools();await root.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await root.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
