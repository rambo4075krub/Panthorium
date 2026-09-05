'use strict';

const { randomUUID } = require('crypto');

function clampScore(value){const n=Math.round(Number(value));return Number.isFinite(n)?Math.max(0,Math.min(100,n)):0;}
function clean(value,max=12000){return String(value==null?'':value).trim().slice(0,max);}
function parseJudge(text){const raw=String(text||'').replace(/```(?:json)?/gi,'').replace(/```/g,'');const match=raw.match(/\{[\s\S]*\}/);if(!match)return null;try{const d=JSON.parse(match[0]);return{score:clampScore(d.score),correctness:clampScore(d.correctness),groundedness:clampScore(d.groundedness),safety:clampScore(d.safety),relevance:clampScore(d.relevance),clarity:clampScore(d.clarity),reason:clean(d.reason,600)};}catch(_){return null;}}
function avg(items,key){if(!items.length)return 0;return Math.round(items.reduce((s,x)=>s+Number(x[key]||0),0)/items.length);}
function summarize(result){const leader=result?.leaderboard?.[0]||null;const sentinel=(result?.leaderboard||[]).find(x=>x.name==='Sentinel AI')||null;const sentinelRank=sentinel?((result.leaderboard||[]).findIndex(x=>x.name==='Sentinel AI')+1):null;return{winner:leader?.name||null,winnerScore:leader?.score||0,sentinelScore:sentinel?.score||0,sentinelRank,caseCount:(result?.cases||[]).length,providerCount:(result?.providers||[]).length,passed:Boolean(sentinel&&sentinelRank===1&&Number(sentinel.score||0)>=85)};}

class SentinelBenchmarkService{
  constructor({core,providers,audit,databaseUrl,databaseSslMode}={}){this.core=core;this.providers=providers;this.audit=audit;this.lastRun=null;this.historyCache=[];if(databaseUrl){const{Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:databaseSslMode==='disable'?false:{rejectUnauthorized:false}});}else this.pool=null;}
  async init(){if(!this.pool)return;await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_benchmark_runs(
    run_id UUID PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    providers JSONB NOT NULL DEFAULT '[]'::jsonb,
    case_count INTEGER NOT NULL DEFAULT 0,
    winner TEXT,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    leaderboard JSONB NOT NULL DEFAULT '[]'::jsonb,
    cases JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_panthorium_benchmark_created ON panthorium_benchmark_runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_panthorium_benchmark_winner ON panthorium_benchmark_runs(winner);`);this.historyCache=await this.history({limit:10});this.lastRun=this.historyCache[0]?.result||null;}
  async evaluateAnswer({prompt,answer,subjectProvider,reference}){
    const available=this.providers.available();
    const judges=[...available.filter(p=>p!==subjectProvider),...available.filter(p=>p===subjectProvider)].slice(0,Math.min(2,available.length));
    if(!judges.length)return{score:0,judges:[],error:'no_evaluator_provider'};
    const system='คุณเป็นกรรมการ Benchmark Arena ให้ตอบ JSON เท่านั้น {"score":0,"correctness":0,"groundedness":0,"safety":0,"relevance":0,"clarity":0,"reason":"..."} ให้คะแนน 0-100 แบบเข้มงวด ห้ามให้คะแนนตามชื่อค่ายหรือชื่อโมเดล';
    const payload=`โจทย์:\n${clean(prompt,6000)}\n\nคำตอบ:\n${clean(answer)}\n\nคำตอบอ้างอิง/เกณฑ์ (ถ้ามี):\n${clean(reference||'',6000)}`;
    const settled=await Promise.allSettled(judges.map(async provider=>{const r=await this.providers.callDetailed(provider,system,[{role:'user',content:payload}]);const parsed=parseJudge(r?.text);if(!parsed)throw new Error('invalid_benchmark_judge');return{provider,model:r.model||null,...parsed};}));
    const verdicts=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);const failures=settled.map((x,i)=>x.status==='rejected'?{provider:judges[i],error:x.reason?.message||'judge_failed'}:null).filter(Boolean);
    if(verdicts.length!==judges.length)return{score:verdicts.length?avg(verdicts,'score'):0,correctness:avg(verdicts,'correctness'),groundedness:avg(verdicts,'groundedness'),safety:avg(verdicts,'safety'),relevance:avg(verdicts,'relevance'),clarity:avg(verdicts,'clarity'),judges:verdicts,failures,error:'incomplete_evaluation'};
    return{score:avg(verdicts,'score'),correctness:avg(verdicts,'correctness'),groundedness:avg(verdicts,'groundedness'),safety:avg(verdicts,'safety'),relevance:avg(verdicts,'relevance'),clarity:avg(verdicts,'clarity'),judges:verdicts,failures};
  }
  async saveRun(result,userId='system'){
    const summary=summarize(result);result.summary=summary;
    if(this.pool){await this.pool.query(`INSERT INTO panthorium_benchmark_runs(run_id,started_at,duration_ms,created_by,providers,case_count,winner,summary,leaderboard,cases)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,[result.runId,result.startedAt,result.durationMs||0,userId,JSON.stringify(result.providers||[]),(result.cases||[]).length,summary.winner,JSON.stringify(summary),JSON.stringify(result.leaderboard||[]),JSON.stringify(result.cases||[])]);}
    this.lastRun=result;this.historyCache=[{runId:result.runId,startedAt:result.startedAt,durationMs:result.durationMs,createdBy:userId,providers:result.providers||[],caseCount:(result.cases||[]).length,winner:summary.winner,summary,result},...this.historyCache.filter(x=>x.runId!==result.runId)].slice(0,10);return result;
  }
  async history({limit=10}={}){const n=Math.max(1,Math.min(Number(limit)||10,50));if(this.pool){const q=await this.pool.query(`SELECT * FROM panthorium_benchmark_runs ORDER BY created_at DESC LIMIT $1`,[n]);return q.rows.map(row=>({runId:row.run_id,startedAt:row.started_at instanceof Date?row.started_at.toISOString():row.started_at,durationMs:Number(row.duration_ms||0),createdBy:row.created_by||null,providers:row.providers||[],caseCount:Number(row.case_count||0),winner:row.winner||null,summary:row.summary||{},result:{ok:true,runId:row.run_id,startedAt:row.started_at instanceof Date?row.started_at.toISOString():row.started_at,durationMs:Number(row.duration_ms||0),providers:row.providers||[],leaderboard:row.leaderboard||[],cases:row.cases||[],summary:row.summary||{}}}));}return this.historyCache.slice(0,n);}
  async run({cases=[],providerNames,userId='system'}={}){
    const suite=Array.isArray(cases)?cases.slice(0,20):[];if(!suite.length)return{ok:false,error:'benchmark_cases_required'};
    const available=this.providers.available();const requested=Array.isArray(providerNames)?providerNames.map(x=>String(x).toLowerCase()):available;const opponents=[...new Set(requested)].filter(x=>available.includes(x)).slice(0,4);
    const rows=[];const started=Date.now();
    for(let i=0;i<suite.length;i++){
      const item=suite[i]||{};const prompt=clean(item.prompt,6000);if(!prompt)continue;const reference=clean(item.reference||'',6000);const competitors=[];
      const sentinelStart=Date.now();const trainingContext=this.core.training?await this.core.training.contextFor(prompt):'';const sentinel=await this.core.gateway.complete({systemPrompt:this.core.prompts.build('default')+trainingContext,history:[{role:'user',content:prompt}],userId:`benchmark:${userId}`,sessionId:`arena-${Date.now()}-${i}`});const sentinelLatency=Date.now()-sentinelStart;
      if(sentinel?.ok&&sentinel.text){const verdict=await this.evaluateAnswer({prompt,answer:sentinel.text,subjectProvider:'sentinel',reference});competitors.push({name:'Sentinel AI',provider:'sentinel',model:sentinel.model||null,latencyMs:sentinelLatency,usage:sentinel.usage||null,answer:sentinel.text,...verdict});}
      for(const provider of opponents){const t=Date.now();try{const r=await this.providers.callDetailed(provider,'ตอบคำถามให้ถูกต้อง ชัดเจน ปลอดภัย และอย่าอ้างสิ่งที่ไม่รู้',[{role:'user',content:prompt}]);const verdict=await this.evaluateAnswer({prompt,answer:r.text,subjectProvider:provider,reference});competitors.push({name:provider,provider,model:r.model||null,latencyMs:Date.now()-t,usage:r.usage||null,answer:r.text,...verdict});}catch(error){competitors.push({name:provider,provider,error:error.message,score:0,latencyMs:Date.now()-t});}}
      competitors.sort((a,b)=>(b.score||0)-(a.score||0)||(a.latencyMs||Infinity)-(b.latencyMs||Infinity));rows.push({caseId:item.id||`case-${i+1}`,prompt,reference,competitors,winner:competitors[0]?.name||null});
    }
    const names=[...new Set(rows.flatMap(r=>r.competitors.map(c=>c.name)))];const leaderboard=names.map(name=>{const list=rows.map(r=>r.competitors.find(c=>c.name===name)).filter(Boolean);return{name,cases:list.length,score:avg(list,'score'),correctness:avg(list,'correctness'),groundedness:avg(list,'groundedness'),safety:avg(list,'safety'),relevance:avg(list,'relevance'),clarity:avg(list,'clarity'),latencyMs:avg(list,'latencyMs'),wins:rows.filter(r=>r.winner===name).length};}).sort((a,b)=>b.score-a.score||b.wins-a.wins||a.latencyMs-b.latencyMs);
    const result={ok:true,runId:randomUUID(),startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,cases:rows,leaderboard,providers:opponents};await this.saveRun(result,userId);this.audit?.record('sentinel.benchmark_completed',{runId:result.runId,caseCount:rows.length,providers:opponents,winner:leaderboard[0]?.name||null,durationMs:result.durationMs,summary:result.summary});return result;
  }
  status(){return{ok:true,availableProviders:this.providers.available(),lastRun:this.lastRun,history:this.historyCache.map(x=>({runId:x.runId,startedAt:x.startedAt,durationMs:x.durationMs,createdBy:x.createdBy,providers:x.providers,caseCount:x.caseCount,winner:x.winner,summary:x.summary}))};}
}
module.exports={SentinelBenchmarkService,parseJudge,summarize};
