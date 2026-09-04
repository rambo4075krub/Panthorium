const { randomUUID } = require('crypto');
class IntegrationExecutionRepository {
  constructor({ databaseUrl, databaseSslMode } = {}) { this.databaseUrl=databaseUrl;this.databaseSslMode=databaseSslMode;this.pool=null;this.memory=new Map(); }
  async init(){if(!this.databaseUrl)return;const{Pool}=require('pg');this.pool=new Pool({connectionString:this.databaseUrl,ssl:this.databaseSslMode==='disable'?false:{rejectUnauthorized:false}});await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_integration_executions (
    execution_id UUID PRIMARY KEY,
    integration_id UUID NOT NULL,
    owner_user_id TEXT NOT NULL,
    request_id TEXT,
    status TEXT NOT NULL,
    http_status INTEGER,
    duration_ms INTEGER,
    error_code TEXT,
    response_preview TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);await this.pool.query('CREATE INDEX IF NOT EXISTS idx_integration_exec_owner_created ON panthorium_integration_executions(owner_user_id, created_at DESC)');await this.pool.query('CREATE INDEX IF NOT EXISTS idx_integration_exec_integration_created ON panthorium_integration_executions(integration_id, created_at DESC)');}
  normalize(row){if(!row)return null;return{executionId:row.execution_id,integrationId:row.integration_id,ownerUserId:row.owner_user_id,requestId:row.request_id||null,status:row.status,httpStatus:row.http_status==null?null:Number(row.http_status),durationMs:row.duration_ms==null?null:Number(row.duration_ms),errorCode:row.error_code||null,responsePreview:row.response_preview||null,createdAt:row.created_at};}
  async record({integrationId,ownerUserId,requestId,status,httpStatus,durationMs,errorCode,responsePreview}){const row={execution_id:randomUUID(),integration_id:integrationId,owner_user_id:ownerUserId,request_id:requestId||null,status:String(status||'unknown'),http_status:httpStatus==null?null:Number(httpStatus),duration_ms:durationMs==null?null:Number(durationMs),error_code:errorCode||null,response_preview:responsePreview?String(responsePreview).slice(0,1000):null,created_at:new Date().toISOString()};if(!this.pool){this.memory.set(row.execution_id,row);return this.normalize(row);}const r=await this.pool.query(`INSERT INTO panthorium_integration_executions(execution_id,integration_id,owner_user_id,request_id,status,http_status,duration_ms,error_code,response_preview) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[row.execution_id,row.integration_id,row.owner_user_id,row.request_id,row.status,row.http_status,row.duration_ms,row.error_code,row.response_preview]);return this.normalize(r.rows[0]);}
  async list(ownerUserId,{integrationId,limit=50}={}){const safe=Math.max(1,Math.min(Number(limit)||50,100));if(!this.pool){return[...this.memory.values()].filter(x=>x.owner_user_id===ownerUserId&&(!integrationId||x.integration_id===integrationId)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,safe).map(x=>this.normalize(x));}const values=[ownerUserId];let sql='SELECT * FROM panthorium_integration_executions WHERE owner_user_id=$1';if(integrationId){values.push(integrationId);sql+=` AND integration_id=$${values.length}`;}values.push(safe);sql+=` ORDER BY created_at DESC LIMIT $${values.length}`;const r=await this.pool.query(sql,values);return r.rows.map(x=>this.normalize(x));}
}
module.exports={IntegrationExecutionRepository};
