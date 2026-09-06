const { randomUUID } = require('crypto');

class SentinelLearningRepository {
  constructor({databaseUrl,databaseSslMode}={}){
    if(databaseUrl){const{Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:databaseSslMode==='disable'?false:{rejectUnauthorized:false}});}else this.pool=null;
    this.versions=new Map();this.events=[];
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
  ); CREATE INDEX IF NOT EXISTS idx_panthorium_learning_events_time ON panthorium_learning_events(created_at DESC);`);}
  map(r){return{versionId:r.version_id,exampleId:r.example_id,state:r.state,score:r.score==null?null:Number(r.score),risk:r.risk,baselineScore:r.baseline_score==null?null:Number(r.baseline_score),shadowSamples:Number(r.shadow_samples||0),shadowScore:r.shadow_score==null?null:Number(r.shadow_score),metadata:r.metadata||{},createdAt:r.created_at,promotedAt:r.promoted_at||null,retiredAt:r.retired_at||null};}
  async create({exampleId,state='quarantined',score=null,risk='normal',metadata={}}){const versionId=randomUUID(),now=new Date().toISOString();if(this.pool){const q=await this.pool.query(`INSERT INTO panthorium_learning_versions(version_id,example_id,state,score,risk,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,[versionId,exampleId,state,score,risk,JSON.stringify(metadata)]);return this.map(q.rows[0]);}const v={versionId,exampleId,state,score,risk,baselineScore:null,shadowSamples:0,shadowScore:null,metadata,createdAt:now,promotedAt:null,retiredAt:null};this.versions.set(versionId,v);return v;}
  async get(versionId){if(this.pool){const q=await this.pool.query(`SELECT * FROM panthorium_learning_versions WHERE version_id=$1`,[versionId]);return q.rows[0]?this.map(q.rows[0]):null;}return this.versions.get(versionId)||null;}
  async update(versionId,patch={}){const current=await this.get(versionId);if(!current)return null;const next={...current,...patch};if(this.pool){const q=await this.pool.query(`UPDATE panthorium_learning_versions SET state=$2,score=$3,risk=$4,baseline_score=$5,shadow_samples=$6,shadow_score=$7,metadata=$8::jsonb,promoted_at=$9,retired_at=$10 WHERE version_id=$1 RETURNING *`,[versionId,next.state,next.score,next.risk,next.baselineScore,next.shadowSamples,next.shadowScore,JSON.stringify(next.metadata||{}),next.promotedAt,next.retiredAt]);return this.map(q.rows[0]);}this.versions.set(versionId,next);return next;}
  async list({state,limit=100}={}){const n=Math.max(1,Math.min(Number(limit)||100,500));if(this.pool){const vals=[];let where='';if(state){vals.push(state);where=`WHERE state=$${vals.length}`;}vals.push(n);const q=await this.pool.query(`SELECT * FROM panthorium_learning_versions ${where} ORDER BY created_at DESC LIMIT $${vals.length}`,vals);return q.rows.map(r=>this.map(r));}return [...this.versions.values()].filter(v=>!state||v.state===state).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,n);}
  async event(versionId,event,payload={}){const item={eventId:randomUUID(),versionId:versionId||null,event,payload,createdAt:new Date().toISOString()};if(this.pool)await this.pool.query(`INSERT INTO panthorium_learning_events(event_id,version_id,event,payload) VALUES($1,$2,$3,$4::jsonb)`,[item.eventId,item.versionId,event,JSON.stringify(payload)]);else this.events.unshift(item);return item;}
  async recentEvents(limit=100){const n=Math.max(1,Math.min(Number(limit)||100,500));if(this.pool){const q=await this.pool.query(`SELECT * FROM panthorium_learning_events ORDER BY created_at DESC LIMIT $1`,[n]);return q.rows.map(r=>({eventId:r.event_id,versionId:r.version_id,event:r.event,payload:r.payload||{},createdAt:r.created_at}));}return this.events.slice(0,n);}
}
module.exports={SentinelLearningRepository};