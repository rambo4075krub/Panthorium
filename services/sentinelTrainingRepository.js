const { randomUUID } = require('crypto');

class SentinelTrainingRepository {
  constructor({ databaseUrl, databaseSslMode } = {}) {
    if(databaseUrl){const{Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:databaseSslMode==='disable'?false:{rejectUnauthorized:false}});}else this.pool=null;
    this.examples = new Map();
  }

  async init() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_training_examples (
      example_id UUID PRIMARY KEY, prompt TEXT NOT NULL, answer TEXT NOT NULL, source TEXT,
      provider TEXT, model TEXT, tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_by TEXT NOT NULL, reviewed_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
    ); CREATE INDEX IF NOT EXISTS idx_panthorium_training_status ON panthorium_training_examples(status, created_at DESC);`);
  }

  map(row) {
    return { exampleId:row.example_id,prompt:row.prompt,answer:row.answer,source:row.source||null,provider:row.provider||null,model:row.model||null,tags:row.tags||[],status:row.status,createdBy:row.created_by,reviewedBy:row.reviewed_by||null,createdAt:row.created_at,reviewedAt:row.reviewed_at||null };
  }

  async create({ prompt, answer, source, provider, model, tags, createdBy }) {
    const exampleId=randomUUID(); const now=new Date().toISOString();
    if(this.pool){const result=await this.pool.query(`INSERT INTO panthorium_training_examples(example_id,prompt,answer,source,provider,model,tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,[exampleId,prompt,answer,source||null,provider||null,model||null,JSON.stringify(tags||[]),createdBy]);return this.map(result.rows[0]);}
    const example={exampleId,prompt,answer,source:source||null,provider:provider||null,model:model||null,tags:tags||[],status:'pending',createdBy,reviewedBy:null,createdAt:now,reviewedAt:null};this.examples.set(exampleId,example);return example;
  }

  async list({status,limit=50}={}) {
    const n=Math.max(1,Math.min(Number(limit)||50,200));
    if(this.pool){const values=[];let where='';if(status){values.push(status);where=`WHERE status=$${values.length}`;}values.push(n);const result=await this.pool.query(`SELECT * FROM panthorium_training_examples ${where} ORDER BY created_at DESC LIMIT $${values.length}`,values);return result.rows.map(row=>this.map(row));}
    return [...this.examples.values()].filter(item=>!status||item.status===status).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,n);
  }

  async review(exampleId,status,reviewedBy) {
    const reviewedAt=new Date().toISOString();
    if(this.pool){const result=await this.pool.query(`UPDATE panthorium_training_examples SET status=$2,reviewed_by=$3,reviewed_at=$4 WHERE example_id=$1 RETURNING *`,[exampleId,status,reviewedBy,reviewedAt]);return result.rows[0]?this.map(result.rows[0]):null;}
    const current=this.examples.get(exampleId);if(!current)return null;const next={...current,status,reviewedBy,reviewedAt};this.examples.set(exampleId,next);return next;
  }

  async approved(){return this.list({status:'approved',limit:200});}
  async stats(){
    if(this.pool){const result=await this.pool.query(`SELECT status,COUNT(*)::int AS count FROM panthorium_training_examples GROUP BY status`);const counts={pending:0,approved:0,rejected:0};for(const row of result.rows)counts[row.status]=row.count;return{...counts,total:counts.pending+counts.approved+counts.rejected,persistence:'postgresql'};}
    const counts={pending:0,approved:0,rejected:0};for(const item of this.examples.values())counts[item.status]++;return{...counts,total:this.examples.size,persistence:'memory'};
  }
}
module.exports={SentinelTrainingRepository};
