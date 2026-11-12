'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {LocalInsightsRepository}=require('../services/localInsightsRepository');
const {LocalInsightsService}=require('../services/localInsightsService');
const {AgentService}=require('../services/agentService');
const {ActionLedgerRepository}=require('../services/actionLedgerRepository');
(async()=>{
  if(!process.env.TEST_DATABASE_URL){if(process.env.CI)throw new Error('TEST_DATABASE_URL required');console.log('SKIP local insights PostgreSQL: TEST_DATABASE_URL not set');return;}
  const schema='insights_ci_'+randomBytes(10).toString('hex');
  const root=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});let pool;
  try{
    await root.query(`CREATE SCHEMA "${schema}"`);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:6,options:`-c search_path=${schema},public -c statement_timeout=15000`});
    await pool.query('CREATE TABLE panthorium_users(id UUID PRIMARY KEY); CREATE TABLE panthorium_audit_events(event TEXT,time TIMESTAMPTZ DEFAULT NOW(),ip TEXT,status INTEGER,actor_user_id TEXT); CREATE TABLE panthorium_security_ip_blocks(ip TEXT PRIMARY KEY,reason TEXT,source TEXT,created_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,created_by TEXT)');
    const users=Array.from({length:7},()=>randomUUID()),admin=users[0],owner=users[1],ordinary=users[2];
    for(const id of users)await pool.query('INSERT INTO panthorium_users VALUES($1)',[id]);
    const repo=new LocalInsightsRepository({pool});await repo.init();await repo.init();
    assert.equal((await repo.preferences(ordinary)).enabled,false);
    const item=id=>({userId:id,feature:'social',day:new Date().toISOString().slice(0,10),since:Date.now()+1,total:2,errors:1,denied:0,slow:1});
    await repo.addCounters([item(ordinary)]);assert.equal((await repo.preferences(ordinary)).counters.length,0);
    for(const id of users.slice(2)){await repo.setConsent(id,true);await repo.addCounters([item(id)]);}
    assert.equal((await repo.aggregate())[0].accounts,5);assert.equal((await repo.preferences(admin)).counters.length,0);
    await repo.setEnabled(owner,true);const control=await repo.control();
    await repo.setConsent(ordinary,false);assert.equal((await repo.aggregate()).length,0);
    assert.equal(await repo.finishAnalysis(control,{text:'stale private summary'},'ready'),false);
    assert.equal((await repo.control()).report,null);
    await Promise.all([repo.addCounters([item(ordinary)]),repo.setConsent(ordinary,false)]);
    assert.equal((await repo.preferences(ordinary)).counters.length,0);
    // No payload queued before renewed consent may be written afterwards.
    const buffered={...item(ordinary),since:Date.now()-1000};await repo.setConsent(ordinary,true);await repo.addCounters([buffered]);assert.equal((await repo.preferences(ordinary)).counters.length,0);
    await pool.query("INSERT INTO panthorium_insights_counters VALUES($1,(NOW() AT TIME ZONE 'UTC')::date-30,'files',1,0,0,0)",[ordinary]);
    assert.equal((await repo.preferences(ordinary)).counters.length,0);await repo.cleanup();
    assert.equal((await pool.query("SELECT * FROM panthorium_insights_counters WHERE feature='files'")).rowCount,0,'expired daily counters are erased');
    const eligible=new Set([admin,owner]),records=[];
    const audit={pool,record:(event,fields)=>records.push({event,...fields})};
    const notices=new Map();
    const auth={repository:{findUserById:async id=>({id,permissions:['chat'],roles:id===admin?['administrator']:['user'],...(id===owner?{email:'rambo4075krub@gmail.com',emailVerifiedAt:new Date().toISOString()}:{})}),findUserByUsername:async()=>({id:admin,roles:['administrator']}),findUserByEmail:async()=>({id:owner,email:'rambo4075krub@gmail.com',emailVerifiedAt:new Date().toISOString()})}};
    const ledger=new ActionLedgerRepository({pool});await ledger.init();
    const tool={id:'security.incident_response',description:'Approve temporary block',permission:'chat',risk:'high',mutates:true,requiresConfirmation:true,validateArgs:()=>null};
    const agent=new AgentService({tools:{get:()=>tool},audit,ledger});
    const service=new LocalInsightsService({repository:repo,auth,audit,agent,security:{normalizeIp:s=>s.replace(/^::ffff:/,'')},providers:{authorizeLocal:async id=>eligible.has(id)},notifications:{publish:async p=>notices.set(p.sourceId,p)}});
    service.analyze=async()=>{};tool.run=input=>service.execute(input);
    await repo.setEnabled(owner,true);
    for(let i=0;i<5;i++)await pool.query("INSERT INTO panthorium_audit_events(event,ip) VALUES('auth.login_failed','::ffff:8.8.4.4')");
    await service.tick();assert.equal(notices.size,2);assert.deepEqual(new Set([...notices.values()].map(n=>n.userId)),eligible);
    await service.tick();assert.equal(notices.size,2,'repeated scan does not spam');
    for(let i=0;i<5;i++)await pool.query("INSERT INTO panthorium_audit_events(event,ip) VALUES('auth.login_failed','::ffff:8.8.4.4')");
    await service.tick();assert.equal(notices.size,4,'severity escalation sends once to each recipient');
    const incident=(await repo.incidents())[0],user={sub:owner,permissions:['chat']};
    await assert.rejects(service.plan({sub:ordinary},incident.id,'1.1.1.1'),/insights_operator_required/);
    await assert.rejects(service.plan(user,incident.id,'8.8.4.4'),/incident_manual_review_required/);
    const [one,two]=await Promise.all([service.plan(user,incident.id,'1.1.1.1'),service.plan({sub:admin,permissions:['chat']},incident.id,'1.1.1.1')]);
    assert.equal(one.plan.hash,two.plan.hash,'concurrent reviewers see the same frozen plan');
    assert.equal(one.plan.ip,'8.8.4.4','block target uses the same normalization as the enforcement middleware');
    await repo.setConsent(ordinary,false);
    assert.equal((await repo.control()).action_epoch,one.plan.generation,'ordinary consent changes cannot invalidate security approvals');
    assert.equal((await pool.query('SELECT * FROM panthorium_security_ip_blocks')).rows.length,0,'preparing plan causes no block');
    assert.equal((await agent.confirmAction({user,actionId:one.approval.actionId,approvalHash:'0'.repeat(64)})).error,'action_approval_invalid');
    const results=await Promise.all([agent.confirmAction({user,actionId:one.approval.actionId,approvalHash:one.approval.approvalHash}),agent.confirmAction({user:{sub:admin,permissions:['chat']},actionId:two.approval.actionId,approvalHash:two.approval.approvalHash})]);
    assert.equal(results.filter(r=>r.ok).length,1,'only one reviewer executes incident');
    let blocks=(await pool.query('SELECT * FROM panthorium_security_ip_blocks')).rows;assert.equal(blocks.length,1);assert.equal(blocks[0].source,'ai:'+incident.id);
    await service.undo(owner,incident.id);assert.equal((await pool.query('SELECT * FROM panthorium_security_ip_blocks')).rowCount,0);
    // An automatic rule replacing the block must survive rollback.
    await pool.query("UPDATE panthorium_insights_incidents SET state='blocked' WHERE id=$1",[incident.id]);
    await pool.query("INSERT INTO panthorium_security_ip_blocks(ip,source,expires_at) VALUES('8.8.4.4','automatic',NOW()+INTERVAL '30 minutes')");
    assert.equal((await service.undo(owner,incident.id)).removed,false);assert.equal((await pool.query('SELECT * FROM panthorium_security_ip_blocks')).rowCount,1);
    // A stopped worker invalidates already-issued approvals; fresh authorization is mandatory.
    await pool.query("UPDATE panthorium_insights_incidents SET state='observed',plan=NULL WHERE id=$1",[incident.id]);
    const fresh=await service.plan(user,incident.id,'1.1.1.1');await service.setEnabled(owner,false);
    const stopped=await agent.confirmAction({user,actionId:fresh.approval.actionId,approvalHash:fresh.approval.approvalHash});assert.equal(stopped.ok,false);
    eligible.delete(owner);await assert.rejects(service.overview(owner),/insights_operator_required/);
    for(let i=0;i<5;i++)await pool.query("INSERT INTO panthorium_audit_events(event,ip) VALUES('auth.login_failed','1.1.1.1')");
    await service.tick();assert.equal(notices.size,5,'revoked model operator cannot silence alerts to the other authorized recipient');
    console.log('PostgreSQL insights: isolated opt-in counters, erasure/report race, recipient dedupe/escalation, exact approval, concurrent reviewer exclusion, stop and rollback ownership passed');
  }finally{if(pool)await pool.end();await root.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await root.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
