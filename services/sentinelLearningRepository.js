const { randomUUID } = require('crypto');

class SentinelLearningRepository {
  constructor({databaseUrl,databaseSslMode}={}){
    if(databaseUrl){const { getDatabasePool } = require('./databasePool');this.pool=getDatabasePool({connectionString:databaseUrl,ssl:databaseSslMode==='disable'?false:{rejectUnauthorized:false}});}else this.pool=null;
    this.versions=new Map();this.events=[];this.controls=new Map();
  }
  async init(){if(!this.pool)return;await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_learning_versions(
    version_id UUID PRIMARY KEY, example_id UUID NOT NULL, state TEXT NOT NULL,
    score INTEGER, risk TEXT NOT NULL DEFAULT 'normal', baseline_score INTEGER,
    shadow_samples INTEGER NOT NULL DEFAULT 0, shadow_score INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_at TIMESTAMPTZ, retired_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_panthorium_learning_state ON panthorium_learning_versions(state,created_at DESC);
  CREATE TABLE IF NOT EXISTS panthorium_learning_events(
    event_id UUID PRIMARY KEY, version_id UUID, event TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); CREATE INDEX IF NOT EXISTS idx_panthorium_learning_events_time ON panthorium_learning_events(created_at DESC);
  CREATE TABLE IF NOT EXISTS panthorium_learning_controls(
    control_key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
  );`);}
  // Durable operator switches (for example the promotion emergency stop) must
  // outlive a process restart and stay shared across Cloud Run instances.
  async getControl(key){if(this.pool){const q=await this.pool.query(`SELECT value,updated_at,updated_by FROM panthorium_learning_controls WHERE control_key=$1`,[key]);if(!q.rows[0])return null;return{value:q.rows[0].value||{},updatedAt:q.rows[0].updated_at instanceof Date?q.rows[0].updated_at.toISOString():q.rows[0].updated_at,updatedBy:q.rows[0].updated_by||null};}return this.controls.get(key)||null;}
  async setControl(key,value,{actor=null}={}){const updatedAt=new Date().toISOString();if(this.pool){await this.pool.query(`INSERT INTO panthorium_learning_controls(control_key,value,updated_at,updated_by) VALUES($1,$2::jsonb,NOW(),$3) ON CONFLICT(control_key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW(),updated_by=EXCLUDED.updated_by`,[key,JSON.stringify(value||{}),actor]);return this.getControl(key);}const item={value:value||{},updatedAt,updatedBy:actor};this.controls.set(key,item);return item;}
  map(r){return{versionId:r.version_id,exampleId:r.example_id,state:r.state,score:r.score==null?null:Number(r.score),risk:r.risk,baselineScore:r.baseline_score==null?null:Number(r.baseline_score),shadowSamples:Number(r.shadow_samples||0),shadowScore:r.shadow_score==null?null:Number(r.shadow_score),metadata:r.metadata||{},createdAt:r.created_at,promotedAt:r.promoted_at||null,retiredAt:r.retired_at||null};}
  async create({exampleId,state='quarantined',score=null,risk='normal',metadata={}}){const versionId=randomUUID(),now=new Date().toISOString();if(this.pool){const q=await this.pool.query(`INSERT INTO panthorium_learning_versions(version_id,example_id,state,score,risk,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,[versionId,exampleId,state,score,risk,JSON.stringify(metadata)]);return this.map(q.rows[0]);}const v={versionId,exampleId,state,score,risk,baselineScore:null,shadowSamples:0,shadowScore:null,metadata,createdAt:now,promotedAt:null,retiredAt:null};this.versions.set(versionId,v);return v;}
  async get(versionId){if(this.pool){const q=await this.pool.query(`SELECT * FROM panthorium_learning_versions WHERE version_id=$1`,[versionId]);return q.rows[0]?this.map(q.rows[0]):null;}return this.versions.get(versionId)||null;}
  async update(versionId,patch={}){const current=await this.get(versionId);if(!current)return null;const next={...current,...patch};if(this.pool){const q=await this.pool.query(`UPDATE panthorium_learning_versions SET state=$2,score=$3,risk=$4,baseline_score=$5,shadow_samples=$6,shadow_score=$7,metadata=$8::jsonb,promoted_at=$9,retired_at=$10 WHERE version_id=$1 RETURNING *`,[versionId,next.state,next.score,next.risk,next.baselineScore,next.shadowSamples,next.shadowScore,JSON.stringify(next.metadata||{}),next.promotedAt,next.retiredAt]);return this.map(q.rows[0]);}this.versions.set(versionId,next);return next;}
  async list({state,limit=100}={}){const n=Math.max(1,Math.min(Number(limit)||100,500));if(this.pool){const vals=[];let where='';if(state){vals.push(state);where=`WHERE state=$${vals.length}`;}vals.push(n);const q=await this.pool.query(`SELECT * FROM panthorium_learning_versions ${where} ORDER BY created_at DESC LIMIT $${vals.length}`,vals);return q.rows.map(r=>this.map(r));}return [...this.versions.values()].filter(v=>!state||v.state===state).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,n);}
  async event(versionId,event,payload={}){const item={eventId:randomUUID(),versionId:versionId||null,event,payload,createdAt:new Date().toISOString()};if(this.pool)await this.pool.query(`INSERT INTO panthorium_learning_events(event_id,version_id,event,payload) VALUES($1,$2,$3,$4::jsonb)`,[item.eventId,item.versionId,event,JSON.stringify(payload)]);else this.events.unshift(item);return item;}
  async recentEvents(limit=100){const n=Math.max(1,Math.min(Number(limit)||100,500));if(this.pool){const q=await this.pool.query(`SELECT * FROM panthorium_learning_events ORDER BY created_at DESC LIMIT $1`,[n]);return q.rows.map(r=>({eventId:r.event_id,versionId:r.version_id,event:r.event,payload:r.payload||{},createdAt:r.created_at}));}return this.events.slice(0,n);}
}
module.exports={SentinelLearningRepository};
