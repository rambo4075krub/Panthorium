'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {newDb}=require('pg-mem');
const {PostgresCreativeStudioRepository}=require('../services/creativeStudioRepository');
(async()=>{
  const db=newDb();
  db.public.registerFunction({name:'hashtextextended',args:['text','integer'],returns:'integer',implementation:()=>1});
  db.public.registerFunction({name:'pg_advisory_xact_lock',args:['integer'],returns:'integer',implementation:()=>1});
  const {Pool}=db.adapters.createPg();const pool=new Pool();
  const repository=new PostgresCreativeStudioRepository({pool});await repository.init();
  const ownerId=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID();
  const original={id,ownerId,idempotencyKey:'request-01',fingerprint:'same',status:'queued',currentStep:0,files:[],steps:[{pluginId:'document',status:'queued',input:{prompt:'รายงาน'}}]};
  const first=await repository.create(original);assert.equal(first.created,true);
  const replay=await repository.create({...original,id:crypto.randomUUID()});assert.equal(replay.created,false);assert.equal(replay.job.id,id);
  assert.equal(await repository.get(other,id),null);assert.equal((await repository.list(ownerId)).length,1);assert.equal((await repository.list(other)).length,0);
  await repository.setMode(ownerId,'image','never');assert.equal((await repository.modes(ownerId)).image,'never');assert.deepEqual(await repository.modes(other),{});
  await repository.setMode(ownerId,'image','auto');assert.equal((await repository.modes(ownerId)).image,'auto');
  const claimed=await repository.claim(ownerId,id);assert.ok(claimed.leaseToken);assert.equal(await repository.claim(ownerId,id),null);assert.equal(await repository.claim(other,id),null);
  claimed.status='completed';const saved=await repository.save(claimed,{release:true});assert.equal(saved.status,'completed');assert.equal(saved.leaseToken,null);
  await assert.rejects(repository.save({...claimed,leaseToken:crypto.randomUUID()}),/studio_lease_lost/);
  const recreated=new PostgresCreativeStudioRepository({pool});assert.equal((await recreated.get(ownerId,id)).status,'completed');assert.equal(recreated.durable,true);
  const activeOwner=crypto.randomUUID();
  const activeJob=index=>({...original,id:crypto.randomUUID(),ownerId:activeOwner,idempotencyKey:'active-'+index});
  const firstActive=await repository.create(activeJob(1));await repository.create(activeJob(2));
  await assert.rejects(repository.create(activeJob(3)),/studio_active_limit/);
  const activeReplay=await repository.create({...activeJob(4),idempotencyKey:'active-1'});assert.equal(activeReplay.job.id,firstActive.job.id,'replay remains allowed at cap');
  const mediaOwner=crypto.randomUUID();
  for(let index=0;index<2;index++) {
    const accepted=await repository.create({...original,id:crypto.randomUUID(),ownerId:mediaOwner,idempotencyKey:'media-'+index,steps:Array.from({length:5},()=>({pluginId:'image'}))});
    const lease=await repository.claim(mediaOwner,accepted.job.id);lease.status='needs_review';await repository.save(lease,{release:true});
  }
  await assert.rejects(repository.create({...original,id:crypto.randomUUID(),ownerId:mediaOwner,idempotencyKey:'media-over-cap',steps:[{pluginId:'image'}]}),/studio_daily_limit/);
  const dayOwner=crypto.randomUUID();
  for(let index=0;index<30;index++)await repository.create({...original,id:crypto.randomUUID(),ownerId:dayOwner,idempotencyKey:'day-'+index,status:'completed'});
  await assert.rejects(repository.create({...original,id:crypto.randomUUID(),ownerId:dayOwner,idempotencyKey:'day-over-cap'}),/studio_daily_limit/);
  await pool.end();console.log('creative studio PostgreSQL ledger: scoped persistence, replay, policies and claims passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
