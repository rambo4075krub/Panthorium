'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { newDb, DataType } = require('pg-mem');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');
const { normalizeNote } = require('../services/cloudNotesRepository');
const { createMemoryRouter } = require('../routes/memory');

const alice = { sub:'11111111-1111-4111-8111-111111111111',permissions:['chat'] };
const bob = { sub:'22222222-2222-4222-8222-222222222222',permissions:['chat'] };
class FakeGcsNotes {
  constructor() { this.items=new Map(); this.failWrite=false; }
  key(user,id) { return user+':'+id; }
  async create(input) {
    if (this.failWrite) throw new Error('gcs_write_failed');
    const item=normalizeNote(input); this.items.set(this.key(item.userId,item.memoryId),item); return structuredClone(item);
  }
  async get(user,id) { const item=this.items.get(this.key(user,id)); return item ? structuredClone(item) : null; }
  async list(user,limit=100) { return [...this.items.values()].filter(x=>x.userId===user).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,limit).map(x=>structuredClone(x)); }
  async update(user,id,patch) { const item=await this.get(user,id); return item ? this.create({ ...item,...patch,updatedAt:new Date().toISOString() }) : null; }
  async delete(user,id) { return this.items.delete(this.key(user,id)); }
}
function postgresPool() {
  // pg-mem skips CREATE IF NOT EXISTS bodies on repeat initialization.
  const db=newDb({ noAstCoverageCheck:true });
  db.public.registerFunction({ name:'hashtext',args:[DataType.text],returns:DataType.integer,implementation:()=>1 });
  db.public.registerFunction({ name:'pg_advisory_xact_lock',args:[DataType.integer],returns:DataType.integer,implementation:()=>1 });
  return new (db.adapters.createPg().Pool)();
}
async function isolationSuite(repository, label) {
  let knowledgeCalls=0;
  const service=new AgentMemoryService({ repository,knowledge:{ allowed:()=>true,context:async()=>{ knowledgeCalls++; return { ok:true,context:[{ documentId:'private',content:'marker personal document' }] }; } } });
  await service.init(); await service.init();
  const items={};
  for (const scope of ['personal','work','study','family']) {
    const result=await service.remember({ user:alice,kind:'fact',scope,title:'marker '+scope,content:'marker private '+scope,confirmation:'confirmed',sensitivity:'sensitive',confidence:0.91,provenance:{ type:'conversation',reference:'turn:42',observedAt:'2026-01-01T00:00:00Z' },expiresAt:new Date(Date.now()+3600000).toISOString() });
    assert.equal(result.ok,true,label); items[scope]=result.memory;
    assert.equal(result.memory.provenance.reference,'turn:42');
  }
  assert.equal((await service.list({ user:alice })).memories.length,1,'default only personal');
  for (const scope of Object.keys(items)) {
    const id=items[scope].memoryId;
    assert.deepEqual((await service.list({ user:alice,scope })).memories.map(x=>x.memoryId),[id]);
    assert.deepEqual((await service.search({ user:alice,scope,query:'marker' })).memories.map(x=>x.memoryId),[id]);
    assert.equal((await service.get({ user:alice,scope,memoryId:id })).memory.confirmation,'confirmed');
    for (const wrongScope of Object.keys(items).filter(x=>x!==scope)) {
      assert.equal((await service.get({ user:alice,scope:wrongScope,memoryId:id })).error,'memory_not_found');
      assert.equal((await service.update({ user:alice,scope:wrongScope,memoryId:id,content:'stolen' })).error,'memory_not_found');
      assert.equal((await service.remove({ user:alice,scope:wrongScope,memoryId:id })).error,'memory_not_found');
    }
    assert.equal((await service.list({ user:bob,scope })).memories.length,0);
    assert.equal((await service.search({ user:bob,scope,query:'marker' })).memories.length,0);
    assert.equal((await service.get({ user:bob,scope,memoryId:id })).error,'memory_not_found');
    assert.equal((await service.update({ user:bob,scope,memoryId:id,content:'stolen' })).error,'memory_not_found');
    assert.equal((await service.remove({ user:bob,scope,memoryId:id })).error,'memory_not_found');
    const context=await service.context({ user:alice,scope,query:'marker' });
    assert(context.context.every(x=>x.scope===scope),'context scope');
    assert(context.context.filter(x=>x.sourceType==='memory').every(x=>x.memoryId===id));
    if (scope!=='personal') assert.equal(context.knowledgeMatches,0,'unscoped knowledge cannot cross context');
  }
  assert.equal(knowledgeCalls,1,'knowledge only read in personal context');
  const work=items.work;
  const edited=await service.update({ user:alice,scope:'work',memoryId:work.memoryId,content:'marker edited' });
  assert.equal(edited.memory.confirmation,'unconfirmed','changed content must not inherit confirmation of previous version');
  const confirmed=await service.update({ user:alice,scope:'work',memoryId:work.memoryId,confirmation:'confirmed',sensitivity:'restricted',source:'owner-reviewed' });
  assert.equal(confirmed.memory.confirmation,'confirmed'); assert.equal(confirmed.memory.source,'owner-reviewed');
  await assert.rejects(()=>repository.update(alice.sub,work.memoryId,{ scope:'family' },'work'),/memory_scope_immutable/);
  for (const scope of [null,'','*','organization',{},['work']]) assert.equal((await service.list({ user:alice,scope })).error,'invalid_memory_scope');
  for (const input of [{ confirmation:'true' },{ sensitivity:'public' },{ provenance:{ type:'conversation',extra:'hidden' } },{ provenance:{ type:'document',reference:42 } },{ provenance:{ type:'system',observedAt:'yesterday' } },{ expiresAt:'bad-date' }]) {
    assert.equal((await service.remember({ user:alice,kind:'fact',title:'bad',content:'bad',...input })).ok,false,'reject invalid metadata');
  }
  const expired=await repository.create({ userId:alice.sub,scope:'work',kind:'fact',title:'expiredmarker',content:'expiredmarker',expiresAt:new Date(Date.now()-1000).toISOString() });
  assert.equal(await repository.get(alice.sub,expired.memoryId,'work'),null);
  assert.equal((await service.search({ user:alice,scope:'work',query:'expiredmarker' })).memories.length,0);
  assert.equal((await service.update({ user:alice,scope:'work',memoryId:expired.memoryId,expiresAt:null })).error,'memory_not_found','expired data not silently revived');
  assert.equal((await service.remove({ user:alice,scope:'work',memoryId:expired.memoryId })).ok,true,'owner can erase expired memory');
  return service;
}

async function main() {
  await isolationSuite(new AgentMemoryRepository(),'memory adapter');
  const pool=postgresPool();
  try {
    // Simulate a database created before the additive migration.
    await pool.query(`CREATE TABLE panthorium_agent_memories(memory_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,tags JSONB NOT NULL DEFAULT '[]'::jsonb,source TEXT,importance INTEGER NOT NULL DEFAULT 50,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const legacyId=randomUUID();
    await pool.query("INSERT INTO panthorium_agent_memories(memory_id,user_id,kind,title,content) VALUES($1,$2,'fact','legacy','old data')",[legacyId,bob.sub]);
    const repository=new AgentMemoryRepository(); repository.pool=pool;
    await repository.init(); await repository.init();
    // pg-mem's composite index does not materialize defaults on old rows;
    // verify additive migration values directly, then exercise scoped queries on new rows.
    const legacy=(await pool.query('SELECT * FROM panthorium_agent_memories')).rows.find(row=>row.memory_id===legacyId);
    assert.equal(legacy.scope,'personal'); assert.equal(legacy.confirmation,'unconfirmed'); assert.equal(legacy.content,'old data');
    assert.equal(await repository.get(bob.sub,legacyId,'work'),null);
    await pool.query('DELETE FROM panthorium_agent_memories WHERE memory_id=$1',[legacyId]);
    await isolationSuite(repository,'PostgreSQL adapter');

    const migratingNote=await repository.create({ userId:alice.sub,kind:'note',scope:'study',title:'migration marker',content:'kept in cloud',confirmation:'confirmed',sensitivity:'restricted',provenance:{ type:'import',reference:'legacy:note' } });
    const cloud=new FakeGcsNotes();
    const noteRepo=new AgentMemoryRepository({ notesRepository:cloud }); noteRepo.pool=pool;
    const noteService=new AgentMemoryService({ repository:noteRepo });
    await noteService.init();
    const cloudLegacy=await cloud.create({ userId:alice.sub,title:'old personal',content:'legacy marker' });
    assert.equal((await noteService.list({ user:alice,kind:'note' })).memories[0].memoryId,cloudLegacy.memoryId);
    const migrated=await noteRepo.get(alice.sub,migratingNote.memoryId,'study');
    assert.equal(migrated.sensitivity,'restricted'); assert.equal(migrated.provenance.reference,'legacy:note');
    assert.equal((await cloud.get(alice.sub,migratingNote.memoryId)).content,'kept in cloud');
    assert.equal((await pool.query('SELECT * FROM panthorium_agent_memories WHERE memory_id=$1',[migratingNote.memoryId])).rows.length,0);
    assert.equal(await noteRepo.get(alice.sub,migratingNote.memoryId),null,'migration never exposes scoped note as personal');
    const work=await noteService.remember({ user:alice,kind:'note',scope:'work',title:'project marker',content:'project marker',confirmation:'inferred',sensitivity:'restricted',provenance:{ type:'document',reference:'doc:1' },expiresAt:new Date(Date.now()+3600000).toISOString() });
    assert.equal(work.ok,true); const id=work.memory.memoryId;
    assert.equal((await cloud.get(alice.sub,id)).scope,undefined,'real GCS normalizer strips metadata; SQL sidecar is required');
    assert.equal((await pool.query('SELECT content FROM panthorium_agent_memories WHERE memory_id=$1',[id])).rows.length,0,'note content remains only in GCS');
    // Simulate another process: no in-memory metadata or migration state.
    const resumed=new AgentMemoryRepository({ notesRepository:cloud }); resumed.pool=pool; await resumed.init();
    assert.equal(await resumed.get(alice.sub,id),null);
    assert.equal(await resumed.get(bob.sub,id,'work'),null);
    assert.equal((await resumed.get(alice.sub,id,'work')).sensitivity,'restricted');
    assert.equal((await resumed.search(alice.sub,'marker',30,'work')).filter(item=>item.kind==='note').length,1);
    assert.equal((await resumed.list(alice.sub,30,'note','personal')).some(x=>x.memoryId===id),false);
    assert.equal(await resumed.update(alice.sub,id,{ content:'wrong' },'personal'),null);
    assert.equal(await resumed.delete(alice.sub,id,'family'),false);
    const updated=await noteService.update({ user:alice,memoryId:id,scope:'work',content:'marker changed',confirmation:'confirmed' });
    assert.equal(updated.memory.confirmation,'confirmed');
    assert.equal((await cloud.get(alice.sub,id)).content,'marker changed');
    await pool.query('UPDATE panthorium_agent_note_metadata SET expires_at=$1 WHERE user_id=$2 AND memory_id=$3',[new Date(Date.now()-1000),alice.sub,id]);
    assert.equal(await resumed.get(alice.sub,id,'work'),null);
    assert.equal((await resumed.list(alice.sub,30,'note','work')).length,0);
    assert.equal((await resumed.search(alice.sub,'marker',30,'work')).filter(item=>item.kind==='note').length,0);
    assert.equal(await resumed.delete(alice.sub,id,'work'),true);
    assert.equal(await cloud.get(alice.sub,id),null);
    assert.equal((await pool.query('SELECT * FROM panthorium_agent_note_metadata WHERE memory_id=$1',[id])).rows.length,0);
    cloud.failWrite=true;
    await assert.rejects(()=>noteService.remember({ user:alice,scope:'family',title:'failed',content:'never published' }),/gcs_write_failed/);
    assert.equal((await resumed.list(alice.sub,30,'note','family')).length,0,'failed writes publish no data');
  } finally { await pool.end(); }

  const service=new AgentMemoryService({ repository:new AgentMemoryRepository() });
  const app=express(); app.use(express.json());
  app.use('/memory',createMemoryRouter({ verifyAccessToken:token=>token==='bob' ? bob : alice },service));
  const server=app.listen(0);
  try {
    const base='http://127.0.0.1:'+server.address().port+'/memory';
    const request=async(path='',method='GET',body,token='alice')=>{
      const response=await fetch(base+path,{ method,headers:{ Authorization:'Bearer '+token,'Content-Type':'application/json' },...(body===undefined ? {} : { body:JSON.stringify(body) }) });
      return { status:response.status,body:await response.json() };
    };
    assert.equal((await fetch(base)).status,401);
    const created=await request('','POST',{ kind:'fact',scope:'study',title:'marker',content:'study marker',confirmation:'confirmed',sensitivity:'sensitive',provenance:{ type:'user' },confidence:0.9,expiresAt:new Date(Date.now()+3600000).toISOString(),userId:bob.sub });
    assert.equal(created.status,201); const id=created.body.memory.memoryId;
    assert.equal(created.body.memory.userId,alice.sub,'owner comes from auth, not body');
    assert.equal(created.body.memory.scope,'study'); assert.equal(created.body.memory.confirmation,'confirmed');
    assert.equal((await request('/'+id)).status,404);
    assert.equal((await request('/'+id+'?scope=study')).status,200);
    assert.equal((await request('/'+id+'?scope=study','GET',undefined,'bob')).status,404);
    assert.equal((await request('?scope=*')).status,400);
    assert.equal((await request('/search','POST',{ scope:null,query:'marker' })).status,400);
    assert.equal((await request('/'+id+'?scope=study','PATCH',{ scope:'work',content:'wrong' })).status,400);
    assert.equal((await request('/search','POST',{ scope:'study',query:'marker' })).body.memories.length,1);
    assert.equal((await request('/context','POST',{ scope:'work',query:'marker' })).body.context.length,0);
    const edited=await request('/'+id,'PATCH',{ scope:'study',confirmation:'inferred',sensitivity:'restricted',expiresAt:null });
    assert.equal(edited.status,200); assert.equal(edited.body.memory.expiresAt,null); assert.equal(edited.body.memory.confirmation,'inferred');
    assert.equal((await request('/'+id,'DELETE',{ scope:'work' })).status,404);
    assert.equal((await request('/'+id+'?scope=study','DELETE')).status,200);
  } finally { await new Promise(resolve=>server.close(resolve)); }
  console.log('PASS scoped memory: owner/scope isolation, metadata, expiry, additive SQL migration, durable GCS sidecar, and API boundaries');
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
