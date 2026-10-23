const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');
const { AgentAutomationPolicyService } = require('./agentAutomationPolicyService');

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

  effectiveMaxRuns(schedule) {
    // Old rows used NULL to mean unlimited. Apply the same finite tier default
    // before creating an occurrence, including rows already past that limit.
    const limits = new AgentAutomationPolicyService().profile({ ...schedule.userContext, sub: schedule.userId });
    const fallback = limits.maxRuns || 100;
    const configured = Number(schedule.maxRuns);
    return schedule.maxRuns != null && Number.isInteger(configured) && configured > 0
      ? Math.min(configured, 1000) : fallback;
  }

  // Reserve against every active row, not a paginated UI list. The per-user
  // transaction lock also serializes creation across Cloud Run instances.
  async reserveActive(kind, userId, maxActive, insert) {
    if (!['schedule','trigger'].includes(kind) || !userId || !Number.isInteger(maxActive) || maxActive < 1 || maxActive > 100) throw new Error('automation_invalid_limit');
    const denied = () => { throw new Error(`automation_${kind}_limit_reached`); };
    if (!this.pool) {
      const records = kind === 'schedule' ? this.schedules : this.triggers;
      const count = [...records.values()].filter(item => item.userId === userId && item.enabled !== false).length;
      if (count >= maxActive) return denied();
      // insert mutates the Map synchronously before it returns a Promise.
      // There is no await between counting and insertion in this path.
      return insert(null);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`automation:${kind}:${userId}`]);
      const table = kind === 'schedule' ? 'panthorium_agent_schedules' : 'panthorium_agent_event_triggers';
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id=$1 AND enabled=TRUE`, [userId]);
      if (Number(result.rows[0].count) >= maxActive) denied();
      const item = await insert(client);
      await client.query('COMMIT');
      return item;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async createSchedule(input, { maxActive = 100 } = {}) { this.ensureStorage();
    const item = this.normalizeSchedule(input);
    return this.reserveActive('schedule', item.userId, maxActive, async client => {
    if (!client) { this.schedules.set(item.scheduleId,item); return item; }
    const r = await client.query(`INSERT INTO panthorium_agent_schedules(schedule_id,user_id,user_context,request,provider,every_minutes,next_run_at,max_runs,run_count,enabled,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING schedule_id AS "scheduleId",user_id AS "userId",user_context AS "userContext",request,provider,every_minutes AS "everyMinutes",next_run_at AS "nextRunAt",max_runs AS "maxRuns",run_count AS "runCount",enabled,created_at AS "createdAt",updated_at AS "updatedAt"`, [item.scheduleId,item.userId,JSON.stringify(item.userContext),item.request,item.provider,item.everyMinutes,item.nextRunAt,item.maxRuns,item.runCount,item.enabled,item.createdAt,item.updatedAt]);
    return this.normalizeSchedule(r.rows[0]);
    });
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
        const maxRuns = this.effectiveMaxRuns(schedule);
        if (schedule.runCount >= maxRuns) {
          this.schedules.set(schedule.scheduleId, { ...schedule, maxRuns, enabled:false, updatedAt:new Date().toISOString() });
          continue;
        }
        const input = inputFor(schedule), previousJob = jobs.memory.get(input.jobId);
        if (previousJob && (previousJob.userId !== schedule.userId || previousJob.result?.scheduleId !== schedule.scheduleId || previousJob.result?.occurrence !== schedule.runCount+1)) throw new Error('automation_occurrence_conflict');
        const job = previousJob || jobs.normalize(input), count = schedule.runCount+1;
        const next = { ...schedule,maxRuns,runCount:count,enabled:count<maxRuns,
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
        const schedule = this.normalizeSchedule(row), maxRuns = this.effectiveMaxRuns(schedule);
        if (schedule.runCount >= maxRuns) {
          await client.query('UPDATE panthorium_agent_schedules SET max_runs=$2,enabled=FALSE,updated_at=NOW() WHERE schedule_id=$1',[schedule.scheduleId,maxRuns]);
          continue;
        }
        const input = inputFor(schedule);
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
          max_runs=$2,enabled=run_count+1<$2,updated_at=NOW()
          WHERE schedule_id=$1`,[schedule.scheduleId,maxRuns]);
        made.push(jobs.mapRow(job));
      }
      await client.query('COMMIT');
      return made;
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    } finally { client.release(); }
  }

  async createTrigger(input, { maxActive = 100 } = {}) { this.ensureStorage();
    const item=this.normalizeTrigger(input);
    return this.reserveActive('trigger', item.userId, maxActive, async client => {
    if(!client){this.triggers.set(item.triggerId,item);return item;}
    const r=await client.query(`INSERT INTO panthorium_agent_event_triggers(trigger_id,user_id,user_context,event_key,request,provider,enabled,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) RETURNING trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt"`,[item.triggerId,item.userId,JSON.stringify(item.userContext),item.eventKey,item.request,item.provider,item.enabled,item.createdAt,item.updatedAt]);
    return this.normalizeTrigger(r.rows[0]);
    });
  }

  async listTriggers(userId, limit=30){ this.ensureStorage();const safe=Math.min(Math.max(Number(limit)||30,1),100);if(!this.pool)return[...this.triggers.values()].filter(x=>x.userId===userId).slice(0,safe);const r=await this.pool.query(`SELECT trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_event_triggers WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,[userId,safe]);return r.rows.map(x=>this.normalizeTrigger(x));}
  async disableTrigger(userId,triggerId){ this.ensureStorage();if(!this.pool){const x=this.triggers.get(triggerId);if(!x||x.userId!==userId)return null;const n={...x,enabled:false,updatedAt:new Date().toISOString()};this.triggers.set(triggerId,n);return n;}const r=await this.pool.query(`UPDATE panthorium_agent_event_triggers SET enabled=FALSE,updated_at=NOW() WHERE trigger_id=$1 AND user_id=$2 RETURNING trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt"`,[triggerId,userId]);return r.rows[0]?this.normalizeTrigger(r.rows[0]):null;}
  async matchingTriggers(userId,eventKey,limit=20){ this.ensureStorage();const safe=Math.min(Math.max(Number(limit)||20,1),50);if(!this.pool)return[...this.triggers.values()].filter(x=>x.userId===userId&&x.enabled&&x.eventKey===eventKey).slice(0,safe);const r=await this.pool.query(`SELECT trigger_id AS "triggerId",user_id AS "userId",user_context AS "userContext",event_key AS "eventKey",request,provider,enabled,created_at AS "createdAt",updated_at AS "updatedAt" FROM panthorium_agent_event_triggers WHERE user_id=$1 AND event_key=$2 AND enabled=TRUE ORDER BY created_at ASC LIMIT $3`,[userId,eventKey,safe]);return r.rows.map(x=>this.normalizeTrigger(x));}
}
module.exports={AgentAutomationRepository};
