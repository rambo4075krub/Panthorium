"use strict";
const { randomUUID, createHash, createHmac } = require("node:crypto");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODULES = ["watch", "community", "talk", "market", "live", "connect"];
const fail = (code, status = 400) => {
  throw Object.assign(Error(code), {
    status,
    code,
    sideEffectNotApplied: true,
  });
};
const str = (v, n = 4000) => {
  if (typeof v !== "string" || v.length > n) fail("social_invalid_text");
  return v.trim();
};
const key = (...p) => createHash("sha256").update(p.join(":")).digest("hex");
const id = () => String(Date.now()).padStart(16, "0") + "-" + randomUUID();
function account(user) {
  if (!UUID.test(user?.sub || "") || user.roles?.includes("guest"))
    fail("account_required", 403);
  return user.sub;
}
function row(kind, ownerId, data = {}, parentId = "", members = []) {
  return {
    id: id(),
    kind,
    ownerId,
    parentId,
    members,
    createdAt: new Date().toISOString(),
    ...data,
  };
}
class SocialService {
  constructor({
    repository,
    files,
    turnUrls = process.env.SOCIAL_TURN_URLS,
    turnSecret = process.env.SOCIAL_TURN_SECRET,
  } = {}) {
    this.repo = repository;
    this.files = files;
    this.turnUrls = turnUrls;
    this.turnSecret = turnSecret;
  }
  async init() {
    await this.repo.init();
  }
  async profile(user) {
    return this.repo.get("profile:" + account(user));
  }
  async blocked(repo, a, b) {
    return (
      a !== b &&
      !!(
        (await repo.get("block:" + key(a, b))) ||
        (await repo.get("block:" + key(b, a)))
      )
    );
  }
  async allowed(repo, userId, record) {
    if (!record || record.deleted || record.hidden) return false;
    if (await this.blocked(repo, userId, record.ownerId)) return false;
    if (record.kind === "connect") {
      const me = await repo.get("connect:" + userId);
      return (
        !!me?.enabled &&
        !me.hidden &&
        !!record.enabled &&
        userId !== record.ownerId
      );
    }
    if (record.kind === "group") return true;
    if (record.kind === "playlist") return record.ownerId === userId;
    if (record.audience === "group") {
      const group = await repo.get(record.parentId);
      return (
        !!group &&
        !group.hidden &&
        group.members.includes(userId) &&
        (await this.allowed(repo, userId, group))
      );
    }
    if (record.kind === "profile")
      return record.discoverable || record.ownerId === userId;
    if (
      record.kind === "comment" ||
      record.kind === "message" ||
      record.kind === "signal" ||
      record.kind === "live-chat"
    )
      return this.allowed(repo, userId, await repo.get(record.parentId));
    if (record.kind === "thread") {
      if (!record.members.includes(userId) || record.blocked) return false;
      for (const member of record.members) {
        if (await this.blocked(repo, userId, member)) return false;
        if (
          record.context === "connect" &&
          !(await repo.get("connect:" + member))?.enabled
        )
          return false;
      }
      return true;
    }
    if (record.kind === "order") return record.members.includes(userId);
    if (["watch", "community", "listing", "live"].includes(record.kind))
      return (
        record.ownerId === userId ||
        record.audience === "public" ||
        (record.audience === "followers" &&
          !!(await repo.get("follow:" + key(userId, record.ownerId))))
      );
    return record.ownerId === userId;
  }
  async requireRecord(repo, userId, recordId, kind) {
    const r = await repo.get(recordId);
    if (
      !r ||
      (kind && r.kind !== kind) ||
      !(await this.allowed(repo, userId, r))
    )
      fail("social_not_found", 404);
    return r;
  }
  async attachments(userId, value) {
    if (value == null) return [];
    if (
      !Array.isArray(value) ||
      value.length > 6 ||
      !value.every((x) => UUID.test(x))
    )
      fail("social_invalid_files");
    const out = [];
    for (const fileId of [...new Set(value)])
      out.push(await this.files.findObject(userId, fileId));
    return out.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      contentType: f.contentType,
    }));
  }
  publicProfile(p) {
    return p
      ? {
          id: p.ownerId,
          name: p.name,
          bio: p.bio,
          discoverable: p.discoverable,
        }
      : null;
  }
  async read({
    user,
    module = "community",
    recordId,
    query = "",
    before,
  } = {}) {
    const uid = account(user);
    if (!MODULES.includes(module)) fail("social_invalid_module");
    query = str(query, 200).toLowerCase();
    if (recordId) {
      const r = await this.requireRecord(this.repo, uid, recordId);
      const childKind =
        r.kind === "thread"
          ? "message"
          : r.kind === "live"
            ? "live-chat"
            : r.kind === "group"
              ? "community"
              : "comment";
      if (r.kind === "group" && !r.members.includes(uid))
        return { ok: true, record: r, items: [] };
      if (r.kind === "playlist") {
        const items = [];
        for (const savedId of r.recordIds || []) {
          const saved = await this.repo.get(savedId);
          if (await this.allowed(this.repo, uid, saved))
            items.push(await this.decorate(saved, uid));
        }
        return { ok: true, record: r, items };
      }
      const source = await this.repo.list({
        kind: childKind,
        parent: r.id,
        before,
        limit: 100,
      });
      const children = [];
      for (const child of source)
        if (await this.allowed(this.repo, uid, child)) children.push(child);
      return {
        ok: true,
        record: await this.decorate(r, uid),
        items: children.reverse(),
        nextCursor: source.length === 100 ? source.at(-1).id : null,
      };
    }
    let items = [];
    const kind = {
      watch: "watch",
      community: "community",
      talk: "thread",
      market: "listing",
      live: "live",
      connect: "connect",
    }[module];
    if (
      module === "connect" &&
      !(await this.repo.get("connect:" + uid))?.enabled
    )
      return { ok: true, items: [], optInRequired: true };
    const candidates = await this.repo.list({
      kind,
      ...(module === "talk" ? { member: uid } : {}),
      before,
      limit: 100,
    });
    for (const r of candidates) {
      if (
        !(await this.allowed(this.repo, uid, r)) ||
        (query &&
          ![r.title, r.text, r.name, r.bio]
            .join(" ")
            .toLowerCase()
            .includes(query))
      )
        continue;
      if (
        module === "live" &&
        (r.status !== "live" ||
          Date.parse(r.heartbeatAt || r.createdAt) < Date.now() - 60000)
      )
        continue;
      if (module === "connect") {
        const mine = await this.repo.get("connect:" + uid);
        if (
          !(
            mine.preferences.includes(r.gender) ||
            mine.preferences.includes("all")
          ) ||
          !(
            r.preferences.includes(mine.gender) || r.preferences.includes("all")
          )
        )
          continue;
        if (await this.repo.get("pass:" + key(uid, r.ownerId))) continue;
      }
      items.push(await this.decorate(r, uid));
    }
    return {
      ok: true,
      items,
      nextCursor: candidates.length === 100 ? candidates.at(-1).id : null,
    };
  }
  async decorate(r, uid) {
    const p = await this.repo.get("profile:" + r.ownerId);
    const out = { ...r, author: this.publicProfile(p) };
    if (r.kind === "connect") {
      delete out.preferences;
      out.matched =
        !!(await this.repo.get("interest:" + key(r.ownerId, uid))) &&
        !!(await this.repo.get("interest:" + key(uid, r.ownerId)));
    }
    if (["watch", "community", "listing"].includes(r.kind)) {
      out.liked = !!(await this.repo.get("like:" + key(uid, r.id)));
    }
    return out;
  }
  async people({ user, query = "" }) {
    const uid = account(user);
    query = str(query, 100).toLowerCase();
    if (query.length < 2) return { ok: true, items: [] };
    const items = [];
    for (const p of await this.repo.list({ kind: "profile", limit: 200 })) {
      if (
        p.ownerId !== uid &&
        p.discoverable &&
        p.name.toLowerCase().includes(query) &&
        !(await this.blocked(this.repo, uid, p.ownerId))
      )
        items.push(this.publicProfile(p));
    }
    return { ok: true, items: items.slice(0, 30) };
  }
  async write({ user, action, input = {}, requestId } = {}) {
    const uid = account(user);
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("social_invalid_input");
    const prepared = [
      "publish",
      "message",
      "listing",
      "profile",
      "connect",
    ].includes(action)
      ? await this.attachments(uid, input.fileIds)
      : [];
    const fingerprint = key(action, JSON.stringify(input));
    if (requestId && !/^[\w:.-]{1,160}$/.test(requestId))
      fail("social_invalid_request_id");
    return this.repo.transaction(async (repo) => {
      const receiptId = requestId ? "receipt:" + key(uid, requestId) : null;
      if (receiptId) {
        const old = await repo.get(receiptId);
        if (old) {
          if (old.fingerprint !== fingerprint)
            fail("social_request_conflict", 409);
          return old.result;
        }
      }
      const result = await this.mutate(
        repo,
        uid,
        action,
        input,
        prepared,
        user,
      );
      if (receiptId)
        await repo.put(
          row("receipt", uid, { id: receiptId, fingerprint, result }),
        );
      return result;
    });
  }
  async mutate(repo, uid, action, a, files, user) {
    let record;
    if (action === "profile") {
      const name = str(a.name, 80);
      if (!name) fail("social_name_required");
      record = row("profile", uid, {
        id: "profile:" + uid,
        name,
        bio: str(a.bio || "", 1000),
        discoverable: a.discoverable === true,
        files,
      });
    } else if (action === "publish" || action === "listing") {
      if (!(await repo.get("profile:" + uid))) fail("social_profile_required");
      const kind = action === "listing" ? "listing" : a.module;
      if (!["community", "watch", "listing"].includes(kind))
        fail("social_invalid_module");
      const title = str(a.title || "", 200),
        text = str(a.text || "", 8000);
      if (!title && !text && !files.length) fail("social_empty_post");
      if (
        kind === "watch" &&
        !files.some((f) => /^video\/(mp4|webm)$/.test(f.contentType))
      )
        fail("social_video_required");
      const audience = a.audience || "public";
      if (!["public", "followers", "private", "group"].includes(audience))
        fail("social_invalid_audience");
      record = row(kind, uid, { title, text, files, audience, likeCount: 0 });
      if (audience === "group") {
        const g = await this.requireRecord(repo, uid, a.groupId, "group");
        if (kind !== "community" || !g.members.includes(uid))
          fail("social_join_required");
        record.parentId = g.id;
      }
      if (kind === "listing") {
        if (
          !Number.isSafeInteger(a.priceSatang) ||
          a.priceSatang < 0 ||
          a.priceSatang > 10000000000 ||
          !Number.isSafeInteger(a.stock) ||
          a.stock < 1 ||
          a.stock > 100000
        )
          fail("social_invalid_product");
        Object.assign(record, {
          priceSatang: a.priceSatang,
          stock: a.stock,
          currency: "THB",
          status: "available",
        });
      }
    } else if (action === "edit") {
      record = await this.requireRecord(repo, uid, a.recordId);
      if (
        record.ownerId !== uid ||
        !["watch", "community", "listing"].includes(record.kind)
      )
        fail("social_forbidden", 403);
      record.title = str(a.title ?? record.title, 200);
      record.text = str(a.text ?? record.text, 8000);
      if (a.audience) {
        if (
          !["public", "followers", "private"].includes(a.audience) ||
          record.audience === "group"
        )
          fail("social_invalid_audience");
        record.audience = a.audience;
      }
    } else if (action === "group-create") {
      const title = str(a.title, 120);
      if (!title) fail("social_empty_post");
      record = row(
        "group",
        uid,
        { title, text: str(a.text || "", 2000), audience: "public" },
        "",
        [uid],
      );
    } else if (action === "group-join" || action === "group-leave") {
      record = await this.requireRecord(repo, uid, a.recordId, "group");
      if (action === "group-join") {
        if (record.members.length >= 200 && !record.members.includes(uid))
          fail("social_group_capacity");
        if (!record.members.includes(uid)) record.members.push(uid);
      } else {
        if (record.ownerId === uid) fail("social_group_owner_required");
        record.members = record.members.filter((x) => x !== uid);
      }
    } else if (action === "playlist-create") {
      record = row("playlist", uid, {
        title: str(a.title, 120),
        recordIds: [],
      });
    } else if (action === "playlist-add" || action === "playlist-remove") {
      record = await this.requireRecord(repo, uid, a.recordId, "playlist");
      if (action === "playlist-add") {
        const target = await this.requireRecord(repo, uid, a.targetId, "watch");
        if (record.recordIds.length >= 200) fail("social_playlist_limit");
        if (!record.recordIds.includes(target.id))
          record.recordIds.push(target.id);
      } else
        record.recordIds = record.recordIds.filter((x) => x !== a.targetId);
    } else if (action === "comment" || action === "like") {
      const target = await this.requireRecord(repo, uid, a.recordId);
      if (!["watch", "community", "listing"].includes(target.kind))
        fail("social_invalid_target");
      if (action === "comment") {
        const text = str(a.text, 2000);
        if (!text) fail("social_empty_post");
        record = row("comment", uid, { text }, target.id);
      } else {
        const rid = "like:" + key(uid, target.id),
          old = await repo.get(rid);
        if (old) await repo.remove(rid);
        else await repo.put(row("like", uid, { id: rid }, target.id));
        target.likeCount = Math.max(
          0,
          (target.likeCount || 0) + (old ? -1 : 1),
        );
        await repo.put(target);
        return { ok: true, liked: !old };
      }
    } else if (action === "follow" || action === "block") {
      if (!UUID.test(a.userId) || a.userId === uid)
        fail("social_invalid_person");
      if (action === "follow") {
        const target = await repo.get("profile:" + a.userId);
        if (!target?.discoverable || (await this.blocked(repo, uid, a.userId)))
          fail("social_not_found", 404);
      }
      const rid = action + ":" + key(uid, a.userId);
      if (a.enabled === false) {
        await repo.remove(rid);
        return { ok: true, enabled: false };
      }
      record = row(action, uid, { id: rid, targetId: a.userId });
    } else if (action === "thread") {
      if (
        !UUID.test(a.userId) ||
        a.userId === uid ||
        (await this.blocked(repo, uid, a.userId))
      )
        fail("social_not_found", 404);
      const p = await repo.get("profile:" + a.userId);
      if (!p || (a.context !== "connect" && !p.discoverable))
        fail("social_not_found", 404);
      const pair = [uid, a.userId].sort(),
        rid =
          "thread:" +
          key(...pair, a.context === "connect" ? "connect" : "social");
      const old = await repo.get(rid);
      if (old) return { ok: true, record: old };
      if (
        a.context === "connect" &&
        (!(await repo.get("interest:" + key(uid, a.userId))) ||
          !(await repo.get("interest:" + key(a.userId, uid))) ||
          !(await repo.get("connect:" + uid))?.enabled ||
          !(await repo.get("connect:" + a.userId))?.enabled)
      )
        fail("social_match_required", 403);
      record = row(
        "thread",
        uid,
        {
          id: rid,
          title: str(a.title || "Talk", 200),
          context: a.context === "connect" ? "connect" : "social",
          status: a.context === "connect" ? "accepted" : "pending",
        },
        "",
        pair,
      );
    } else if (action === "accept-thread") {
      record = await this.requireRecord(repo, uid, a.recordId, "thread");
      if (record.ownerId === uid || record.status !== "pending")
        fail("social_invitation_not_pending");
      record.status = a.accept === false ? "declined" : "accepted";
    } else if (action === "message") {
      const thread = await this.requireRecord(repo, uid, a.recordId, "thread");
      await this.threadAllowed(repo, uid, thread);
      const text = str(a.text || "", 8000);
      if (!text && !files.length) fail("social_empty_post");
      record = row("message", uid, { text, files }, thread.id);
    } else if (action === "order") {
      const product = await this.requireRecord(
        repo,
        uid,
        a.recordId,
        "listing",
      );
      if (
        product.ownerId === uid ||
        product.status !== "available" ||
        !Number.isInteger(a.quantity) ||
        a.quantity < 1 ||
        a.quantity > product.stock
      )
        fail("social_invalid_order");
      product.stock -= a.quantity;
      await repo.put(product);
      record = row(
        "order",
        uid,
        {
          listingId: product.id,
          title: product.title,
          quantity: a.quantity,
          totalSatang: product.priceSatang * a.quantity,
          currency: "THB",
          status: "requested",
          sellerId: product.ownerId,
          paymentStatus: "not_collected",
        },
        product.id,
        [uid, product.ownerId],
      );
    } else if (action === "order-status") {
      record = await this.requireRecord(repo, uid, a.recordId, "order");
      const states = {
        requested: ["accepted", "cancelled"],
        accepted: ["fulfilled", "cancelled"],
        fulfilled: [],
        cancelled: [],
      };
      if (
        !states[record.status]?.includes(a.status) ||
        (a.status !== "cancelled" && record.sellerId !== uid)
      )
        fail("social_invalid_order_state");
      if (a.status === "cancelled") {
        const p = await repo.get(record.listingId);
        if (p) {
          p.stock += record.quantity;
          await repo.put(p);
        }
      }
      record.status = a.status;
    } else if (action === "live-start") {
      if (!(await repo.get("profile:" + uid))) fail("social_profile_required");
      record = row(
        "live",
        uid,
        {
          title: str(a.title || "Live", 200),
          audience: "public",
          status: "live",
          heartbeatAt: new Date().toISOString(),
        },
        "",
        [uid],
      );
    } else if (action === "live-join") {
      record = await this.requireRecord(repo, uid, a.recordId, "live");
      if (
        record.status !== "live" ||
        Date.parse(record.heartbeatAt) < Date.now() - 60000
      )
        fail("social_live_ended");
      if (record.members.length >= 9 && !record.members.includes(uid))
        fail("social_live_capacity", 409);
      if (!record.members.includes(uid)) record.members.push(uid);
    } else if (
      action === "live-heartbeat" ||
      action === "live-end" ||
      action === "live-leave"
    ) {
      record = await this.requireRecord(repo, uid, a.recordId, "live");
      if (action === "live-leave") {
        record.members = record.members.filter((x) => x !== uid);
        if (record.ownerId === uid) record.status = "ended";
      } else {
        if (record.ownerId !== uid) fail("social_forbidden", 403);
        if (action === "live-end") record.status = "ended";
        else if (record.status === "live")
          record.heartbeatAt = new Date().toISOString();
      }
    } else if (action === "live-chat") {
      const live = await this.requireRecord(repo, uid, a.recordId, "live");
      if (
        live.status !== "live" ||
        Date.parse(live.heartbeatAt) < Date.now() - 60000 ||
        !live.members.includes(uid)
      )
        fail("social_join_required");
      record = row("live-chat", uid, { text: str(a.text, 2000) }, live.id);
    } else if (action === "call") {
      const t = await this.requireRecord(repo, uid, a.recordId, "thread");
      await this.threadAllowed(repo, uid, t);
      record = row(
        "call",
        uid,
        {
          status: "ringing",
          video: a.video === true,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        t.id,
        t.members,
      );
    } else if (action === "call-answer" || action === "call-end") {
      record = await repo.get(a.recordId);
      if (!record || record.kind !== "call" || !record.members.includes(uid))
        fail("social_not_found", 404);
      const t = await this.requireRecord(repo, uid, record.parentId, "thread");
      await this.threadAllowed(repo, uid, t);
      if (action === "call-end") record.status = "ended";
      else {
        if (
          record.ownerId === uid ||
          record.status !== "ringing" ||
          Date.parse(record.expiresAt) < Date.now()
        )
          fail("social_call_expired");
        record.status = a.accept === false ? "declined" : "accepted";
        record.heartbeats = Object.fromEntries(
          record.members.map((m) => [m, Date.now()]),
        );
        record.expiresAt = new Date(Date.now() + 60000).toISOString();
      }
    } else if (action === "call-heartbeat") {
      record = await this.rtcSession(repo, uid, a.recordId);
      record.heartbeats = { ...record.heartbeats, [uid]: Date.now() };
      record.expiresAt = new Date(Date.now() + 60000).toISOString();
    } else if (action === "signal") {
      const session = await this.rtcSession(repo, uid, a.recordId);
      if (
        !session.members.includes(a.to) ||
        a.to === uid ||
        (await this.blocked(repo, uid, a.to))
      )
        fail("social_forbidden", 403);
      if (
        session.kind === "live" &&
        uid !== session.ownerId &&
        a.to !== session.ownerId
      )
        fail("social_forbidden", 403);
      if (
        !["offer", "answer", "ice"].includes(a.type) ||
        typeof a.payload !== "object" ||
        JSON.stringify(a.payload).length > 64000
      )
        fail("social_invalid_signal");
      record = row(
        "signal",
        uid,
        {
          to: a.to,
          type: a.type,
          payload: a.payload,
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
        session.id,
      );
    } else if (action === "connect") {
      if (a.enabled !== false) {
        if (a.adultConfirmed !== true || !(await repo.get("profile:" + uid)))
          fail("social_adult_consent_required", 403);
        if (
          !["male", "female", "nonbinary", "self-described"].includes(
            a.gender,
          ) ||
          !Array.isArray(a.preferences) ||
          !a.preferences.length ||
          a.preferences.some(
            (x) =>
              ![
                "male",
                "female",
                "nonbinary",
                "self-described",
                "all",
              ].includes(x),
          )
        )
          fail("social_invalid_preferences");
      }
      record = row("connect", uid, {
        hidden: !!(await repo.get("connect:" + uid))?.hidden,
        id: "connect:" + uid,
        enabled: a.enabled !== false,
        name: str(a.name || "", 80),
        bio: str(a.bio || "", 2000),
        gender: a.gender || "",
        preferences: a.preferences || [],
        files,
        consentedAt: new Date().toISOString(),
      });
    } else if (action === "interest" || action === "pass") {
      const target = await this.requireRecord(
        repo,
        uid,
        "connect:" + a.userId,
        "connect",
      );
      record = row(action, uid, {
        id: action + ":" + key(uid, target.ownerId),
        targetId: target.ownerId,
      });
    } else if (action === "delete") {
      record = await repo.get(a.recordId);
      if (
        !record ||
        record.ownerId !== uid ||
        !["watch", "community", "listing", "comment", "message"].includes(
          record.kind,
        )
      )
        fail("social_not_found", 404);
      record.deleted = true;
      record.files = [];
      record.text = "";
      record.title = "";
    } else if (action === "report") {
      await this.requireRecord(repo, uid, a.recordId);
      record = row("report", uid, {
        targetId: a.recordId,
        reason: str(a.reason, 2000),
        status: "open",
      });
    } else if (action === "moderate") {
      if (
        !user.roles?.includes("administrator") ||
        !user.permissions?.includes("settings")
      )
        fail("social_forbidden", 403);
      record = await repo.get(a.recordId);
      if (
        !record ||
        ![
          "watch",
          "community",
          "listing",
          "live",
          "connect",
          "comment",
        ].includes(record.kind)
      )
        fail("social_not_found", 404);
      record.hidden = a.hidden !== false;
      record.moderation = {
        by: uid,
        reason: str(a.reason || "", 1000),
        at: new Date().toISOString(),
      };
    } else fail("social_unknown_action");
    await repo.put(record);
    return { ok: true, record };
  }
  async threadAllowed(repo, uid, t) {
    if (t.status !== "accepted") fail("social_thread_not_accepted", 403);
    for (const member of t.members)
      if (await this.blocked(repo, uid, member)) fail("social_not_found", 404);
    if (t.context === "connect")
      for (const member of t.members)
        if (!(await repo.get("connect:" + member))?.enabled)
          fail("social_connect_disabled", 403);
  }
  async rtcSession(repo, uid, recordId) {
    const r = await repo.get(recordId);
    if (!r || !["call", "live"].includes(r.kind) || !r.members.includes(uid))
      fail("social_not_found", 404);
    if (r.kind === "call") {
      if (
        r.status !== "accepted" ||
        Date.parse(r.expiresAt) < Date.now() ||
        r.members.some((m) => Date.now() - (r.heartbeats?.[m] || 0) > 60000)
      )
        fail("social_call_not_accepted", 403);
      const t = await this.requireRecord(repo, uid, r.parentId, "thread");
      await this.threadAllowed(repo, uid, t);
    } else if (
      !(await this.allowed(repo, uid, r)) ||
      r.status !== "live" ||
      Date.parse(r.heartbeatAt) < Date.now() - 60000
    )
      fail("social_live_ended");
    return r;
  }
  async rtc({ user, recordId }) {
    const uid = account(user),
      session = await this.rtcSession(this.repo, uid, recordId);
    const signals = (
      await this.repo.list({ kind: "signal", parent: recordId, limit: 200 })
    ).filter((x) => x.to === uid && Date.parse(x.expiresAt) > Date.now());
    return {
      ok: true,
      session,
      signals,
      iceServers: this.ice(uid),
      relayConfigured: !!(this.turnUrls && this.turnSecret),
    };
  }
  ice(uid) {
    const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    if (this.turnUrls && this.turnSecret) {
      const username = Math.floor(Date.now() / 1000 + 3600) + ":" + uid;
      iceServers.push({
        urls: this.turnUrls.split(",").filter((x) => /^turns?:/.test(x)),
        username,
        credential: createHmac("sha1", this.turnSecret)
          .update(username)
          .digest("base64"),
      });
    }
    return iceServers;
  }
  async inbox({ user }) {
    const uid = account(user);
    const calls = (
      await this.repo.list({ kind: "call", member: uid, limit: 50 })
    ).filter(
      (x) =>
        ["accepted", "ringing"].includes(x.status) &&
        Date.parse(x.expiresAt) > Date.now(),
    );
    const safe = [];
    for (const c of calls) {
      const t = await this.repo.get(c.parentId);
      if (
        t &&
        (await this.allowed(this.repo, uid, t)) &&
        !(await this.blocked(
          this.repo,
          uid,
          c.members.find((x) => x !== uid),
        ))
      )
        safe.push(c);
    }
    return {
      ok: true,
      calls: safe,
      orders: await this.repo.list({ kind: "order", member: uid, limit: 100 }),
    };
  }
  async media({ user, recordId, fileId, download = false }) {
    const uid = account(user),
      r = await this.requireRecord(this.repo, uid, recordId);
    if (!r.files?.some((f) => f.id === fileId)) fail("social_not_found", 404);
    if (r.kind === "message") {
      const t = await this.requireRecord(this.repo, uid, r.parentId, "thread");
      await this.threadAllowed(this.repo, uid, t);
    }
    return download
      ? this.files.download(r.ownerId, fileId, uid)
      : this.files.preview(r.ownerId, fileId);
  }
  async collections({ user, kind }) {
    const uid = account(user);
    if (!["group", "playlist", "block"].includes(kind))
      fail("social_invalid_collection");
    const records = await this.repo.list({
      kind,
      ...(kind === "group" ? {} : { owner: uid }),
      limit: 100,
    });
    return { ok: true, items: records.filter((r) => !r.hidden && !r.deleted) };
  }
  async reports({ user }) {
    account(user);
    if (
      !user.roles?.includes("administrator") ||
      !user.permissions?.includes("settings")
    )
      fail("social_forbidden", 403);
    return {
      ok: true,
      items: await this.repo.list({ kind: "report", limit: 100 }),
    };
  }
}
module.exports = { SocialService, MODULES, account };
