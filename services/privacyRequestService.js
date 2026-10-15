'use strict';
const { randomUUID } = require('crypto');
const { getDatabasePool } = require('./databasePool');

const KINDS = new Set(['account_deletion','ai_output_report']);
const STATUSES = new Set(['requested','manual_processing','completed']);
const CATEGORIES = new Set(['inaccurate','harmful','privacy','other']);
const SOURCES = new Set(['cloud_app_run','action','general']);
const ID = /^[A-Za-z0-9:_-]{1,180}$/;
const COLUMNS = `id,user_id AS "userId",kind,status,source_type AS "sourceType",source_id AS "sourceId",category,details,resolution,processed_by AS "processedBy",created_at AS "createdAt",updated_at AS "updatedAt",completed_at AS "completedAt"`;
function failure(code,status=400) { const error=new Error(code); error.code=code; error.status=status; return error; }
function text(value,max,code,{ required=false }={}) {
  if (value===undefined) { if (required) throw failure(code); return ''; }
  if (typeof value!=='string' || value.length>max || /[\u0000]/.test(value) || (required && !value.trim())) throw failure(code);
  return value.trim();
}
function date(value) { return value == null ? null : new Date(value).toISOString(); }

// This is a durable internal request queue, never an account-erasure engine.
// It does not copy the source prompt, transcript, run output or tool arguments.
class PrivacyRequestService {
  constructor({ databaseUrl='',databaseSslMode='disable',pool,required=false,cloudApps,agentService,audit,clock=Date.now }={}) {
    this.pool=pool || (databaseUrl ? getDatabasePool({ connectionString:databaseUrl,ssl:databaseSslMode==='disable' ? false : { rejectUnauthorized:true } }) : null);
    this.required=required===true; this.cloudApps=cloudApps || null; this.agentService=agentService || null; this.audit=audit || null; this.clock=clock; this.ready=false;
  }
  async init() {
    this.ready=false;
    if (!this.pool) { if (this.required) throw failure('privacy_requests_database_required',503); return; }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_privacy_requests (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('account_deletion','ai_output_report')),
      status TEXT NOT NULL CHECK(status IN ('requested','manual_processing','completed')),
      source_type TEXT,source_id TEXT,category TEXT,details TEXT NOT NULL DEFAULT '',
      open_key TEXT UNIQUE,resolution TEXT NOT NULL DEFAULT '',processed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,completed_at TIMESTAMPTZ);
      CREATE INDEX IF NOT EXISTS idx_privacy_requests_owner ON panthorium_privacy_requests(user_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_privacy_requests_queue ON panthorium_privacy_requests(status,created_at);
      CREATE TABLE IF NOT EXISTS panthorium_privacy_request_events (
      id TEXT PRIMARY KEY,request_id TEXT NOT NULL,actor_id TEXT NOT NULL,
      previous_status TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL);`);
    this.ready=true;
  }
  available() { return this.ready && !!this.pool; }
  requireReady() { if (!this.available()) throw failure('privacy_requests_unavailable',503); }
  owner(user) {
    const id=user?.sub;
    if (typeof id!=='string' || !ID.test(id) || /^guest[:_-]/i.test(id) || user?.isGuest===true || (user?.roles || []).includes('guest')) throw failure('privacy_requests_account_required',403);
    return id;
  }
  operator(user) {
    const id=this.owner(user);
    if (!Array.isArray(user.roles) || !user.roles.some(role=>['operator','administrator'].includes(role))) throw failure('privacy_requests_operator_required',403);
    return id;
  }
  publicRequest(row,{ operator=false }={}) {
    if (!row) return null;
    return { id:row.id,kind:row.kind,status:row.status,sourceType:row.sourceType || null,sourceId:row.sourceId || null,category:row.category || null,details:row.details,resolution:row.resolution || '',createdAt:date(row.createdAt),updatedAt:date(row.updatedAt),completedAt:date(row.completedAt),...(operator ? { userId:row.userId,processedBy:row.processedBy || null } : {}) };
  }
  deletionResult(row,created=false) {
    return { ok:true,created,request:this.publicRequest(row),manualProcessing:true,automaticErasure:false };
  }
  async accountDeletion({ user,confirmation,reason }={}) {
    const userId=this.owner(user); this.requireReady();
    if (confirmation!=='DELETE_REQUEST') throw failure('privacy_requests_confirmation_required');
    const details=text(reason,500,'privacy_requests_invalid_reason');
    const id=randomUUID(); const now=new Date(this.clock()).toISOString();
    // UNIQUE open_key is the cross-replica idempotency boundary. It is cleared
    // only when an authorized operator completes the manual request workflow.
    const key='account_deletion:'+userId;
    await this.pool.query(`INSERT INTO panthorium_privacy_requests(id,user_id,kind,status,details,open_key,created_at,updated_at)
      VALUES($1,$2,'account_deletion','requested',$3,$4,$5,$5) ON CONFLICT(open_key) DO NOTHING`,[id,userId,details,key,now]);
    const out=await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_privacy_requests WHERE user_id=$1 AND open_key=$2`,[userId,key]);
    if (!out.rows[0]) throw failure('privacy_requests_unavailable',503);
    const created=out.rows[0].id===id;
    if (created) this.audit?.record('privacy.account_deletion_requested',{ userId,requestId:id });
    return this.deletionResult(out.rows[0],created);
  }
  async deletionStatus({user}={}) {
    const userId=this.owner(user); this.requireReady();
    const out=await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_privacy_requests WHERE user_id=$1 AND kind='account_deletion' ORDER BY created_at DESC,id DESC LIMIT 1`,[userId]);
    return this.deletionResult(out.rows[0]);
  }
  async verifySource(user,sourceType,sourceId) {
    const userId=this.owner(user);
    if (sourceType==='general') {
      if (sourceId!==undefined && sourceId!==null && sourceId!=='') throw failure('privacy_requests_invalid_source');
      return null;
    }
    if (typeof sourceId!=='string' || !ID.test(sourceId)) throw failure('privacy_requests_invalid_source');
    try {
      if (sourceType==='cloud_app_run') {
        if (!this.cloudApps?.get) throw failure('privacy_requests_source_unavailable',503);
        // CloudAppRuntime.get enforces the account boundary before returning a
        // public run; do not query a source from an untrusted userId in a body.
        const run=await this.cloudApps.get({ user,runId:sourceId });
        if (!run || run.id!==sourceId || (run.userId!==undefined && run.userId!==userId)) throw failure('privacy_requests_source_not_found',404);
      } else {
        if (!this.agentService?.getAction) throw failure('privacy_requests_source_unavailable',503);
        const result=await this.agentService.getAction({ user,actionId:sourceId });
        if (result?.error==='action_ledger_unavailable') throw failure('privacy_requests_source_unavailable',503);
        if (!result?.ok || result.action?.actionId!==sourceId || result.action?.userId!==userId) throw failure('privacy_requests_source_not_found',404);
      }
    } catch(error) {
      if (/^privacy_requests_/.test(error.code || error.message || '')) throw error;
      if (error.status===404 || ['cloud_apps_run_not_found','action_not_found'].includes(error.code || error.message)) throw failure('privacy_requests_source_not_found',404);
      throw failure('privacy_requests_source_unavailable',503);
    }
    return sourceId;
  }
  async report({user,sourceType='general',sourceId,category,details}={}) {
    const userId=this.owner(user); this.requireReady();
    if (!SOURCES.has(sourceType)) throw failure('privacy_requests_invalid_source');
    if (!CATEGORIES.has(category)) throw failure('privacy_requests_invalid_category');
    const safeDetails=text(details,2000,'privacy_requests_invalid_details',{ required:sourceType==='general' });
    const safeSource=await this.verifySource(user,sourceType,sourceId);
    const id=randomUUID(); const now=new Date(this.clock()).toISOString();
    const out=await this.pool.query(`INSERT INTO panthorium_privacy_requests(id,user_id,kind,status,source_type,source_id,category,details,created_at,updated_at)
      VALUES($1,$2,'ai_output_report','requested',$3,$4,$5,$6,$7,$7) RETURNING ${COLUMNS}`,[id,userId,sourceType,safeSource,category,safeDetails,now]);
    this.audit?.record('privacy.ai_output_reported',{ userId,requestId:id,sourceType,sourceId:safeSource,category });
    return { ok:true,request:this.publicRequest(out.rows[0]),manualProcessing:true,automaticErasure:false };
  }
  async list({user,limit=30}={}) {
    const userId=this.owner(user); this.requireReady();
    const safeLimit=Math.max(1,Math.min(100,Math.floor(Number(limit)||30)));
    const out=await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_privacy_requests WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,[userId,safeLimit]);
    return { ok:true,requests:out.rows.map(row=>this.publicRequest(row)),manualProcessing:true,automaticErasure:false };
  }
  async operatorList({user,kind,status,limit=50}={}) {
    this.operator(user); this.requireReady();
    if (kind!==undefined && !KINDS.has(kind)) throw failure('privacy_requests_invalid_kind');
    if (status!==undefined && !STATUSES.has(status)) throw failure('privacy_requests_invalid_status');
    const parameters=[]; const conditions=[];
    if (kind!==undefined) { parameters.push(kind); conditions.push('kind=$'+parameters.length); }
    if (status!==undefined) { parameters.push(status); conditions.push('status=$'+parameters.length); }
    parameters.push(Math.max(1,Math.min(100,Math.floor(Number(limit)||50))));
    const out=await this.pool.query(`SELECT ${COLUMNS} FROM panthorium_privacy_requests${conditions.length ? ' WHERE '+conditions.join(' AND ') : ''} ORDER BY created_at ASC,id ASC LIMIT $${parameters.length}`,parameters);
    return { ok:true,requests:out.rows.map(row=>this.publicRequest(row,{operator:true})),manualProcessing:true,automaticErasure:false };
  }
  async updateStatus({user,requestId,status,resolution}={}) {
    const actorId=this.operator(user); this.requireReady();
    if (typeof requestId!=='string' || !ID.test(requestId)) throw failure('privacy_requests_invalid_id');
    if (!['manual_processing','completed'].includes(status)) throw failure('privacy_requests_invalid_status');
    const safeResolution=text(resolution,1000,'privacy_requests_resolution_required',{required:status==='completed'});
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result=await client.query(`SELECT ${COLUMNS} FROM panthorium_privacy_requests WHERE id=$1 FOR UPDATE`,[requestId]);
      const current=result.rows[0];
      if (!current) throw failure('privacy_requests_not_found',404);
      if (current.status===status && (current.resolution || '')===safeResolution) {
        await client.query('COMMIT');
        return { ok:true,request:this.publicRequest(current,{operator:true}),manualProcessing:true,automaticErasure:false };
      }
      if (!((current.status==='requested' && status==='manual_processing') || (current.status==='manual_processing' && status==='completed'))) throw failure('privacy_requests_status_conflict',409);
      const now=new Date(this.clock()).toISOString();
      const next=await client.query(`UPDATE panthorium_privacy_requests SET status=$2,resolution=$3,processed_by=$4,updated_at=$5,completed_at=$6,open_key=$7
        WHERE id=$1 AND status=$8 RETURNING ${COLUMNS}`,[requestId,status,safeResolution,actorId,now,status==='completed' ? now : null,status==='completed' ? null : current.kind==='account_deletion' ? 'account_deletion:'+current.userId : null,current.status]);
      if (!next.rows[0]) throw failure('privacy_requests_status_conflict',409);
      await client.query('INSERT INTO panthorium_privacy_request_events(id,request_id,actor_id,previous_status,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),requestId,actorId,current.status,status,now]);
      await client.query('COMMIT');
      this.audit?.record('privacy.request_status_updated',{ actorId,requestId,previousStatus:current.status,status });
      return { ok:true,request:this.publicRequest(next.rows[0],{operator:true}),manualProcessing:true,automaticErasure:false };
    } catch(error) { try { await client.query('ROLLBACK'); } catch(_) {} throw error; }
    finally { client.release(); }
  }
}
module.exports = { PrivacyRequestService };
