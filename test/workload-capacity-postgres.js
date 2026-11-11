'use strict';
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { fork } = require('node:child_process');
const { Pool } = require('pg');
const { CapacityRepository } = require('../services/capacityRepository');
const { SharedCapacityGate } = require('../services/workloadCapacity');
const base = {limit:1,maxQueue:1,perUserLimit:1,maxQueuedPerUser:1,queueTimeoutMs:3000};
const loadPolicy = {...base,limit:4,maxQueue:100,queueTimeoutMs:15000};
function makePool(schema) {
  assert.match(schema,/^capacity_ci_[a-f0-9]{20}$/);
  return new Pool({connectionString:process.env.TEST_DATABASE_URL,max:4,connectionTimeoutMillis:5000,options:`-c search_path=${schema},public -c statement_timeout=5000`});
}
async function until(check) {
  const deadline=Date.now()+3000;
  while(!await check()){assert.ok(Date.now()<deadline,'condition timed out');await delay(10);}
}
async function worker() {
  const pool=makePool(process.env.PANTHORIUM_CAPACITY_TEST_SCHEMA);
  try {
    const repository=new CapacityRepository({pool});await repository.init();
    const gate=new SharedCapacityGate({repository,name:'load',policy:loadPolicy,pollMs:15});
    await Promise.all(Array.from({length:20},(_,index)=>gate.run(async()=>{
      await pool.query('UPDATE capacity_probe SET active=active+1,peak=GREATEST(peak,active+1)');
      try {await delay(20);} finally {await pool.query('UPDATE capacity_probe SET active=active-1,completed=completed+1');}
    },{userId:`synthetic-${process.pid}-${index}`})));
  } finally {await pool.end();}
}
async function main() {
  if(!process.env.TEST_DATABASE_URL){if(process.env.CI)throw new Error('TEST_DATABASE_URL required for capacity integration');console.log('SKIP PostgreSQL capacity: TEST_DATABASE_URL not set');return;}
  const schema='capacity_ci_'+randomBytes(10).toString('hex');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  let first,second,created=false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    first=makePool(schema);second=makePool(schema);
    const one=new CapacityRepository({pool:first}),two=new CapacityRepository({pool:second});
    await one.init();await two.init();
    const a=new SharedCapacityGate({repository:one,name:'text',policy:base,pollMs:10});
    const b=new SharedCapacityGate({repository:two,name:'text',policy:base,pollMs:10});
    const hold=await a.acquire({userId:'holder'});
    const controller=new AbortController();let invoked=false;
    const waiting=b.run(()=>{invoked=true;},{userId:'waiting',signal:controller.signal});
    const waitingCheck=assert.rejects(waiting,/cancel/);
    await until(async()=> (await one.snapshot()).some(row=>row.lane==='text'&&row.queued===1));
    await assert.rejects(a.acquire({userId:'overflow'}),/system_busy/);
    controller.abort(new Error('cancel'));await waitingCheck;
    assert.equal(invoked,false);assert.equal((await one.snapshot())[0].queued,0);
    const incompatible=new SharedCapacityGate({repository:two,name:'text',policy:{...base,limit:2},pollMs:10});
    await assert.rejects(incompatible.acquire({userId:'config'}),/capacity_configuration_mismatch/);
    await hold();await hold();
    const next=await b.acquire({userId:'next'});await next();
    assert.equal((await one.snapshot()).length,0);

    const fairPolicy={...base,limit:2,maxQueue:2};
    const fairA=new SharedCapacityGate({repository:one,name:'fair',policy:fairPolicy,pollMs:10});
    const fairB=new SharedCapacityGate({repository:two,name:'fair',policy:fairPolicy,pollMs:10});
    const owner=await fairA.acquire({userId:'same-account'});
    const queued=fairB.acquire({userId:'same-account'});
    await until(async()=>(await one.snapshot()).some(row=>row.lane==='fair'&&row.queued===1));
    const other=await fairB.acquire({userId:'other-account'});
    assert.equal((await one.snapshot()).find(row=>row.lane==='fair').active,2);
    await other();await owner();await (await queued)();

    const crashed=randomUUID();
    assert.equal(await one.poll({lane:'crash',policy:base,ticketId:crashed,userId:'dead-worker',create:true}),'active');
    await first.query("UPDATE panthorium_capacity_tickets SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE ticket_id=$1",[crashed]);
    const recovered=new SharedCapacityGate({repository:two,name:'crash',policy:base});
    const replacement=await recovered.acquire({userId:'replacement'});
    assert.equal(await one.renew(crashed),false,'an expired lease cannot be resurrected');await replacement();
    assert.equal((await first.query('SELECT COUNT(*)::int n FROM panthorium_capacity_tickets')).rows[0].n,0);

    const timeoutGate=new SharedCapacityGate({repository:one,name:'timeout',policy:{...base,queueTimeoutMs:100},pollMs:10});
    const timeoutHold=await timeoutGate.acquire({userId:'hold'});
    await assert.rejects(timeoutGate.acquire({userId:'timeout'}),/system_busy/);await timeoutHold();
    assert.equal((await one.snapshot()).length,0,'timed out requests release their global queue slot');

    await first.query('CREATE TABLE capacity_probe(active INT,peak INT,completed INT); INSERT INTO capacity_probe VALUES(0,0,0)');
    const workers=Array.from({length:4},()=>new Promise((resolve,reject)=>{
      const child=fork(__filename,['worker'],{env:{...process.env,PANTHORIUM_CAPACITY_TEST_SCHEMA:schema},stdio:['ignore','inherit','inherit','ipc']});
      child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('capacity load worker failed')));
    }));
    await Promise.all(workers);
    const measured=(await first.query('SELECT * FROM capacity_probe')).rows[0];
    assert.equal(measured.active,0);assert.equal(measured.completed,80);assert.ok(measured.peak<=4&&measured.peak>=2);
    assert.equal((await one.snapshot()).length,0);
    const bad=new SharedCapacityGate({repository:{...one,poll:async()=>{throw new Error('database_offline');},release:async()=>{}},name:'bad',policy:base});
    await assert.rejects(bad.run(()=>assert.fail('must fail closed'),{userId:'u'}),/capacity_unavailable/);
    console.log('PostgreSQL capacity: four Node processes, 80 synthetic jobs, peak '+measured.peak+'/4; shared queue bounds, account fairness, cancellation, timeout, crash recovery and policy conflict passed');
  } finally {
    if(first)await first.end();if(second)await second.end();
    if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();
  }
}
(process.argv[2]==='worker'?worker():main()).catch(error=>{console.error(error);process.exitCode=1;});
