const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');

class AgentAutomationRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', requireDatabase = false } = {}) {
    this.requireDatabase = requireDatabase;
    this.pool = databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: false } }) : null;
    this.schedules = new Map();
    this.triggers = new Map();
  }

  ensureStorage() { if (this.requireDatabase && !this.pool) throw new Error('scheduler_database_required'); }

  async init() { this.ensureStorage();
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_agent_schedules (
        schedule_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        request TEXT NOT NULL,
        provider TEXT,
        every_minutes INTEGER NOT NULL,
        next_run_at TIMESTAMPTZ NOT NULL,
        max_runs INTEGER,
        run_count INTEGER NOT NULL DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_schedules_due ON panthorium_agent_schedules(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_schedules_user ON panthorium_agent_schedules(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS panthorium_agent_event_triggers (
        trigger_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        event_key TEXT NOT NULL,
        request TEXT NOT NULL,
        provider TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_panthorium_agent_triggers_event ON panthorium_agent_event_triggers(user_id, event_key, enabled);
    `);
  }

  normalizeSchedule(row = {}) {
    return { scheduleId: row.scheduleId || randomUUID(), userId: row.userId, userContext: row.userContext || {}, request: String(row.request || '').slice(0,8000), provider: row.provider || null, everyMinutes: Number(row.everyMinutes) || 60, nextRunAt: row.nextRunAt instanceof Date ? row.nextRunAt.toISOString() : String(row.nextRunAt || new Date().toISOString()), maxRuns: row.maxRuns == null ? null : Number(row.maxRuns), runCount: Number(row.runCount) || 0, enabled: row.enabled !== false, createdAt: row.createdAt || new Date().toISOString(), updatedAt: row.updatedAt || new Date().toISOString() };
  }
  normalizeTrigger(row = {}) {
    return { triggerId: row.triggerId || randomUUID(), userId: row.userId, userContext: row.userContext || {}, eventKey: String(row.eventKey || ''), request: String(row.request || '').slice(0,8000), provider: row.provider || null, enabled: row.enabled !== false, createdAt: row.createdAt || new Date().toISOString(), updatedAt: row.updatedAt || new Date().toISOString() };
  }

  async createSchedule(input) { this.ensureStorage();
    const item = this.normalizeSchedule(input);
    if (!this.pool) { this.schedules.set(item.scheduleId,item); return item; }
    const r = await this.pool.query(`INSERT INTO panthorium_agent_schedules(schedule_id,user_id,user_context,request,provider,every_minutes,next_run_at,max_runs,run_count,enabled,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING schedule_id AS "scheduleId",user_id AS "userId",user_context AS "userContext",request,provider,every_minutes AS "everyMinutes",next_run_at AS "nextRunAt",max_runs AS "maxRuns",run_count AS "runCount",enabled,created_at AS "createdAt",updated_at AS "updatedAt"`, [item.scheduleId,item.userId,JSON.stringify(item.userContext),item.request,item.provider,item.everyMinutes,item.nextRunAt,item.maxRuns,item.runCount,item.enabled,item.createdAt,item.updatedAt]);
    return this.normalizeSchedule(r.rows[0]);
  }

  async listSchedules(userId, limit = 30) { this.ensureStorage();
    const safe=Math.min(Math.max(Number(limit)||30,1),100);
    if (!this.pool) return [...this.schedules.values()].filter(x=>x.userId===userId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,safe);
    const r=await this.pool.query(`SELECT schedule_id AS "scheduleId",user_id AS "userId",user_context AS "userContext",request,provider,every_minutes AS "everyMinutes",next_run_at AS "nextRunAt",max_runs AS "maxRuns",run_count AS "runCount",enabled,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_schedules WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,[userId,safe]);
    return r.rows.map(x=>this.normalizeSchedule(x));
  }

  async disableSchedule(userId, scheduleId) { this.ensureStorage();
    if (!this.pool) { const x=this.schedules.get(scheduleId); if(!x||x.userId!==userId)return null; const n={...x,enabled:false,updatedAt:new Date().toISOString()}; this.schedules.set(scheduleId,n); return n; }
    const r=await this.pool.query(`UPDATE panthorium_agent_schedules SET enabled=FALSE,updated_at=NOW() WHERE schedule_id=$1 AND user_id=$2 RETURNING schedule_id AS "scheduleId",user_id AS "userId",user_context AS "userContext",request,provider,every_minutes AS "everyMinutes",next_run_at AS "nextRunAt",max_runs AS "maxRuns",run_count AS "runCount",enabled,created_at AS "createdAt",updated_at AS "updatedAt"`,[scheduleId,userId]);
    return r.rows[0] ? this.normalizeSchedule(r.rows[0]) : null;
  }

  async materializeDueJobs(jobs, limit = 10) { this.ensureStorage();
    const safe = Math.min(Math.max(Math.floor(Number(limit) || 10),1),50);
    const inputFor = schedule => ({
      jobId: `schedule:${schedule.scheduleId}:${schedule.runCount + 1}`,
      userId: schedule.userId, userContext: schedule.userContext, request: schedule.request,
      provider: schedule.provider, runAt: schedule.nextRunAt, status: 'scheduled',
      result: { source:'schedule', scheduleId:schedule.scheduleId, occurrence:schedule.runCount+1 }
    });
    if (!this.pool) {
      if (jobs?.pool || !(jobs?.memory instanceof Map)) throw new Error('automation_atomic_store_mismatch');
      // No await inside the memory transaction: concurrent ticks cannot observe half an occurrence.
      const due = [...this.schedules.values()].filter(x=>x.enabled && Date.parse(x.nextRunAt)<=Date.now())
        .sort((a,b)=>Date.parse(a.nextRunAt)-Date.parse(b.nextRunAt)).slice(0,safe);
      const made = [];
      for (const schedule of due) {
        const input = inputFor(schedule), previousJob = jobs.memory.get(input.jobId);
        if (previousJob && (previousJob.userId !== schedule.userId || previousJob.result?.scheduleId !== schedule.scheduleId || previousJob.result?.occurrence !== schedule.runCount+1)) throw new Error('automation_occurrence_conflict');
        const job = previousJob || jobs.normalize(input), count = schedule.runCount+1;
        const next = { ...schedule,runCount:count,enabled:schedule.maxRuns==null || count<schedule.maxRuns,
          nextRunAt:new Date(Date.parse(schedule.nextRunAt)+schedule.everyMinutes*60000).toISOString(),updatedAt:new Date().toISOString() };
        try { jobs.memory.set(job.jobId,job); this.schedules.set(schedule.scheduleId,next); }
        catch (error) {
          if (previousJob) jobs.memory.set(job.jobId,previousJob); else jobs.memory.delete(job.jobId);
          this.schedules.set(schedule.scheduleId,schedule); throw error;
        }
        made.push({...job});
      }
      return made;
    }
    if (jobs?.pool !== this.pool) throw new Error('automation_atomic_store_mismatch');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query(`SELECT schedule_id AS "scheduleId",user_id AS "userId",user_context AS "userContext",
        request,provider,every_minutes AS "everyMinutes",next_run_at AS "nextRunAt",max_runs AS "maxRuns",run_count AS "runCount",enabled
        FROM panthorium_agent_schedules WHERE enabled=TRUE AND next_run_at<=NOW()
        ORDER BY next_run_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,[safe]);
      const made = [];
      for (const row of due.rows) {
        const schedule = this.normalizeSchedule(row), input = inputFor(schedule);
        const inserted = await client.query(`INSERT INTO panthorium_agent_jobs
          (job_id,user_id,user_context,request,provider,run_at,status,result)
          VALUES($1,$2,$3::jsonb,$4,$5,$6,'scheduled',$7::jsonb) ON CONFLICT(job_id) DO NOTHING
          RETURNING job_id AS "jobId",user_id AS "userId",user_context AS "userContext",request,provider,run_at AS "runAt",status,result,attempts,created_at AS "createdAt",updated_at AS "updatedAt"`,
        [input.jobId,input.userId,JSON.stringify(input.userContext),input.request,input.provider,input.runAt,JSON.stringify(input.result)]);
        let job = inserted.rows[0];
        if (!job) {
          const existing = await client.query(`SELECT job_id AS "jobId",user_id AS "userId",user_context AS "userContext",request,provider,run_at AS "runAt",status,result,attempts,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_jobs WHERE job_id=$1`,[input.jobId]);
          job = existing.rows[0];
          if (!job || job.userId !== input.userId || job.result?.scheduleId !== schedule.scheduleId || job.result?.occurrence !== schedule.runCount+1) throw new Error('automation_occurrence_conflict');
        }
        await client.query(`UPDATE panthorium_agent_schedules SET run_count=run_count+1,
          next_run_at=next_run_at+(every_minutes*INTERVAL '1 minute'),
          enabled=CASE WHEN max_runs IS NULL THEN TRUE ELSE run_count+1<max_runs END,updated_at=NOW()
          WHERE schedule_id=$1`,[schedule.scheduleId]);
        made.push(jobs.mapRow(job));
      }
      await client.query('COMMIT');
      return made;
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    } finally { client.release(); }
  }

  async createTrigger(input) { this.ensureStorage();
    const item=this.normalizeTrigger(input);
    if(!this.pool){this.triggers.set(item.triggerId,item);return item;}
    const r=await this.pool.query(`INSERT INTO panthorium_agent_event_triggers(trigger_id,user_id,user_context,event_key,request,provider,enabled,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) RETURNING trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt"`,[item.triggerId,item.userId,JSON.stringify(item.userContext),item.eventKey,item.request,item.provider,item.enabled,item.createdAt,item.updatedAt]);
    return this.normalizeTrigger(r.rows[0]);
  }

  async listTriggers(userId, limit=30){ this.ensureStorage();const safe=Math.min(Math.max(Number(limit)||30,1),100);if(!this.pool)return[...this.triggers.values()].filter(x=>x.userId===userId).slice(0,safe);const r=await this.pool.query(`SELECT trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_event_triggers WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,[userId,safe]);return r.rows.map(x=>this.normalizeTrigger(x));}
  async disableTrigger(userId,triggerId){ this.ensureStorage();if(!this.pool){const x=this.triggers.get(triggerId);if(!x||x.userId!==userId)return null;const n={...x,enabled:false,updatedAt:new Date().toISOString()};this.triggers.set(triggerId,n);return n;}const r=await this.pool.query(`UPDATE panthorium_agent_event_triggers SET enabled=FALSE,updated_at=NOW() WHERE trigger_id=$1 AND user_id=$2 RETURNING trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt"`,[triggerId,userId]);return r.rows[0]?this.normalizeTrigger(r.rows[0]):null;}
  async matchingTriggers(userId,eventKey,limit=20){ this.ensureStorage();const safe=Math.min(Math.max(Number(limit)||20,1),50);if(!this.pool)return[...this.triggers.values()].filter(x=>x.userId===userId&&x.enabled&&x.eventKey===eventKey).slice(0,safe);const r=await this.pool.query(`SELECT trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_event_triggers WHERE user_id=$1 AND event_key=$2 AND enabled=TRUE ORDER BY created_at ASC LIMIT $3`,[userId,eventKey,safe]);return r.rows.map(x=>this.normalizeTrigger(x));}
}
module.exports={AgentAutomationRepository};
