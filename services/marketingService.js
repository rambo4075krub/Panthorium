"use strict";
const { randomUUID } = require("node:crypto");
const { choices, offer, objectives } = require("./marketingCatalog");
const { account } = require("./socialService");

const features = new Set(["feed","short","watch","live","tv","market","community","talk","packages","offers","offer-open"]);
const invalid = (code, status = 400) => Object.assign(Error(code), {status});
const isAdmin = user => user?.roles?.includes("administrator") && user?.permissions?.includes("settings");
class MarketingService {
  constructor({pool, runner, web}) { this.pool=pool; this.runner=runner; this.web=web; }
  async init() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panthorium_marketing_preferences(
        user_id UUID PRIMARY KEY REFERENCES panthorium_users(id) ON DELETE CASCADE,
        analytics BOOLEAN NOT NULL DEFAULT false, offers BOOLEAN NOT NULL DEFAULT false);
      CREATE TABLE IF NOT EXISTS panthorium_marketing_events(
        user_id UUID REFERENCES panthorium_marketing_preferences ON DELETE CASCADE,
        day DATE NOT NULL, feature TEXT NOT NULL, PRIMARY KEY(day,feature,user_id));
      CREATE TABLE IF NOT EXISTS panthorium_marketing_runs(
        day DATE PRIMARY KEY, status TEXT NOT NULL, lease UUID, next_attempt TIMESTAMPTZ NOT NULL,
        brief JSONB, finished_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS panthorium_marketing_campaigns(
        id UUID PRIMARY KEY, actor UUID REFERENCES panthorium_users ON DELETE SET NULL,
        product TEXT NOT NULL, objective TEXT NOT NULL, starts TIMESTAMPTZ NOT NULL,
        ends TIMESTAMPTZ NOT NULL CHECK(ends>starts), reach_limit INTEGER NOT NULL CHECK(reach_limit>0),
        stopped BOOLEAN NOT NULL DEFAULT false, created TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS panthorium_marketing_deliveries(
        campaign UUID REFERENCES panthorium_marketing_campaigns ON DELETE CASCADE,
        user_id UUID REFERENCES panthorium_users ON DELETE CASCADE, PRIMARY KEY(campaign,user_id));
    `);
  }
  db() { if (!this.pool) throw invalid("marketing_database_unavailable",503); return this.pool; }
  async transaction(fn) {
    const c=await this.db().connect();
    try { await c.query("BEGIN"); const value=await fn(c); await c.query("COMMIT"); return value; }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  async preferences(user) {
    const uid=account(user);
    return (await this.db().query("SELECT analytics,offers FROM panthorium_marketing_preferences WHERE user_id=$1",[uid])).rows[0] || {analytics:false,offers:false};
  }
  async setPreference(user, key, value) {
    const uid=account(user);
    if (!["analytics","offers"].includes(key) || typeof value !== "boolean") throw invalid("invalid_marketing_preference");
    return this.transaction(async c => {
      const result=await c.query(`INSERT INTO panthorium_marketing_preferences(user_id,${key}) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET ${key}=EXCLUDED.${key} RETURNING analytics,offers`,[uid,value]);
      if (key==="analytics" && !value) await c.query("DELETE FROM panthorium_marketing_events WHERE user_id=$1",[uid]);
      return result.rows[0];
    });
  }
  async observe(user,feature) {
    const uid=account(user);
    if (!features.has(feature)) throw invalid("invalid_marketing_event");
    await this.db().query(`WITH agreed AS (SELECT user_id FROM panthorium_marketing_preferences
      WHERE user_id=$1 AND analytics FOR SHARE) INSERT INTO panthorium_marketing_events(user_id,day,feature)
      SELECT user_id,(now() AT TIME ZONE 'Asia/Bangkok')::date,$2 FROM agreed ON CONFLICT DO NOTHING`,[uid,feature]);
  }
  async summary() {
    return (await this.db().query(`SELECT feature,COUNT(DISTINCT user_id)::int AS people
      FROM panthorium_marketing_events JOIN panthorium_marketing_preferences USING(user_id)
      WHERE analytics AND day >= (now() AT TIME ZONE 'Asia/Bangkok')::date-6
      GROUP BY feature HAVING COUNT(DISTINCT user_id)>=5 ORDER BY feature`)).rows;
  }
  async dashboard() {
    const [counts,runs,campaigns]=await Promise.all([this.summary(),this.db().query(`SELECT day::text,status,brief,finished_at
      FROM panthorium_marketing_runs ORDER BY day DESC LIMIT 7`),this.db().query(`SELECT c.*,COUNT(d.user_id)::int AS reached
      FROM panthorium_marketing_campaigns c LEFT JOIN panthorium_marketing_deliveries d ON d.campaign=c.id
      GROUP BY c.id ORDER BY c.created DESC LIMIT 60`)]);
    return {counts, runs:runs.rows, campaigns:campaigns.rows, products:choices(), objectives, worker:this.runner.available()};
  }
  async publish(user, {id, product, objective, starts, ends, limit}) {
    const uid=account(user);
    if (!isAdmin(user)) throw invalid("permission_denied",403);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id||"")) throw invalid("invalid_campaign");
    const a=Date.parse(starts), b=Date.parse(ends), now=Date.now();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b<=a || b<=now || b-a>90*86400000 ||
        !Number.isInteger(limit) || limit<1 || limit>100000) throw invalid("invalid_campaign");
    const approved=offer(product,objective,Math.max(a,now));
    if (!approved || (approved.endsAt && b>Date.parse(approved.endsAt))) throw invalid("marketing_offer_unavailable",409);
    const result=await this.db().query(`INSERT INTO panthorium_marketing_campaigns(id,actor,product,objective,starts,ends,reach_limit)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,[id,uid,product,objective,new Date(a),new Date(b),limit]);
    if (!result.rowCount) {
      const old=(await this.pool.query("SELECT * FROM panthorium_marketing_campaigns WHERE id=$1",[id])).rows[0];
      if (!old || old.actor!==uid || old.product!==product || old.objective!==objective || +old.starts!==a || +old.ends!==b || old.reach_limit!==limit)
        throw invalid("campaign_conflict",409);
    }
    return {id};
  }
  async stopCampaign(id) {
    const r=await this.db().query("UPDATE panthorium_marketing_campaigns SET stopped=true WHERE id=$1 RETURNING id",[id]);
    if (!r.rowCount) throw invalid("campaign_not_found",404);
  }
  async offers(user) {
    const uid=account(user);
    return this.transaction(async c => {
      const pref=await c.query("SELECT offers FROM panthorium_marketing_preferences WHERE user_id=$1 FOR SHARE",[uid]);
      if (!pref.rows[0]?.offers) return [];
      // Serialize admission per campaign so two simultaneous opens cannot exceed the reach limit.
      const active=await c.query(`SELECT * FROM panthorium_marketing_campaigns WHERE NOT stopped AND starts<=now() AND ends>now()
        ORDER BY created DESC,id LIMIT 20 FOR UPDATE`);
      const items=[];
      for (const row of active.rows) {
        const copy=offer(row.product,row.objective);
        if (!copy || +row.ends<=Date.now()) continue;
        const counts=await c.query(`SELECT COUNT(*)::int AS reached,COALESCE(bool_or(user_id=$2),false) AS seen
          FROM panthorium_marketing_deliveries WHERE campaign=$1`,[row.id,uid]);
        if (!counts.rows[0].seen) {
          if (counts.rows[0].reached>=row.reach_limit) continue;
          await c.query("INSERT INTO panthorium_marketing_deliveries(campaign,user_id) VALUES($1,$2)",[row.id,uid]);
        }
        items.push({campaignId:row.id,title:copy.title,text:copy.text,action:copy.action || "packages",ends:row.ends});
      }
      return items;
    });
  }
  async discover(user,query) {
    if (typeof query!=="string" || !query.trim() || query.length>120) throw invalid("invalid_market_query");
    const result=await this.web.execute("web.search",{query:query.trim(),language:"th"},account(user));
    return {available:result.available, results:result.results || []};
  }
  async tick() {
    if (this.busy || this.stopped || !this.runner.available() || !this.pool) return;
    this.busy=true;
    const lease=randomUUID();
    let day;
    try {
      const claim=await this.pool.query(`INSERT INTO panthorium_marketing_runs(day,status,lease,next_attempt)
        VALUES((now() AT TIME ZONE 'Asia/Bangkok')::date,'running',$1,now()+interval '15 minutes')
        ON CONFLICT(day) DO UPDATE SET status='running',lease=$1,next_attempt=EXCLUDED.next_attempt
        WHERE panthorium_marketing_runs.status<>'ready' AND panthorium_marketing_runs.next_attempt<=now()
        RETURNING day::text`,[lease]);
      if (!claim.rowCount) return;
      day=claim.rows[0].day;
      await this.pool.query("DELETE FROM panthorium_marketing_events WHERE day < $1::date-6",[day]);
      await this.pool.query("DELETE FROM panthorium_marketing_runs WHERE day < $1::date-30",[day]);
      await this.pool.query("DELETE FROM panthorium_marketing_campaigns WHERE ends < now()-interval '30 days'");
      const products=choices().map(({id,name})=>({id,name}));
      const brief=await this.runner.generate({products, activity:await this.summary()});
      await this.pool.query("UPDATE panthorium_marketing_runs SET status='ready',brief=$3,lease=NULL,finished_at=now() WHERE day=$1 AND lease=$2",
        [day,lease,JSON.stringify(brief)]);
    } catch(e) {
      if (day) await this.pool.query(`UPDATE panthorium_marketing_runs SET status=$3,lease=NULL,next_attempt=now()+interval '30 minutes'
        WHERE day=$1 AND lease=$2`,[day,lease,e.message==="resource_pressure"?"resource_wait":"retry_wait"]);
      else throw e;
    } finally { this.busy=false; }
  }
  start() {
    if (this.timer || !this.runner.available() || !this.pool) return;
    this.stopped=false;
    const run=()=>this.tick().catch(()=>console.warn("[MARKETING] daily job deferred"));
    this.timer=setInterval(run,60000); this.timer.unref(); run();
  }
  stop() { this.stopped=true; clearInterval(this.timer); this.timer=null; this.runner.stop(); }
}
module.exports={MarketingService,isAdmin};
