'use strict';
const {
  fail,
  id,
  text,
  normalize,
  validateAnswers,
  responsesCsv,
  randomUUID
} = require('./onlineToolModel');

const PUBLIC_KINDS = ['form', 'design', 'page'];
const LIST_COLUMNS = 'p.id,p.kind,p.title,p.revision,p.updated_at,(p.owner_id=$1) AS owner';
class OnlineToolsService {
  constructor(pool, notifications) {
    this.pool = pool;
    this.notifications = notifications;
    this.flushing = false;
  }
  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_tool_projects(
        id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES panthorium_users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, title TEXT NOT NULL, body JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        share UUID UNIQUE, invite UUID UNIQUE, trigger_form UUID REFERENCES panthorium_tool_projects(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS panthorium_feature_runs(
        project UUID PRIMARY KEY REFERENCES panthorium_tool_projects(id) ON DELETE CASCADE, owner_id UUID NOT NULL,
        revision INTEGER NOT NULL,run_id UUID NOT NULL,principal JSONB NOT NULL,budget JSONB NOT NULL,
        batch INTEGER NOT NULL DEFAULT 0,job_id UUID,status TEXT NOT NULL,reason TEXT,next_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS feature_runs_due ON panthorium_feature_runs(next_at) WHERE status IN ('running','waiting_quota');
      CREATE TABLE IF NOT EXISTS panthorium_feature_scripts(
        project UUID PRIMARY KEY REFERENCES panthorium_tool_projects(id) ON DELETE CASCADE,owner_id UUID NOT NULL,
        revision INTEGER NOT NULL,principal JSONB NOT NULL,status TEXT NOT NULL,remaining INTEGER NOT NULL,episode UUID,reason TEXT,
        next_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS feature_scripts_due ON panthorium_feature_scripts(next_at) WHERE status IN ('running','generating') OR episode IS NOT NULL;
      CREATE TABLE IF NOT EXISTS panthorium_feature_exports(
        project UUID PRIMARY KEY REFERENCES panthorium_tool_projects(id) ON DELETE CASCADE, owner_id UUID NOT NULL,
        revision INTEGER NOT NULL,artifact UUID NOT NULL,principal JSONB NOT NULL,status TEXT NOT NULL,
        reason TEXT,size BIGINT,source_key TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS feature_exports_due ON panthorium_feature_exports(updated_at) WHERE status IN ('queued','running');
      CREATE INDEX IF NOT EXISTS tool_project_owner ON panthorium_tool_projects(owner_id);
      CREATE INDEX IF NOT EXISTS tool_flow_trigger ON panthorium_tool_projects(trigger_form) WHERE trigger_form IS NOT NULL;
      CREATE TABLE IF NOT EXISTS panthorium_tool_members(
        project UUID REFERENCES panthorium_tool_projects(id) ON DELETE CASCADE, member UUID REFERENCES panthorium_users(id) ON DELETE CASCADE,
        PRIMARY KEY(project,member));
      CREATE INDEX IF NOT EXISTS tool_members_by_user ON panthorium_tool_members(member);
      CREATE TABLE IF NOT EXISTS panthorium_tool_answers(
        form UUID REFERENCES panthorium_tool_projects(id) ON DELETE CASCADE, id UUID NOT NULL,
        fields JSONB NOT NULL, answers JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(form,id));
      CREATE INDEX IF NOT EXISTS tool_answers_by_time ON panthorium_tool_answers(form,created_at);
      CREATE TABLE IF NOT EXISTS panthorium_tool_runs(
        id UUID PRIMARY KEY, flow UUID REFERENCES panthorium_tool_projects(id) ON DELETE CASCADE,
        form UUID NOT NULL, response UUID NOT NULL, label TEXT NOT NULL, tracked BOOLEAN NOT NULL, done BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(flow,form,response),
        FOREIGN KEY(form,response) REFERENCES panthorium_tool_answers(form,id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS tool_runs_by_time ON panthorium_tool_runs(flow,created_at);
      CREATE TABLE IF NOT EXISTS panthorium_tool_notices(
        run UUID REFERENCES panthorium_tool_runs(id) ON DELETE CASCADE, recipient UUID REFERENCES panthorium_users(id) ON DELETE CASCADE,
        attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(run,recipient));
      CREATE INDEX IF NOT EXISTS tool_notices_due ON panthorium_tool_notices(attempt_at);`);
  }
  db() {
    if (!this.pool) fail('tools_storage_unavailable', 503);
    return this.pool;
  }
  async tx(fn) {
    const c = await this.db().connect();
    try {
      await c.query('BEGIN');
      const value = await fn(c);
      await c.query('COMMIT');
      return value;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async list(uid) {
    return (
      await this.db().query(
        `SELECT ${LIST_COLUMNS} FROM panthorium_tool_projects p WHERE p.owner_id=$1 OR EXISTS
     (SELECT 1 FROM panthorium_tool_members m WHERE m.project=p.id AND m.member=$1) ORDER BY p.updated_at DESC,p.id`,
        [uid]
      )
    ).rows;
  }
  async project(c, uid, key, lock = false) {
    const row = (
      await c.query(
        `SELECT ${LIST_COLUMNS},p.body,CASE WHEN p.owner_id=$1 THEN p.share END AS share,
      CASE WHEN p.owner_id=$1 THEN p.invite END AS invite FROM panthorium_tool_projects p WHERE p.id=$2 AND (p.owner_id=$1 OR EXISTS
      (SELECT 1 FROM panthorium_tool_members m WHERE m.project=p.id AND m.member=$1)) ${lock ? 'FOR UPDATE OF p' : ''}`,
        [uid, id(key)]
      )
    ).rows[0];
    if (!row) fail('project_not_found', 404);
    return row;
  }
  async get(uid, key) {
    return this.project(this.db(), uid, key);
  }
  async bind(c, uid, body) {
    if (!body.source) return null;
    const r = (
      await c.query(
        "SELECT body FROM panthorium_tool_projects WHERE id=$1 AND owner_id=$2 AND kind='form' FOR SHARE",
        [body.source, uid]
      )
    ).rows[0];
    if (!r) fail('select_owned_form');
    if (body.labelField && !r.body.fields.some((f) => f.id === body.labelField)) fail('invalid_field');
    return body.source;
  }
  create(uid, input) {
    return this.tx(async (c) => {
      const key = id(input.id),
        kind = input.kind,
        title = text(input.title, 120),
        body = normalize(kind, input.body);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tool-owner:' + uid]);
      const existing = (
        await c.query(
          'SELECT owner_id,kind,title,body=$2::jsonb AS same FROM panthorium_tool_projects WHERE id=$1',
          [key, JSON.stringify(body)]
        )
      ).rows[0];
      if (existing) {
        if (
          existing.owner_id === uid &&
          existing.kind === kind &&
          existing.title === title &&
          existing.same
        )
          return this.project(c, uid, key);
        fail('project_id_conflict', 409);
      }
      const count = await c.query(
        'SELECT count(*)::int AS n FROM panthorium_tool_projects WHERE owner_id=$1',
        [uid]
      );
      if (count.rows[0].n >= 100) fail('project_limit', 409);
      const trigger = kind === 'flow' ? await this.bind(c, uid, body) : null;
      await c.query(
        'INSERT INTO panthorium_tool_projects(id,owner_id,kind,title,body,trigger_form) VALUES($1,$2,$3,$4,$5,$6)',
        [key, uid, kind, title, JSON.stringify(body), trigger]
      );
      return this.project(c, uid, key);
    });
  }
  update(uid, key, input) {
    return this.tx(async (c) => {
      const previous = await this.project(c, uid, key);
      if (!previous.owner && !['design', 'page'].includes(previous.kind)) fail('owner_required', 403);
      const body = normalize(previous.kind, input.body),
        title = text(input.title, 120);
      const trigger = previous.kind === 'flow' ? await this.bind(c, uid, body) : null;
      const row = await this.project(c, uid, key, true);
      if (row.revision !== input.revision) fail('revision_conflict', 409);
      await c.query(
        'UPDATE panthorium_tool_projects SET title=$2,body=$3,trigger_form=$4,revision=revision+1,updated_at=now() WHERE id=$1',
        [key, title, JSON.stringify(body), trigger]
      );
      return this.project(c, uid, key);
    });
  }
  remove(uid, key, revision) {
    return this.tx(async (c) => {
      const row = await this.project(c, uid, key, true);
      if (!row.owner) fail('owner_required', 403);
      if (row.revision !== revision) fail('revision_conflict', 409);
      if (row.kind === 'form')
        await c.query(
          `UPDATE panthorium_tool_projects SET trigger_form=NULL,body=body||'{"enabled":false,"source":null,"labelField":null}'::jsonb,
        revision=revision+1,updated_at=now() WHERE trigger_form=$1`,
          [key]
        );
      await c.query('DELETE FROM panthorium_tool_projects WHERE id=$1', [key]);
      return {removed: true};
    });
  }
  share(uid, key, input) {
    return this.tx(async (c) => {
      const p = await this.project(c, uid, key, true);
      if (!p.owner) fail('owner_required', 403);
      if (p.revision !== input.revision) fail('revision_conflict', 409);
      if (typeof input.on !== 'boolean') fail('invalid_share');
      const team = input.mode === 'team';
      if (
        team
          ? !['design', 'page', 'flow'].includes(p.kind)
          : input.mode !== 'public' || !PUBLIC_KINDS.includes(p.kind)
      )
        fail('invalid_share');
      const col = team ? 'invite' : 'share';
      if (Boolean(p[col]) === input.on) return p;
      const token = input.on ? randomUUID() : null;
      await c.query(
        `UPDATE panthorium_tool_projects SET ${col}=$2,revision=revision+1,updated_at=now() WHERE id=$1`,
        [key, token]
      );
      return this.project(c, uid, key);
    });
  }
  async shared(token) {
    const p = (
      await this.db().query(
        'SELECT kind,title,body,revision FROM panthorium_tool_projects WHERE share=$1',
        [id(token)]
      )
    ).rows[0];
    if (!p) fail('link_closed', 404);
    return p;
  }
  async copy(uid, token, key) {
    const p = await this.shared(token);
    if (!['design', 'page'].includes(p.kind)) fail('template_required');
    return this.create(uid, {id: key, kind: p.kind, title: p.title.slice(0, 120), body: p.body});
  }
  async inviteInfo(token) {
    const p = (
      await this.db().query('SELECT title,kind FROM panthorium_tool_projects WHERE invite=$1', [
        id(token)
      ])
    ).rows[0];
    if (!p) fail('link_closed', 404);
    return p;
  }
  join(uid, token) {
    return this.tx(async (c) => {
      const p = (
        await c.query('SELECT id,owner_id FROM panthorium_tool_projects WHERE invite=$1 FOR UPDATE', [
          id(token)
        ])
      ).rows[0];
      if (!p) fail('link_closed', 404);
      if (p.owner_id !== uid) {
        const members = (
          await c.query('SELECT member FROM panthorium_tool_members WHERE project=$1', [p.id])
        ).rows;
        if (!members.some((m) => m.member === uid)) {
          if (members.length >= 10) fail('team_limit', 409);
          await c.query('INSERT INTO panthorium_tool_members VALUES($1,$2)', [p.id, uid]);
        }
      }
      return this.project(c, uid, p.id);
    });
  }
  async members(uid, key) {
    const p = await this.get(uid, key);
    if (!p.owner) fail('owner_required', 403);
    return (
      await this.db().query(
        'SELECT m.member,u.username FROM panthorium_tool_members m JOIN panthorium_users u ON u.id=m.member WHERE m.project=$1 ORDER BY u.username',
        [key]
      )
    ).rows;
  }
  revoke(uid, key, member) {
    return this.tx(async (c) => {
      const p = await this.project(c, uid, key, true);
      const who = id(member);
      if (!p.owner && who !== uid) fail('owner_required', 403);
      if (!p.owner && p.kind === 'form') fail('owner_required', 403);
      await c.query('DELETE FROM panthorium_tool_members WHERE project=$1 AND member=$2', [key, who]);
      if (p.owner)
        await c.query(
          'UPDATE panthorium_tool_projects SET invite=NULL,revision=revision+1 WHERE id=$1 AND invite IS NOT NULL',
          [key]
        );
      await c.query(
        'DELETE FROM panthorium_tool_notices n USING panthorium_tool_runs r WHERE n.run=r.id AND r.flow=$1 AND n.recipient=$2',
        [key, who]
      );
      return {removed: true};
    });
  }
  async submit(token, input) {
    const result = await this.tx(async (c) => {
      const p = (
        await c.query(
          "SELECT id,owner_id,revision,body FROM panthorium_tool_projects WHERE share=$1 AND kind='form' FOR UPDATE",
          [id(token)]
        )
      ).rows[0];
      if (!p) fail('link_closed', 404);
      const request = id(input.requestId);
      const old = (
        await c.query('SELECT fields,answers FROM panthorium_tool_answers WHERE form=$1 AND id=$2', [
          p.id,
          request
        ])
      ).rows[0];
      if (old) {
        const answers = validateAnswers(old.fields, input.answers);
        if (Object.keys(answers).some((k) => answers[k] !== old.answers[k]))
          fail('request_conflict', 409);
        return {received: true};
      }
      if (input.revision !== p.revision) fail('form_changed', 409);
      const answers = validateAnswers(p.body.fields, input.answers);
      const count = (
        await c.query('SELECT count(*)::int AS n FROM panthorium_tool_answers WHERE form=$1', [p.id])
      ).rows[0].n;
      if (count >= 1000) fail('form_full', 409);
      await c.query('INSERT INTO panthorium_tool_answers(form,id,fields,answers) VALUES($1,$2,$3,$4)', [
        p.id,
        request,
        JSON.stringify(p.body.fields),
        JSON.stringify(answers)
      ]);
      const flows = (
        await c.query(
          `SELECT id,owner_id,body FROM panthorium_tool_projects WHERE trigger_form=$1 AND body->>'enabled'='true' ORDER BY id FOR SHARE`,
          [p.id]
        )
      ).rows;
      for (const f of flows) {
        const run = randomUUID();
        const label = (
          (f.body.actions.includes('record') && answers[f.body.labelField]) ||
          'คำตอบใหม่'
        ).slice(0, 240);
        await c.query(
          'INSERT INTO panthorium_tool_runs(id,flow,form,response,label,tracked) VALUES($1,$2,$3,$4,$5,$6)',
          [run, f.id, p.id, request, label, f.body.actions.includes('record')]
        );
        if (f.body.actions.includes('notify'))
          await c.query(
            `INSERT INTO panthorium_tool_notices(run,recipient)
          SELECT $1::uuid,$2::uuid UNION SELECT $1::uuid,member FROM panthorium_tool_members WHERE project=$3`,
            [run, f.owner_id, f.id]
          );
      }
      return {received: true};
    });
    return result;
  }
  async answers(uid, key, offset = 0, csv = false) {
    const p = await this.get(uid, key);
    if (!p.owner || p.kind !== 'form') fail('form_required', 403);
    const n = Number(offset);
    if (!Number.isInteger(n) || n < 0 || n > 1000) fail('invalid_offset');
    const rs = (
      await this.db().query(
        `SELECT id,fields,answers,created_at FROM panthorium_tool_answers WHERE form=$1 ORDER BY created_at ${csv ? 'ASC' : 'DESC'},id LIMIT $2 OFFSET $3`,
        [key, csv ? 1000 : 26, csv ? 0 : n]
      )
    ).rows;
    return csv ? responsesCsv(p.body.fields, rs) : {items: rs.slice(0, 25), more: rs.length > 25};
  }
  async runs(uid, key, offset = 0) {
    const p = await this.get(uid, key);
    if (p.kind !== 'flow') fail('flow_required');
    const n = Number(offset);
    if (!Number.isSafeInteger(n) || n < 0) fail('invalid_offset');
    const rs = (
      await this.db().query(
        'SELECT id,label,done,created_at FROM panthorium_tool_runs WHERE flow=$1 AND tracked ORDER BY created_at DESC,id LIMIT 26 OFFSET $2',
        [key, n]
      )
    ).rows;
    return {items: rs.slice(0, 25), more: rs.length > 25};
  }
  mark(uid, key, run, done) {
    return this.tx(async (c) => {
      const p = await this.project(c, uid, key, true);
      if (p.kind !== 'flow' || typeof done !== 'boolean') fail('invalid_run');
      const r = await c.query(
        'UPDATE panthorium_tool_runs SET done=$3 WHERE flow=$1 AND id=$2 AND tracked',
        [key, id(run), done]
      );
      if (!r.rowCount) fail('run_not_found', 404);
      return {done};
    });
  }
  async flush() {
    if (!this.pool || !this.notifications || this.flushing) return;
    this.flushing = true;
    try {
      const notices = await this.tx(
        async (c) =>
          (
            await c.query(`WITH due AS (SELECT run,recipient FROM panthorium_tool_notices WHERE attempt_at<=now()
        ORDER BY attempt_at LIMIT 12 FOR UPDATE SKIP LOCKED) UPDATE panthorium_tool_notices n SET attempt_at=now()+interval '2 minutes'
        FROM due WHERE (n.run,n.recipient)=(due.run,due.recipient) RETURNING n.run,n.recipient`)
          ).rows
      );
      for (const n of notices) {
        try {
          await this.notifications.publish({
            userId: n.recipient,
            category: 'operations',
            type: 'tools.form_received',
            title: 'มีคำตอบใหม่ในเวิร์กโฟลว์',
            body: 'เปิด “สร้างสรรค์และเอกสาร” แล้วเลือก “งานอัตโนมัติ” เพื่อดูคำตอบ',
            sourceId: n.run
          });
          await this.pool.query('DELETE FROM panthorium_tool_notices WHERE run=$1 AND recipient=$2', [
            n.run,
            n.recipient
          ]);
        } catch {
          /* The lease makes failed deliveries eligible for a later attempt. */
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
module.exports = {OnlineToolsService};
