"use strict";
const { SocialNotifications, noticeId } = require("./socialNotifications");
const { moduleFor } = require("./socialContent");
const { expiresAt, expired, expiredResult } = require("./socialRetention");
const { randomUUID, createHash, createHmac } = require("node:crypto");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODULES = ["feed", "short", "watch", "live", "tv", "market", "community", "talk", "connect", "profile"];
const tv = require("./socialTv");
const { source: mediaSource } = require("../social-media-source");
const friendId = (a, b) => "friend:" + key(...[a, b].sort());
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
const groupRequestId = (groupId, userId) => "group-request:" + key(groupId, userId);
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
    accounts,
    supportAdminUsername,
    systemNotifications = null,
    turnUrls = process.env.SOCIAL_TURN_URLS,
    turnSecret = process.env.SOCIAL_TURN_SECRET,
  } = {}) {
    this.repo = repository;
    this.files = files;
    this.accounts = accounts;
    this.supportAdminUsername = supportAdminUsername;
    this.notifications = new SocialNotifications(this);
    this.systemNotifications = systemNotifications;
    this.turnUrls = turnUrls;
    this.turnSecret = turnSecret;
  }
  async init() {
    await this.repo.init();
    if (this.repo.pool || this.repo.memory) await this.purgeExpiredMessages();
  }
  async purgeExpiredMessages({ force = true } = {}) {
    if (this.retentionBusy) return this.retentionBusy;
    if (!force && Date.now() - (this.retentionAt || 0) < 60000) return;
    this.retentionBusy = this.repo.transaction(repo => repo.purgeExpiredMessages());
    try { const result = await this.retentionBusy; this.retentionAt = Date.now(); return result; }
    finally { this.retentionBusy = null; }
  }
  async support({ user }) {
    const uid = account(user);
    const admin = this.supportAdminUsername && await this.accounts?.findUserByUsername(this.supportAdminUsername);
    if (!UUID.test(admin?.id || "") || !admin.roles?.includes("administrator") || !admin.permissions?.includes("chat"))
      fail("social_support_unavailable", 503);
    if (uid === admin.id) return { ok: true, inbox: true };
    return this.repo.transaction(async repo => {
      if (await this.blocked(repo, uid, admin.id)) fail("social_support_blocked", 403);
      const rid = "thread:" + key(uid, admin.id, "support");
      const existing = await repo.get(rid);
      if (existing) {
        if (!await this.allowed(repo, uid, existing)) fail("social_not_found", 404);
        return { ok: true, record: existing };
      }
      const record = row("thread", uid, {
        id: rid, title: "ติดต่อ Panthorium", context: "support", status: "accepted", supportAdminId: admin.id,
      }, "", [uid, admin.id]);
      await repo.put(record);
      return { ok: true, record };
    });
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
    if (!record || record.deleted || record.hidden || record.kind === "signal")
      return false;
    if (await this.blocked(repo, userId, record.ownerId)) return false;
    if (record.kind === "connect") {
      const me = await repo.get("connect:" + userId);
      return (
        !!me?.enabled &&
        !me.hidden &&
        !!record.enabled &&
        userId !== record.ownerId &&
        (me.preferences.includes(record.gender) || me.preferences.includes("all")) &&
        (record.preferences.includes(me.gender) || record.preferences.includes("all"))
      );
    }
    if (record.kind === "friend") return record.members.includes(userId) && !(await this.blocked(repo, ...record.members));
    if (record.kind === "group") return true;
    if (record.kind === "group-message" || record.kind === "group-request") {
      const group = await repo.get(record.parentId);
      if (!group || !(await this.allowed(repo, userId, group))) return false;
      return record.kind === "group-message"
        ? group.members.includes(userId)
        : group.ownerId === userId || record.ownerId === userId;
    }
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
      return record.ownerId === userId;
    if (
      record.kind === "comment" ||
      record.kind === "message" ||
      record.kind === "live-chat"
    ) {
      const parent = await repo.get(record.parentId);
      return !expired(record, parent) && this.allowed(repo, userId, parent);
    }
    if (record.kind === "thread") {
      if (!record.members.includes(userId) || record.blocked) return false;
      if (record.context === "support") {
        const admin = await this.accounts?.findUserById(record.supportAdminId);
        if (!admin?.roles?.includes("administrator") || !admin.permissions?.includes("chat")) return false;
      }
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
    if (["feed", "video", "watch", "short", "community", "listing", "live"].includes(record.kind))
      return (
        record.ownerId === userId ||
        record.audience === "public" ||
        (record.audience === "friends" && (await repo.get(friendId(userId, record.ownerId)))?.status === "accepted") ||
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
        }
      : null;
  }
  async read({
    user,
    module = "community",
    recordId,
    query = "",
    before,
    mode,
  } = {}) {
    const uid = account(user);
    if (!MODULES.includes(module)) fail("social_invalid_module");
    await this.purgeExpiredMessages({ force: false });
    query = str(query, 200).toLowerCase();
    if (module === "tv" && !recordId) return tv.read(this, user, { query, mode, before });
    if (recordId) {
      const r = await this.requireRecord(this.repo, uid, recordId);
      if (r.kind === "group") return this.readGroup(uid, r, before);
      const childKind =
        r.kind === "thread"
          ? "message"
          : r.kind === "live"
            ? "live-chat"
            : "comment";
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
      const names = new Map();
      for (const child of source)
        if (await this.allowed(this.repo, uid, child))
          children.push(child.kind === "message" ? await this.messageView(child, r, names) : await this.decorate(child, uid));
      return {
        ok: true,
        record: await this.decorate(r, uid),
        items: children.reverse(),
        nextCursor: source.length === 100 ? source.at(-1).id : null,
      };
    }
    if (module === "profile") {
      const candidates = await this.repo.list({ owner: uid, kinds: ["feed", "watch", "short", "video", "community", "listing", "live"], before, limit: 100 });
      const items = [];
      for (const r of candidates) if (await this.allowed(this.repo, uid, r) && (!query || [r.title, r.text].join(" ").toLowerCase().includes(query))) items.push(await this.decorate(r, uid));
      return { ok: true, items, nextCursor: candidates.length === 100 ? candidates.at(-1).id : null };
    }
    let items = [];
    const connectChats = module === "connect" && mode === "chats";
    const kind = connectChats ? "thread" : {
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
    const threads = module === "talk" || connectChats;
    const candidates = threads ? await this.repo.threadPage({ member: uid, connect: connectChats, before }) : await this.repo.list({
      ...(["feed", "watch", "short"].includes(module) ? { kinds: module === "watch" ? ["video"] : ["feed", "watch", "short", "community"] } : { kind }),
      ...(module === "talk" || connectChats ? { member: uid } : {}),
      before,
      limit: 100,
    });
    for (const r of candidates) {
      if (["feed", "watch", "short"].includes(module) && moduleFor(r) !== module) continue;
      if (r.kind === "thread" && (r.context === "connect") !== connectChats) continue;
      if (
        !(await this.allowed(this.repo, uid, r)) ||
        (!threads && query &&
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
      if (module === "connect" && !connectChats) {
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
      const decorated = await this.decorate(r, uid);
      if (threads && query && ![decorated.peer?.name, decorated.lastMessage?.text].join(" ").toLowerCase().includes(query)) continue;
      items.push(decorated);
    }
    if (["short", "watch"].includes(module)) {
      // Rank only the current, access-checked page; stable cursor still follows creation order.
      const scores = new Map();
      for (const item of items) {
        const friend = (await this.repo.get(friendId(uid, item.ownerId)))?.status === "accepted";
        const followed = !!await this.repo.get("follow:" + key(uid, item.ownerId));
        scores.set(item.id, (followed ? 8 : 0) + (friend ? 4 : 0) + Math.min(3, Math.log2(1 + (item.likeCount || 0))) + (item.liked ? 1 : 0));
      }
      items.sort((a, b) => scores.get(b.id) - scores.get(a.id) || b.id.localeCompare(a.id));
    }
    return {
      ok: true,
      items,
      nextCursor: candidates.length === 100 ? threads ? Buffer.from(JSON.stringify({ at: candidates.at(-1)._activityAt, id: candidates.at(-1).id })).toString("base64url") : candidates.at(-1).id : null,
    };
  }
  async decorate(r, uid) {
    if (r.kind === "friend") return this.friendView(this.repo, r, uid);
    if (r.kind === "group") return this.groupView(this.repo, r, uid);
    if (r.kind === "group-message") return this.groupMessageView(r, await this.repo.get(r.parentId), uid);
    if (r.kind === "message") return this.messageView(r, await this.repo.get(r.parentId));
    const p = await this.repo.get("profile:" + r.ownerId);
    const out = { ...r, module: moduleFor(r), author: this.publicProfile(p) };
    if (["feed", "watch", "video", "short", "community", "listing", "live"].includes(r.kind) && out.author && p.files?.some(f => /^image\//.test(f.contentType))) out.author.avatarUrl = "/api/social/records/" + encodeURIComponent(r.id) + "/avatar";
    delete out._latestMessage; delete out._activityAt;
    if (r.kind === "thread") {
      const other = r.members.find(id => id !== uid);
      out.peer = { id: other, ...(await this.messageView({ ownerId: other }, r)).author };
      const latest = Object.hasOwn(r, "_latestMessage") ? r._latestMessage : await this.repo.latestMessage(r);
      out.lastMessage = latest && await this.allowed(this.repo, uid, latest)
        ? { id: latest.id, text: latest.text?.slice(0, 160) || "", ownerId: latest.ownerId, createdAt: latest.createdAt, attachmentCount: latest.files?.length || 0 }
        : null;
    }
    if (["feed", "video", "watch", "short", "community", "listing", "live"].includes(r.kind)) out.commentCount = await this.repo.commentCount(r.id, uid, r.kind === "live" ? "live-chat" : "comment");
    if (r.kind === "thread" && r.context === "connect") out.author = (await this.messageView({ ownerId: r.ownerId }, r)).author;
    if (r.kind === "thread" && r.context === "support") {
      out.author = (await this.messageView({ ownerId: r.ownerId }, r)).author;
      if (uid === r.supportAdminId) out.title = "ติดต่อสอบถาม · " + out.author.name;
    }
    if (r.kind === "connect") {
      out.author = { name: r.name };
      delete out.preferences;
      delete out.gender;
      delete out.syncProfile;
      delete out.consentedAt;
      out.matched =
        !!(await this.repo.get("interest:" + key(r.ownerId, uid))) &&
        !!(await this.repo.get("interest:" + key(uid, r.ownerId)));
    }
    if (["feed", "video", "watch", "short", "community", "listing", "live"].includes(r.kind)) {
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
        !p.hidden && !p.deleted &&
        p.name.toLowerCase().includes(query) &&
        !(await this.blocked(this.repo, uid, p.ownerId))
      )
        items.push({ ...this.publicProfile(p), friendship: await this.friendView(this.repo, await this.repo.get(friendId(uid, p.ownerId)), uid) });
    }
    return { ok: true, items: items.slice(0, 30) };
  }
  async friendView(repo, record, uid) {
    if (!record) return null;
    const other = record.members.find(id => id !== uid);
    return { id: record.id, userId: other, name: (await this.messageView({ ownerId: other })).author.name,
      status: record.status, direction: record.requesterId === uid ? "outgoing" : "incoming", updatedAt: record.updatedAt || record.createdAt };
  }
  async friends({ user, before } = {}) {
    const uid = account(user), source = await this.repo.list({ kind: "friend", member: uid, limit: 100, before }), items = [];
    for (const record of source) if (["pending", "accepted"].includes(record.status) && await this.allowed(this.repo, uid, record))
      items.push(await this.friendView(this.repo, record, uid));
    return { ok: true, items, nextCursor: source.length === 100 ? source.at(-1).id : null };
  }
  async messageView(message, thread, names = new Map()) {
    if (thread?.context === "support" && message.ownerId === thread.supportAdminId)
      return { ...message, author: { name: "แอดมิน Panthorium" } };
    if (!names.has(message.ownerId)) {
      const connect = thread?.context === "connect";
      const profile = await this.repo.get((connect ? "connect:" : "profile:") + message.ownerId);
      let name = profile?.name;
      if (!name && !connect && this.accounts) {
        const registered = await this.accounts.findUserById(message.ownerId);
        const candidate = registered?.username || "";
        // Email signups have generated account IDs, not public display names.
        if (!candidate.includes("@") && !/^account_[a-f0-9]+$/i.test(candidate) && !UUID.test(candidate)) name = candidate;
      }
      names.set(message.ownerId, name || (connect ? "สมาชิก Connect" : "สมาชิก"));
    }
    return { ...message, author: { name: names.get(message.ownerId) } };
  }
  async groupView(repo, group, uid) {
    const member = group.members.includes(uid);
    const request = member ? null : await repo.get(groupRequestId(group.id, uid));
    return { ...group, privacy: group.privacy || "open", memberCount: group.members.length,
      members: member ? group.members : [], membership: member ? "member" : ["pending", "declined"].includes(request?.status) ? request.status : "none" };
  }
  async groupMessageView(message, group, uid, names) {
    const out = await this.messageView(message, group, names);
    const readers = Object.entries(message.readBy || {}).filter(([id]) => id !== message.ownerId && group.members.includes(id));
    delete out.readBy;
    out.readCount = readers.length;
    out.readAt = message.ownerId === uid ? readers[0]?.[1] || null : message.readBy?.[uid] || null;
    return out;
  }
  async readGroup(uid, group, before) {
    const record = await this.groupView(this.repo, group, uid);
    if (!group.members.includes(uid)) return { ok: true, record, items: [], posts: [], requests: [], nextCursor: null };
    const source = await this.repo.list({ kind: "group-message", parent: group.id, limit: 100, before });
    const items = [], posts = [], requests = [], names = new Map();
    for (const message of source)
      if (await this.allowed(this.repo, uid, message)) items.push(await this.groupMessageView(message, group, uid, names));
    if (!before) {
      for (const post of await this.repo.list({ kind: "community", parent: group.id, limit: 100 }))
        if (await this.allowed(this.repo, uid, post)) posts.push(await this.decorate(post, uid));
      if (group.ownerId === uid) {
        let cursor;
        do {
          const page = await this.repo.list({ kind: "group-request", parent: group.id, limit: 200, before: cursor });
          for (const request of page) if (request.status === "pending" && !(await this.blocked(this.repo, uid, request.ownerId)))
            requests.push({ id: request.id, userId: request.ownerId, requestedAt: request.requestedAt,
              name: (await this.messageView(request, group, names)).author.name });
          cursor = page.length === 200 ? page.at(-1).id : null;
        } while (cursor);
      }
    }
    return { ok: true, record, items: items.reverse(), posts, requests, nextCursor: source.length === 100 ? source.at(-1).id : null };
  }
  async markRead({ user, recordId, messageIds } = {}) {
    const uid = account(user);
    if (!Array.isArray(messageIds) || !messageIds.length || messageIds.length > 100 ||
        messageIds.some(value => typeof value !== "string" || !/^\d{16}-[0-9a-f-]{36}$/i.test(value)))
      fail("social_invalid_messages");
    return this.repo.transaction(async repo => {
      const thread = await this.requireRecord(repo, uid, recordId);
      const group = thread.kind === "group";
      if (group) {
        if (!thread.members.includes(uid)) fail("social_not_found", 404);
      } else {
        if (thread.kind !== "thread") fail("social_not_found", 404);
        await this.threadAllowed(repo, uid, thread);
      }
      const messages = [];
      for (const messageId of new Set(messageIds)) {
        const message = await this.requireRecord(repo, uid, messageId, group ? "group-message" : "message");
        if (message.parentId !== thread.id || message.ownerId === uid || (!group && !thread.members.includes(message.ownerId)))
          fail("social_invalid_messages", 403);
        messages.push(message);
      }
      const readAt = new Date().toISOString();
      for (const message of messages) {
        if (group) {
          if (!message.readBy?.[uid]) await repo.put({ ...message, readBy: { ...message.readBy, [uid]: readAt } });
        } else if (!message.readAt) await repo.put({ ...message, readAt });
        const notice = await repo.get(noticeId(group ? "group-message" : "message", message.id, uid));
        if (notice && !notice.readAt) await repo.put({ ...notice, readAt });
      }
      return { ok: true };
    });
  }
  async write({ user, action, input = {}, requestId } = {}) {
    const uid = account(user);
    await this.purgeExpiredMessages({ force: false });
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("social_invalid_input");
    const prepared = [
      "publish",
      "message",
      "group-message",
      "listing",
      "profile",
      "connect",
    ].includes(action)
      ? await this.attachments(uid, input.fileIds)
      : [];
    if (action === "publish" && input.module === "short") {
      const videos = prepared.filter(file => /^video\/(mp4|webm)$/.test(file.contentType));
      if (videos.length !== 1 || prepared.length !== 1) fail("social_video_required");
      try {
        const file = await this.files.preview(uid, videos[0].id);
        prepared[0].durationSeconds = await require("./socialVideo").shortDuration(file.body);
      } catch (_) { fail("social_short_duration"); }
    }
    const fingerprint = key(action, JSON.stringify(input));
    if (requestId && !/^[\w:.-]{1,160}$/.test(requestId))
      fail("social_invalid_request_id");
    const committedNotices = [];
    const result = await this.repo.transaction(async (repo) => {
      const receiptId = requestId ? "receipt:" + key(uid, requestId) : null;
      if (receiptId) {
        const old = await repo.get(receiptId);
        if (old) {
          if (old.fingerprint !== fingerprint)
            fail("social_request_conflict", 409);
          if (expired(old.result?.record, await repo.get(old.result?.record?.parentId || ""))) {
            old.result = expiredResult(old.result.record); await repo.put(old);
          }
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
      await this.notifications.record(repo, uid, action, result, input, committedNotices);
      if (receiptId)
        await repo.put(
          row("receipt", uid, {
            id: receiptId,
            fingerprint,
            result:
              action === "signal"
                ? { ok: true, record: { id: result.record.id } }
                : result,
            ...(["signal", "live-heartbeat", "call-heartbeat"].includes(action)
              ? { transient: true }
              : {}),
          }),
        );
      return result;
    });
    await this.notifications.publishCommitted(committedNotices);
    return result;
  }
  async mutate(repo, uid, action, a, files, user) {
    let record;
    if (["tv-save", "tv-review", "tv-delete", "tv-favorite"].includes(action)) return tv.mutate(this, repo, user, action, a);
    if (action === "profile") {
      const name = str(a.name, 80);
      if (!name) fail("social_name_required");
      if (files.some(f => !/^image\/(png|jpeg|webp|gif)$/.test(f.contentType))) fail("social_image_required");
      const previous = await repo.get("profile:" + uid);
      record = row("profile", uid, {
        id: "profile:" + uid,
        hidden: !!previous?.hidden,
        ...(previous?.moderation ? { moderation: previous.moderation } : {}),
        name,
        bio: str(a.bio || "", 1000),
        discoverable: a.discoverable === true,
        files,
      });
      const connect = await repo.get("connect:" + uid);
      if (connect?.enabled && connect.syncProfile) await repo.put({ ...connect, name, bio: record.bio, files });
    } else if (action === "publish" || action === "listing") {
      if (!(await repo.get("profile:" + uid))) fail("social_profile_required");
      const kind = action === "listing" ? "listing" : a.module === "watch" ? "video" : a.module;
      if (!["community", "feed", "video", "short", "listing"].includes(kind))
        fail("social_invalid_module");
      const title = str(a.title || "", 200),
        text = str(a.text || "", 8000);
      const source = kind === "video" && a.sourceUrl ? mediaSource(a.sourceType, a.sourceUrl) : null;
      if (source && !["youtube", "video", "hls"].includes(source.type)) fail("social_invalid_media_url");
      if (!title && !text && !files.length && !source) fail("social_empty_post");
      if (kind === "video" && !source && !files.some(f => /^video\/(mp4|webm)$/.test(f.contentType))) fail("social_long_video_required");
      if (
        kind === "short" &&
        !files.some((f) => /^video\/(mp4|webm)$/.test(f.contentType))
      )
        fail("social_video_required");
      if (kind === "feed" && files.some(f => !/^image\/(png|jpeg|webp|gif)$/.test(f.contentType))) fail("social_feed_images_only");
      const audience = a.audience || "public";
      if (!["public", "friends", "followers", "private", "group"].includes(audience))
        fail("social_invalid_audience");
      record = row(kind, uid, { title, text, files, audience, likeCount: 0, ...(source ? { source } : {}) });
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
        !["feed", "video", "watch", "short", "community", "listing"].includes(record.kind)
      )
        fail("social_forbidden", 403);
      record.title = str(a.title ?? record.title, 200);
      record.text = str(a.text ?? record.text, 8000);
      if (record.kind === "video" && a.sourceUrl !== undefined) {
        const source = a.sourceUrl ? mediaSource(a.sourceType, a.sourceUrl) : null;
        if (source && !["youtube", "video", "hls"].includes(source.type)) fail("social_invalid_media_url");
        if (!source && !record.files.some(f => /^video\/(mp4|webm)$/.test(f.contentType))) fail("social_long_video_required");
        if (source) record.source = source;
        else delete record.source;
      }
      if (a.audience) {
        if (
          !["public", "friends", "followers", "private"].includes(a.audience) ||
          record.audience === "group"
        )
          fail("social_invalid_audience");
        record.audience = a.audience;
      }
    } else if (action === "group-create") {
      const title = str(a.title, 120);
      if (!title) fail("social_empty_post");
      const privacy = a.privacy ?? "open";
      if (!["open", "closed"].includes(privacy)) fail("social_invalid_group_privacy");
      record = row(
        "group",
        uid,
        { title, text: str(a.text || "", 2000), audience: "public", privacy },
        "",
        [uid],
      );
    } else if (action === "group-join" || action === "group-leave") {
      record = await this.requireRecord(repo, uid, a.recordId, "group");
      if (action === "group-join") {
        if (record.members.includes(uid)) return { ok: true, record: await this.groupView(repo, record, uid) };
        if (record.members.length >= 200 && !record.members.includes(uid))
          fail("social_group_capacity");
        if (record.privacy === "closed") {
          const rid = groupRequestId(record.id, uid), old = await repo.get(rid);
          const request = old?.status === "pending" ? old : row("group-request", uid, {
            id: rid, status: "pending", eventId: id(), requestedAt: new Date().toISOString(),
          }, record.id);
          await repo.put(request);
          return { ok: true, record: await this.groupView(repo, record, uid), groupRequest: request };
        }
        record.members.push(uid);
      } else {
        if (record.ownerId === uid) fail("social_group_owner_required");
        record.members = record.members.filter((x) => x !== uid);
      }
    } else if (action === "group-review" || action === "group-cancel-request") {
      record = await this.requireRecord(repo, uid, a.recordId, "group");
      if (action === "group-review" && record.ownerId !== uid) fail("social_forbidden", 403);
      if (action === "group-review" && (typeof a.accept !== "boolean" || !UUID.test(a.userId))) fail("social_invalid_input");
      const applicant = action === "group-review" ? a.userId : uid;
      const request = await repo.get(groupRequestId(record.id, applicant));
      if (!request || request.status !== "pending") fail("social_group_request_not_pending", 409);
      if (action === "group-review" && a.accept) {
        if (await this.blocked(repo, uid, applicant)) fail("social_not_found", 404);
        if (record.members.length >= 200 && !record.members.includes(applicant)) fail("social_group_capacity");
        if (!record.members.includes(applicant)) record.members.push(applicant);
      }
      request.status = action === "group-cancel-request" ? "cancelled" : a.accept ? "accepted" : "declined";
      request.reviewedAt = new Date().toISOString();
      await repo.put(request);
      await repo.put(record);
      return { ok: true, record: await this.groupView(repo, record, uid), groupRequest: request };
    } else if (action === "group-message") {
      const group = await this.requireRecord(repo, uid, a.recordId, "group");
      if (!group.members.includes(uid)) fail("social_join_required", 403);
      const text = str(a.text || "", 8000);
      if (!text && !files.length) fail("social_empty_post");
      record = row("group-message", uid, { text, files }, group.id);
    } else if (action === "playlist-create") {
      record = row("playlist", uid, {
        title: str(a.title, 120),
        recordIds: [],
      });
    } else if (action === "playlist-add" || action === "playlist-remove") {
      record = await this.requireRecord(repo, uid, a.recordId, "playlist");
      if (action === "playlist-add") {
        const target = await this.requireRecord(repo, uid, a.targetId);
        if (!["short", "watch"].includes(moduleFor(target))) fail("social_video_required");
        if (record.recordIds.length >= 200) fail("social_playlist_limit");
        if (!record.recordIds.includes(target.id))
          record.recordIds.push(target.id);
      } else
        record.recordIds = record.recordIds.filter((x) => x !== a.targetId);
    } else if (action === "share") {
      const target = await this.requireRecord(repo, uid, a.recordId);
      if (!["feed", "video", "watch", "short", "community", "listing", "live"].includes(target.kind)) fail("social_forbidden", 403);
      record = row("share", uid, {}, target.id);
    } else if (action === "comment" || action === "like") {
      const target = await this.requireRecord(repo, uid, a.recordId);
      if (!["feed", "video", "watch", "short", "community", "listing", "live"].includes(target.kind) || (target.kind === "live" && action !== "like"))
        fail("social_invalid_target");
      if (action === "comment") {
        const text = str(a.text, 2000);
        if (!text) fail("social_empty_post");
        record = row("comment", uid, { text }, target.id);
      } else {
        const rid = "like:" + key(uid, target.id),
          old = await repo.get(rid);
        if (old && a.enabled === true) return { ok: true, liked: true, likeCount: target.likeCount || 0 };
        if (old) await repo.remove(rid);
        else await repo.put(row("like", uid, { id: rid }, target.id));
        target.likeCount = Math.max(
          0,
          (target.likeCount || 0) + (old ? -1 : 1),
        );
        await repo.put(target);
        return { ok: true, liked: !old, likeCount: target.likeCount };
      }
    } else if (action === "friend-request") {
      if (!UUID.test(a.userId) || a.userId === uid || await this.blocked(repo, uid, a.userId)) fail("social_not_found", 404);
      const target = await repo.get("profile:" + a.userId);
      if (!target?.discoverable || target.hidden || target.deleted) fail("social_not_found", 404);
      const rid = friendId(uid, a.userId), old = await repo.get(rid);
      if (old && ["pending", "accepted"].includes(old.status)) return { ok: true, record: old };
      const members = [uid, a.userId].sort();
      record = row("friend", members[0], { id: rid, requesterId: uid, recipientId: a.userId, status: "pending", eventId: id() }, "", members);
    } else if (["friend-review", "friend-cancel", "friend-remove"].includes(action)) {
      record = await this.requireRecord(repo, uid, a.recordId, "friend");
      if (action === "friend-review") {
        if (record.recipientId !== uid) fail("social_forbidden", 403);
        if (record.status !== "pending" || typeof a.accept !== "boolean") fail("social_invitation_not_pending");
        record.status = a.accept ? "accepted" : "declined";
        if (a.accept) {
          const thread = await repo.get("thread:" + key(...[...record.members].sort(), "social"));
          if (thread && ["pending", "declined"].includes(thread.status)) await repo.put({ ...thread, status: "accepted" });
        }
      } else if (action === "friend-cancel") {
        if (record.requesterId !== uid || record.status !== "pending") fail("social_forbidden", 403);
        record.status = "cancelled";
      } else {
        if (record.status !== "accepted") fail("social_invitation_not_pending");
        record.status = "removed";
      }
      record.updatedAt = new Date().toISOString();
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
      const friends = (await repo.get(friendId(uid, a.userId)))?.status === "accepted";
      if (!p || p.hidden || p.deleted || (a.context !== "connect" && !p.discoverable && !friends))
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
          title: str(a.title || (a.context === "connect" ? "บทสนทนา Connect" : "Chat"), 200),
          context: a.context === "connect" ? "connect" : "social",
          status: a.context === "connect" || friends ? "accepted" : "pending",
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
      if (thread.context !== "connect") record.expiresAt = expiresAt(record);
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
      const text = str(a.text, 2000);
      if (!text) fail("social_empty_post");
      record = row("live-chat", uid, { text }, live.id);
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
      const ownProfile = await repo.get("profile:" + uid);
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
        name: str(a.syncProfile ? ownProfile?.name || "" : a.name || "", 80),
        bio: str(a.syncProfile ? ownProfile?.bio || "" : a.bio || "", 2000),
        gender: a.gender || "",
        preferences: a.preferences || [],
        files: a.syncProfile ? (ownProfile?.files || []).filter(f => /^image\//.test(f.contentType)) : files,
        syncProfile: a.syncProfile === true,
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
        !["feed", "video", "watch", "short", "community", "listing", "comment", "message", "group-message", "live-chat"].includes(
          record.kind,
        )
      )
        fail("social_not_found", 404);
      record.deleted = true;
      record.files = [];
      record.text = "";
      record.title = "";
      delete record.source;
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
          "feed",
          "video",
          "watch",
          "short",
          "profile",
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
    return { ok: true, record: record.kind === "group" ? await this.groupView(repo, record, uid) : record };
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
        safe.push({ ...c, context: t.context, author: (await this.messageView(c, t)).author });
    }
    return {
      ok: true,
      calls: safe,
      orders: await this.repo.list({ kind: "order", member: uid, limit: 100 }),
    };
  }
  async avatar({ user, recordId }) {
    const uid = account(user), r = await this.requireRecord(this.repo, uid, recordId);
    if (!["feed", "watch", "video", "short", "community", "listing", "live"].includes(r.kind)) fail("social_not_found", 404);
    const p = await this.repo.get("profile:" + r.ownerId), file = p?.files?.find(f => /^image\/(png|jpeg|webp|gif)$/.test(f.contentType));
    if (!file) fail("social_not_found", 404);
    return this.files.preview(r.ownerId, file.id);
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
  async collections({ user, kind, scope, before, query = "" }) {
    const uid = account(user);
    if (!["group", "playlist", "block"].includes(kind))
      fail("social_invalid_collection");
    query = str(query, 200).toLowerCase();
    const records = await this.repo.list({
      kind,
      ...(kind === "group" ? scope === "mine" ? { member: uid } : {} : { owner: uid }),
      before,
      limit: 100,
    });
    const items = [];
    for (const record of records) if (await this.allowed(this.repo, uid, record) && (!query || [record.title, record.text].join(" ").toLowerCase().includes(query)))
      items.push(kind === "group" ? await this.groupView(this.repo, record, uid) : record);
    return { ok: true, items, nextCursor: records.length === 100 ? records.at(-1).id : null };
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
