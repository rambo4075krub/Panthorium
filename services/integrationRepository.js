const { randomUUID } = require('crypto');

class IntegrationRepository {
  constructor({ databaseUrl, databaseSslMode } = {}) { this.databaseUrl=databaseUrl;this.databaseSslMode=databaseSslMode;this.pool=null;this.memory=new Map(); }
  async init(){if(!this.databaseUrl)return;const{Pool}=require('pg');this.pool=new Pool({connectionString:this.databaseUrl,ssl:this.databaseSslMode==='disable'?false:{rejectUnauthorized:false}});await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_integrations (
    integration_id UUID PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    secret_env_key TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);await this.pool.query('CREATE INDEX IF NOT EXISTS idx_integrations_owner_updated ON panthorium_integrations(owner_user_id, updated_at DESC)');}
  normalize(row){if(!row)return null;return{integrationId:row.integration_id,ownerUserId:row.owner_user_id,name:row.name,kind:row.kind,endpointUrl:row.endpoint_url,secretEnvKey:row.secret_env_key||null,enabled:row.enabled!==false,createdAt:row.created_at,updatedAt:row.updated_at};}
  async create({ownerUserId,name,kind,endpointUrl,secretEnvKey}){const row={integration_id:randomUUID(),owner_user_id:ownerUserId,name,kind,endpoint_url:endpointUrl,secret_env_key:secretEnvKey||null,enabled:true,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};if(!this.pool){this.memory.set(row.integration_id,row);return this.normalize(row);}const r=await this.pool.query('INSERT INTO panthorium_integrations(integration_id,owner_user_id,name,kind,endpoint_url,secret_env_key,enabled) VALUES($1,$2,$3,$4,$5,$6,TRUE) RETURNING *',[row.integration_id,row.owner_user_id,row.name,row.kind,row.endpoint_url,row.secret_env_key]);return this.normalize(r.rows[0]);}
  async list(ownerUserId,limit=50){const safe=Math.max(1,Math.min(Number(limit)||50,100));if(!this.pool)return[...this.memory.values()].filter(x=>x.owner_user_id===ownerUserId).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,safe).map(x=>this.normalize(x));const r=await this.pool.query('SELECT * FROM panthorium_integrations WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT $2',[ownerUserId,safe]);return r.rows.map(x=>this.normalize(x));}
  async get(ownerUserId,integrationId){if(!this.pool){const row=this.memory.get(integrationId);return row?.owner_user_id===ownerUserId?this.normalize(row):null;}const r=await this.pool.query('SELECT * FROM panthorium_integrations WHERE owner_user_id=$1 AND integration_id=$2',[ownerUserId,integrationId]);return this.normalize(r.rows[0]);}
  async setEnabled(ownerUserId,integrationId,enabled){if(!this.pool){const row=this.memory.get(integrationId);if(!row||row.owner_user_id!==ownerUserId)return null;row.enabled=!!enabled;row.updated_at=new Date().toISOString();return this.normalize(row);}const r=await this.pool.query('UPDATE panthorium_integrations SET enabled=$3,updated_at=NOW() WHERE owner_user_id=$1 AND integration_id=$2 RETURNING *',[ownerUserId,integrationId,!!enabled]);return this.normalize(r.rows[0]);}
  async remove(ownerUserId,integrationId){if(!this.pool){const row=this.memory.get(integrationId);if(!row||row.owner_user_id!==ownerUserId)return false;this.memory.delete(integrationId);return true;}const r=await this.pool.query('DELETE FROM panthorium_integrations WHERE owner_user_id=$1 AND integration_id=$2',[ownerUserId,integrationId]);return r.rowCount>0;}
}
module.exports={IntegrationRepository};
