const { Pool } = require('pg');

function clampHours(value){return Math.min(Math.max(Number(value)||24,1),168);}
function toNumber(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function statusRank(status){return status==='critical'?3:status==='degraded'?2:status==='warning'?1:0;}

class ProductionIntelligenceService {
  constructor({databaseUrl='',databaseSslMode='disable',audit,startedAt}={}){
    this.pool=databaseUrl?new Pool({connectionString:databaseUrl,ssl:databaseSslMode==='disable'?false:{rejectUnauthorized:false}}):null;
    this.audit=audit;
    this.startedAt=startedAt||Date.now();
  }

  async init(){
    if(!this.pool)return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_production_snapshots (
      snapshot_id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_production_snapshots_time ON panthorium_production_snapshots(created_at DESC)');
  }

  async databaseProbe(){
    if(!this.pool)return{ok:true,mode:'memory'};
    const started=Date.now();
    try{await this.pool.query('SELECT 1');return{ok:true,mode:'postgresql',latencyMs:Date.now()-started};}
    catch(error){return{ok:false,mode:'postgresql',latencyMs:Date.now()-started,error:'database_unavailable'};}
  }

  processMetrics(){
    const memory=process.memoryUsage();
    return{
      uptimeSeconds:Math.max(0,Math.floor(process.uptime())),
      rssBytes:memory.rss,
      heapUsedBytes:memory.heapUsed,
      heapTotalBytes:memory.heapTotal,
      externalBytes:memory.external,
      nodeVersion:process.version,
      pid:process.pid
    };
  }

  async aggregate(hours=24){
    const safeHours=clampHours(hours);
    if(!this.pool)return{hours:safeHours,mode:'memory',audit:{total:0,httpErrors:0,rateLimited:0},agents:{total:0,failed:0,running:0,waitingConfirmation:0},jobs:{total:0,failed:0,running:0,scheduled:0,overdue:0},integrations:{total:0,failed:0,remoteErrors:0},multiAgent:{total:0,failed:0,running:0,waitingConfirmation:0}};
    const [auditR,agentsR,jobsR,integrationsR,multiR]=await Promise.all([
      this.pool.query(`SELECT COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status >= 500)::bigint AS http_errors,
        COUNT(*) FILTER (WHERE status = 429)::bigint AS rate_limited
        FROM panthorium_audit_events WHERE time >= NOW() - ($1 * INTERVAL '1 hour')`,[safeHours]).catch(()=>({rows:[{}]})),
      this.pool.query(`SELECT COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status='failed')::bigint AS failed,
        COUNT(*) FILTER (WHERE status IN ('running','planned'))::bigint AS running,
        COUNT(*) FILTER (WHERE status='waiting_confirmation')::bigint AS waiting_confirmation
        FROM panthorium_agent_runs WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour')`,[safeHours]).catch(()=>({rows:[{}]})),
      this.pool.query(`SELECT COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status='failed')::bigint AS failed,
        COUNT(*) FILTER (WHERE status='running')::bigint AS running,
        COUNT(*) FILTER (WHERE status='scheduled')::bigint AS scheduled,
        COUNT(*) FILTER (WHERE status='scheduled' AND run_at < NOW() - INTERVAL '2 minutes')::bigint AS overdue
        FROM panthorium_agent_jobs WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour')`,[safeHours]).catch(()=>({rows:[{}]})),
      this.pool.query(`SELECT COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status='failed')::bigint AS failed,
        COUNT(*) FILTER (WHERE status='remote_error')::bigint AS remote_errors
        FROM panthorium_integration_executions WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour')`,[safeHours]).catch(()=>({rows:[{}]})),
      this.pool.query(`SELECT COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status='failed')::bigint AS failed,
        COUNT(*) FILTER (WHERE status='running')::bigint AS running,
        COUNT(*) FILTER (WHERE status='waiting_confirmation')::bigint AS waiting_confirmation
        FROM panthorium_multi_agent_runs WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour')`,[safeHours]).catch(()=>({rows:[{}]}))
    ]);
    const a=auditR.rows[0]||{},g=agentsR.rows[0]||{},j=jobsR.rows[0]||{},i=integrationsR.rows[0]||{},m=multiR.rows[0]||{};
    return{hours:safeHours,mode:'postgresql',audit:{total:toNumber(a.total),httpErrors:toNumber(a.http_errors),rateLimited:toNumber(a.rate_limited)},agents:{total:toNumber(g.total),failed:toNumber(g.failed),running:toNumber(g.running),waitingConfirmation:toNumber(g.waiting_confirmation)},jobs:{total:toNumber(j.total),failed:toNumber(j.failed),running:toNumber(j.running),scheduled:toNumber(j.scheduled),overdue:toNumber(j.overdue)},integrations:{total:toNumber(i.total),failed:toNumber(i.failed),remoteErrors:toNumber(i.remote_errors)},multiAgent:{total:toNumber(m.total),failed:toNumber(m.failed),running:toNumber(m.running),waitingConfirmation:toNumber(m.waiting_confirmation)}};
  }

  evaluate({database,process,aggregate}){
    const signals=[];
    if(!database.ok)signals.push({code:'DATABASE_UNAVAILABLE',status:'critical',message:'PostgreSQL probe failed'});
    if(aggregate.jobs.overdue>=20)signals.push({code:'AGENT_JOB_BACKLOG',status:'critical',message:`${aggregate.jobs.overdue} overdue Agent jobs`});
    else if(aggregate.jobs.overdue>=5)signals.push({code:'AGENT_JOB_BACKLOG',status:'degraded',message:`${aggregate.jobs.overdue} overdue Agent jobs`});
    const auditErrorRate=aggregate.audit.total?aggregate.audit.httpErrors/aggregate.audit.total:0;
    if(aggregate.audit.total>=20&&auditErrorRate>=0.15)signals.push({code:'HTTP_ERROR_RATE',status:'critical',message:`HTTP 5xx rate ${(auditErrorRate*100).toFixed(1)}%`});
    else if(aggregate.audit.total>=20&&auditErrorRate>=0.05)signals.push({code:'HTTP_ERROR_RATE',status:'degraded',message:`HTTP 5xx rate ${(auditErrorRate*100).toFixed(1)}%`});
    const agentFailureRate=aggregate.agents.total?aggregate.agents.failed/aggregate.agents.total:0;
    if(aggregate.agents.total>=10&&agentFailureRate>=0.3)signals.push({code:'AGENT_FAILURE_RATE',status:'degraded',message:`Agent failure rate ${(agentFailureRate*100).toFixed(1)}%`});
    const heapRatio=process.heapTotalBytes?process.heapUsedBytes/process.heapTotalBytes:0;
    if(heapRatio>=0.9)signals.push({code:'HEAP_PRESSURE',status:'critical',message:`Heap usage ${(heapRatio*100).toFixed(1)}%`});
    else if(heapRatio>=0.8)signals.push({code:'HEAP_PRESSURE',status:'degraded',message:`Heap usage ${(heapRatio*100).toFixed(1)}%`});
    if(aggregate.audit.rateLimited>=100)signals.push({code:'RATE_LIMIT_PRESSURE',status:'degraded',message:`${aggregate.audit.rateLimited} rate-limited requests`});
    const highest=signals.reduce((max,s)=>Math.max(max,statusRank(s.status)),0);
    const status=highest>=3?'critical':highest>=2?'degraded':highest>=1?'warning':'healthy';
    const score=Math.max(0,100-signals.reduce((sum,s)=>sum+(s.status==='critical'?35:s.status==='degraded'?18:8),0));
    const recommendations=[];
    if(aggregate.jobs.overdue>=5)recommendations.push('Increase Agent worker capacity or reduce scheduled-job concurrency pressure.');
    if(auditErrorRate>=0.05)recommendations.push('Inspect recent 5xx audit events and upstream provider/database latency before scaling traffic.');
    if(heapRatio>=0.8)recommendations.push('Reduce per-process concurrency or increase memory allocation before adding workload.');
    if(!recommendations.length)recommendations.push('No immediate capacity intervention is indicated by current signals.');
    return{status,score,signals,recommendations,errorRates:{http5xx:auditErrorRate,agentFailures:agentFailureRate},heapRatio};
  }

  async overview(hours=24,{persist=false}={}){
    const [database,aggregate]=await Promise.all([this.databaseProbe(),this.aggregate(hours)]);
    const process=this.processMetrics();
    const evaluation=this.evaluate({database,process,aggregate});
    const result={ok:evaluation.status!=='critical',generatedAt:new Date().toISOString(),status:evaluation.status,score:evaluation.score,database,process,aggregate,signals:evaluation.signals,recommendations:evaluation.recommendations,errorRates:evaluation.errorRates,heapRatio:evaluation.heapRatio};
    if(persist&&this.pool){try{await this.pool.query('INSERT INTO panthorium_production_snapshots(status,score,metrics) VALUES($1,$2,$3::jsonb)',[result.status,result.score,JSON.stringify(result)]);}catch(error){this.audit?.record('production.snapshot_failed',{error:error.message});}}
    return result;
  }

  async readiness(){
    const database=await this.databaseProbe();
    return{ok:database.ok,status:database.ok?'ready':'not_ready',uptimeSeconds:Math.max(0,Math.floor(process.uptime())),database};
  }
}

module.exports={ProductionIntelligenceService,clampHours};