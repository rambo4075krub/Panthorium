"use strict";
const { createHash } = require("node:crypto");
const hash = (...parts) => createHash("sha256").update(parts.join(":")).digest("hex");
const noticeId = (type, sourceId, recipient) => "notification:" + hash(type, sourceId, recipient);
const { moduleFor } = require("./socialContent");
class SocialNotifications {
  constructor(service) { this.service = service; }
  async emit(repo, type, source, actorId, recipient, targetId = source.id) {
    if (!recipient || actorId === recipient || await this.service.blocked(repo, actorId, recipient)) return;
    const id = noticeId(type, source.id, recipient);
    if (await repo.get(id)) return;
    await repo.put({ id, kind: "notification", ownerId: recipient, actorId, type, sourceId: source.id, targetId, createdAt: new Date().toISOString() });
  }
  async record(repo, uid, action, result, input) {
    const r = result.record;
    if (action === "like" && result.liked) {
      const target = await repo.get(input.recordId);
      return this.emit(repo, "like", { id: "like:" + hash(uid, target.id) }, uid, target.ownerId, target.id);
    }
    if (!r) return;
    if (action === "friend-request" && r.status === "pending") {
      await this.emit(repo, "friend-request", { id: r.eventId }, r.requesterId, r.recipientId, r.id);
    } else if (action === "friend-review") {
      await this.emit(repo, "friend-" + r.status, { id: r.eventId }, uid, r.requesterId, r.id);
    } else if (action === "group-join" && result.groupRequest) {
      await this.emit(repo, "group-request", { id: result.groupRequest.eventId }, uid, r.ownerId, r.id);
    } else if (action === "group-review") {
      await this.emit(repo, "group-" + result.groupRequest.status, { id: result.groupRequest.eventId }, uid, result.groupRequest.ownerId, r.id);
    } else if (action === "group-message") {
      const group = await repo.get(r.parentId);
      for (const member of group.members) await this.emit(repo, "group-message", r, uid, member);
    } else if (action === "thread") {
      if (r.status === "pending") await this.emit(repo, "thread-request", r, r.ownerId, r.members.find(x => x !== r.ownerId));
    } else if (action === "accept-thread") {
      await this.emit(repo, "thread-" + r.status, r, uid, r.ownerId);
    } else if (action === "message" || action === "call") {
      const thread = await repo.get(r.parentId);
      await this.emit(repo, action, r, uid, thread.members.find(x => x !== uid));
    } else if (action === "comment") {
      const target = await repo.get(r.parentId);
      await this.emit(repo, "comment", r, uid, target.ownerId);
    } else if (action === "follow") {
      await this.emit(repo, "follow", r, uid, r.targetId, "profile:" + uid);
    } else if (action === "order" || action === "order-status") {
      const type = "order-" + r.status;
      for (const member of r.members) await this.emit(repo, type, r, uid, member);
    } else if (action === "interest" && await repo.get("interest:" + hash(input.userId, uid))) {
      const pair = { id: [uid, input.userId].sort().join(":") };
      await this.emit(repo, "connect-match", pair, uid, input.userId, "connect:" + uid);
      await this.emit(repo, "connect-match", pair, input.userId, uid, "connect:" + input.userId);
    } else if ((action === "live-end" || action === "live-leave") && r.status === "ended") {
      for (const member of r.members) await this.emit(repo, "live-ended", r, uid, member);
    } else if (action === "moderate") {
      // Only the owner receives the decision; no reporter identity is disclosed.
      await this.emit(repo, r.hidden ? "moderation-hidden" : "moderation-restored", r, uid, r.ownerId);
    }
  }
  async seed(repo, uid) {
    const marker = "notification-init:" + uid;
    if (await repo.get(marker)) return;
    let before;
    do {
      const threads = await repo.list({ kind: "thread", member: uid, limit: 200, before });
      for (const thread of threads) {
        if (!await this.service.allowed(repo, uid, thread)) continue;
        if (thread.status === "pending") await this.emit(repo, "thread-request", thread, thread.ownerId, uid);
        if (thread.status === "accepted") {
          // Match the existing chat history window; do not resurrect read messages.
          const messages = await repo.list({ kind: "message", parent: thread.id, limit: 100 });
          for (const message of messages) if (!message.readAt && await this.service.allowed(repo, uid, message))
            await this.emit(repo, "message", message, message.ownerId, uid);
        }
      }
      before = threads.length === 200 ? threads.at(-1).id : null;
    } while (before);
    for (const call of await repo.list({ kind: "call", member: uid, limit: 50 }))
      if (call.status === "ringing") await this.emit(repo, "call", call, call.ownerId, uid);
    await repo.put({ id: marker, kind: "notification-init", ownerId: uid, createdAt: new Date().toISOString() });
  }
  async view(repo, uid, n, names = { social: new Map(), connect: new Map() }) {
    if (n?.kind !== "notification" || n.ownerId !== uid) return null;
    const s = this.service, r = await repo.get(n.targetId);
    if (!r || await s.blocked(repo, uid, n.actorId)) return null;
    const moderation = n.type.startsWith("moderation-");
    let thread, target = r, type = n.type, module = moduleFor(r), readAt = n.readAt || null;
    if (r.kind === "call") {
      thread = await repo.get(r.parentId);
      if (!r.members.includes(uid) || !await s.allowed(repo, uid, thread)) return null;
      target = thread;
      if (r.status === "accepted" || r.heartbeats) return null;
      type = r.status === "ringing" && Date.parse(r.expiresAt) > Date.now() ? "call" : "call-missed";
    } else if (n.type === "follow") {
      if (!r.discoverable || r.hidden || r.deleted || !await repo.get(n.sourceId)) return null;
    } else if (moderation) {
      if (r.ownerId !== uid || (type === "moderation-hidden") !== !!r.hidden) return null;
    } else {
      if (!await s.allowed(repo, uid, r)) return null;
      if (r.kind === "message" || r.kind === "comment" || r.kind === "group-message") target = await repo.get(r.parentId);
      if (r.kind === "message") { thread = target; readAt ||= r.readAt || null; }
      if (r.kind === "group-message") readAt ||= r.readBy?.[uid] || null;
      if (r.kind === "thread") thread = r;
    }
    if (["group-request", "group-accepted", "group-declined"].includes(type)) {
      if (r.kind !== "group") return null;
      const applicant = type === "group-request" ? n.actorId : uid;
      const request = await repo.get("group-request:" + hash(r.id, applicant));
      const status = type === "group-request" ? "pending" : type === "group-accepted" ? "accepted" : "declined";
      if (request?.status !== status || request.eventId !== n.sourceId || (type === "group-request" && r.ownerId !== uid)) return null;
      if (type === "group-accepted" && !r.members.includes(uid)) return null;
    }
    if (type === "thread-request" && r.status !== "pending") return null;
    if (type.startsWith("friend-")) {
      const expected = type === "friend-request" ? "pending" : type.slice(7);
      if (r.kind !== "friend" || r.eventId !== n.sourceId || r.status !== expected) return null;
    }
    if (type === "follow" && !await repo.get(n.sourceId)) return null;
    if (type === "like" && !await repo.get(n.sourceId)) return null;
    if (type === "connect-match" && (!await repo.get("interest:" + hash(uid, n.actorId)) || !await repo.get("interest:" + hash(n.actorId, uid)))) return null;
    const context = thread?.context === "connect" || type === "connect-match" ? "connect" : "social";
    const name = moderation ? "ระบบดูแลชุมชน" : (await s.messageView({ ownerId: n.actorId }, { context }, names[context])).author.name;
    const labels = {
      "thread-request": "ส่งคำขอสนทนาถึงคุณ", "thread-accepted": "ตอบรับคำขอสนทนาของคุณแล้ว", "thread-declined": "ปฏิเสธคำขอสนทนาของคุณ",
      "friend-request": "ส่งคำขอเป็นเพื่อน", "friend-accepted": "ตอบรับคำขอเป็นเพื่อนแล้ว", "friend-declined": "ปฏิเสธคำขอเป็นเพื่อน",
      "group-request": "ขอเข้าร่วมกลุ่ม “" + r.title + "”", "group-accepted": "อนุมัติให้คุณเข้าร่วมกลุ่ม “" + r.title + "” แล้ว",
      "group-declined": "ไม่อนุมัติคำขอเข้าร่วมกลุ่ม “" + r.title + "”", "group-message": "ส่งข้อความใหม่ในกลุ่ม “" + target.title + "”",
      message: "ส่งข้อความใหม่ถึงคุณ", call: r.video ? "กำลังวิดีโอคอลหาคุณ" : "กำลังโทรหาคุณ", "call-missed": "สายที่ไม่ได้รับ",
      comment: "แสดงความคิดเห็นในโพสต์ของคุณ", like: "ถูกใจโพสต์ของคุณ", follow: "เริ่มติดตามคุณ",
      "order-requested": "ส่งคำขอสั่งซื้อใหม่", "order-accepted": "ยืนยันคำสั่งซื้อแล้ว", "order-fulfilled": "ดำเนินการคำสั่งซื้อเสร็จแล้ว", "order-cancelled": "ยกเลิกคำสั่งซื้อแล้ว",
      "connect-match": "สนใจตรงกับคุณใน Connect", "live-ended": "จบการถ่ายทอดสดแล้ว", "moderation-hidden": "ซ่อนเนื้อหาของคุณ", "moderation-restored": "คืนการแสดงเนื้อหาของคุณแล้ว",
    };
    if (!labels[type]) return null;
    module = context === "connect" ? "connect" : type === "follow" ? "friends" : moduleFor(target);
    return { id: n.id, type, name, text: labels[type], createdAt: n.createdAt, readAt,
      target: moderation && r.hidden ? null : { module, ...(["friends", "profile"].includes(module) ? {} : { recordId: target.id }), ...(r.kind === "order" ? { orders: true } : {}) },
      ...(moderation ? { reason: r.moderation?.reason || "" } : {}), module };
  }
  async list(uid, before, module) {
    await this.service.purgeExpiredMessages({ force: false });
    if (module && !["watch", "short", "live", "market", "community", "talk", "connect", "profile", "friends"].includes(module))
      throw Object.assign(Error("social_invalid_module"), { status: 400 });
    const repo = this.service.repo;
    if (!await repo.get("notification-init:" + uid)) await repo.transaction(tx => this.seed(tx, uid));
    let cursor;
    if (before) {
      cursor = await repo.get(before);
      if (cursor?.kind !== "notification" || cursor.ownerId !== uid) throw Object.assign(Error("social_not_found"), { status: 404 });
    }
    const items = [], viewed = new Map(), names = { social: new Map(), connect: new Map() };
    const visibleNotice = async n => {
      if (!viewed.has(n.id)) viewed.set(n.id, await this.view(repo, uid, n, names));
      return viewed.get(n.id);
    };
    let nextCursor = null;
    // Skip revoked/deleted records before choosing a full visible page.
    while (items.length < 31) {
      const page = await repo.notificationPage({ owner: uid, before: cursor, limit: 100 });
      for (const n of page) {
        const visible = await visibleNotice(n);
        if (visible && (!module || visible.module === module)) items.push(visible);
        if (items.length === 31) break;
      }
      if (items.length === 31 || page.length < 100) break;
      cursor = page.at(-1);
    }
    if (items.length > 30) { items.pop(); nextCursor = items.at(-1).id; }
    let unreadCount = 0, unreadCursor;
    const counts = {};
    do {
      const page = await repo.notificationPage({ owner: uid, unread: true, before: unreadCursor, limit: 200 });
      for (const n of page) {
        const visible = await visibleNotice(n);
        if (visible && !visible.readAt) { unreadCount++; counts[visible.module] = (counts[visible.module] || 0) + 1; }
      }
      unreadCursor = page.length === 200 ? page.at(-1) : null;
    } while (unreadCursor);
    return { ok: true, items, nextCursor, unreadCount, counts };
  }
  async read(uid, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(x => typeof x !== "string" || !/^notification:[a-f0-9]{64}$/.test(x)))
      throw Object.assign(Error("social_invalid_notifications"), { status: 400 });
    return this.service.repo.transaction(async repo => {
      const records = [];
      for (const id of new Set(ids)) {
        const n = await repo.get(id);
        if (!await this.view(repo, uid, n)) throw Object.assign(Error("social_not_found"), { status: 404 });
        records.push(n);
      }
      for (const n of records) if (!n.readAt) await repo.put({ ...n, readAt: new Date().toISOString() });
      return { ok: true };
    });
  }
}
module.exports = { SocialNotifications, noticeId };
