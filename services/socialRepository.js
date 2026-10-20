"use strict";
const { getDatabasePool } = require("./databasePool");
const copy = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
class SocialRepository {
  constructor({
    pool,
    databaseUrl,
    databaseSslMode = "require",
    allowMemory = false,
  } = {}) {
    this.pool =
      pool ||
      getDatabasePool({
        connectionString: databaseUrl,
        ssl:
          databaseSslMode === "disable" ? false : { rejectUnauthorized: true },
      });
    this.memory =
      allowMemory && process.env.NODE_ENV !== "production" ? new Map() : null;
    this.tail = Promise.resolve();
  }
  async init() {
    if (this.pool)
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS panthorium_social_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner_id TEXT NOT NULL,parent_id TEXT NOT NULL DEFAULT '',members JSONB NOT NULL DEFAULT '[]',data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS social_kind_date ON panthorium_social_records(kind,created_at DESC,id);CREATE INDEX IF NOT EXISTS social_parent ON panthorium_social_records(parent_id,kind);CREATE INDEX IF NOT EXISTS social_owner ON panthorium_social_records(owner_id,kind);CREATE INDEX IF NOT EXISTS social_notifications_owner_date ON panthorium_social_records(owner_id,(data->>'createdAt') DESC,id DESC) WHERE kind='notification';CREATE INDEX IF NOT EXISTS social_members ON panthorium_social_records USING GIN(members);`,
      );
  }
  require() {
    if (!this.pool && !this.memory)
      throw Object.assign(Error("social_database_unavailable"), {
        status: 503,
      });
  }
  async get(id) {
    this.require();
    return this.pool
      ? copy(
          (
            await this.pool.query(
              "SELECT data FROM panthorium_social_records WHERE id=$1",
              [id],
            )
          ).rows[0]?.data,
        )
      : copy(this.memory.get(id));
  }
  async list({ kind, owner, parent, member, limit = 100, before } = {}) {
    this.require();
    limit = Math.min(200, Math.max(1, Number(limit) || 100));
    if (!this.pool)
      return [...this.memory.values()]
        .filter(
          (x) =>
            (!kind || x.kind === kind) &&
            (!owner || x.ownerId === owner) &&
            (parent === undefined || x.parentId === parent) &&
            (!member || x.members?.includes(member)) &&
            (!before || x.id < before),
        )
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, limit)
        .map(copy);
    const values = [],
      where = [];
    const add = (sql, value) => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    if (kind) add("kind=?", kind);
    if (owner) add("owner_id=?", owner);
    if (parent !== undefined) add("parent_id=?", parent);
    if (member) add("members @> ?::jsonb", JSON.stringify([member]));
    if (before) add("id<?", before);
    values.push(limit);
    return (
      await this.pool.query(
        `SELECT data FROM panthorium_social_records ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT $${values.length}`,
        values,
      )
    ).rows.map((x) => copy(x.data));
  }
  async notificationPage({ owner, before, unread = false, limit = 100 }) {
    this.require();
    if (!this.pool) return [...this.memory.values()]
      .filter(n => n.kind === "notification" && n.ownerId === owner && (!unread || !n.readAt) &&
        (!before || n.createdAt < before.createdAt || (n.createdAt === before.createdAt && n.id < before.id)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit).map(copy);
    const values = [owner], where = ["kind='notification'", "owner_id=$1"];
    if (unread) where.push("data->>'readAt' IS NULL");
    if (before) { values.push(before.createdAt, before.id); where.push("(data->>'createdAt',id)<($2::text,$3::text)"); }
    values.push(limit);
    return (await this.pool.query(`SELECT data FROM panthorium_social_records WHERE ${where.join(" AND ")} ORDER BY data->>'createdAt' DESC,id DESC LIMIT $${values.length}`, values)).rows.map(r => copy(r.data));
  }
  async put(row) {
    this.require();
    const data = copy(row);
    if (this.pool)
      await this.pool.query(
        `INSERT INTO panthorium_social_records(id,kind,owner_id,parent_id,members,data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT(id) DO UPDATE SET members=EXCLUDED.members,data=EXCLUDED.data`,
        [
          row.id,
          row.kind,
          row.ownerId,
          row.parentId || "",
          JSON.stringify(row.members || []),
          JSON.stringify(row),
        ],
      );
    else this.memory.set(row.id, data);
    if (row.kind === "signal" || row.transient) {
      if (this.pool)
        await this.pool.query(
          "DELETE FROM panthorium_social_records WHERE (kind='signal' OR (kind='receipt' AND data->>'transient'='true')) AND created_at<NOW()-INTERVAL '3 minutes'",
        );
      else
        for (const [k, v] of this.memory)
          if (
            (v.kind === "signal" || v.transient) &&
            Date.parse(v.createdAt) < Date.now() - 180000
          )
            this.memory.delete(k);
    }
    return data;
  }
  async remove(id) {
    this.require();
    if (this.pool)
      await this.pool.query(
        "DELETE FROM panthorium_social_records WHERE id=$1",
        [id],
      );
    else this.memory.delete(id);
  }
  async transaction(work) {
    this.require();
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('panthorium-social-write',0))",
        );
        const tx = new SocialRepository({ pool: client });
        const out = await work(tx);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    const previous = this.tail;
    let release;
    this.tail = new Promise((r) => {
      release = r;
    });
    await previous;
    const snapshot = new Map([...this.memory].map(([k, v]) => [k, copy(v)]));
    try {
      return await work(this);
    } catch (e) {
      this.memory = snapshot;
      throw e;
    } finally {
      release();
    }
  }
}
module.exports = { SocialRepository };
