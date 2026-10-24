"use strict";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService");
async function suite(repo) {
  await repo.init();
  const users = Array.from({ length: 4 }, () => ({ sub: randomUUID(), roles: ["user"], permissions: ["chat"] }));
  const [owner, member, third, outsider] = users;
  const fileId = randomUUID(), previewCalls = [], downloads = [];
  const files = {
    findObject: async (uid, id) => {
      if (uid !== owner.sub || id !== fileId) throw Error("file_not_found");
      return { id, name: "group.png", contentType: "image/png", size: 10 };
    },
    preview: async (uid, id) => { previewCalls.push({ uid, id }); return { ...(await files.findObject(uid, id)), body: Buffer.from("group file") }; },
    download: async (uid, id, viewer) => { downloads.push({ uid, id, viewer }); return files.preview(uid, id); },
  };
  const service = new SocialService({ repository: repo, files });
  const write = (user, action, input, requestId = randomUUID()) => service.write({ user, action, input, requestId });
  const read = (user, id, before) => service.read({ user, recordId: id, before });
  const alerts = user => service.notifications.list(user.sub);
  for (const [i, user] of users.entries()) await write(user, "profile", { name: "สมาชิก " + i, discoverable: true });
  const closed = (await write(owner, "group-create", { title: "กลุ่มปิด", privacy: "closed" })).record;
  assert.equal(closed.membership, "member");
  await assert.rejects(write(owner, "group-create", { title: "invalid", privacy: "secret" }), /social_invalid_group_privacy/);
  const message = (await write(owner, "group-message", { recordId: closed.id, text: "เฉพาะสมาชิก", fileIds: [fileId] })).record;
  const post = (await write(owner, "publish", { module: "community", audience: "group", groupId: closed.id, text: "โพสต์เดิม", fileIds: [fileId] })).record;
  const publicMetadata = await read(outsider, closed.id);
  assert.deepEqual(publicMetadata.items, []); assert.deepEqual(publicMetadata.posts, []);
  assert.deepEqual(publicMetadata.record.members, []); assert.equal(publicMetadata.record.memberCount, 1);
  const listed = (await service.collections({ user: outsider, kind: "group" })).items.find(x => x.id === closed.id);
  assert.deepEqual(listed.members, []);
  for (const user of [member, outsider]) {
    await assert.rejects(read(user, message.id), /social_not_found/);
    await assert.rejects(read(user, post.id), /social_not_found/);
    await assert.rejects(write(user, "group-message", { recordId: closed.id, text: "bypass" }), /social_join_required/);
    await assert.rejects(service.media({ user, recordId: message.id, fileId }), /social_not_found/);
    await assert.rejects(service.markRead({ user, recordId: closed.id, messageIds: [message.id] }), /social_not_found/);
  }
  assert.equal(previewCalls.length, 0, "unauthorized readers never reach file storage");
  const [first, retry] = await Promise.all([
    write(member, "group-join", { recordId: closed.id }), write(member, "group-join", { recordId: closed.id }),
  ]);
  assert.equal(first.groupRequest.eventId, retry.groupRequest.eventId, "concurrent requests deduplicate");
  assert.equal(first.record.membership, "pending");
  assert.deepEqual(first.record.members, []);
  assert.equal((await read(owner, closed.id)).requests.length, 1);
  assert.equal((await read(member, closed.id)).requests.length, 0);
  assert.equal((await alerts(owner)).items.filter(x => x.type === "group-request").length, 1);
  await assert.rejects(write(member, "group-review", { recordId: closed.id, userId: member.sub, accept: true }), /social_forbidden/);
  await assert.rejects(write({ ...third, roles: ["administrator"], permissions: ["chat", "settings"] }, "group-review", { recordId: closed.id, userId: member.sub, accept: true }), /social_forbidden/);
  await assert.rejects(write(owner, "group-review", { recordId: closed.id, userId: third.sub, accept: true }), /social_group_request_not_pending/);
  await write(owner, "group-review", { recordId: closed.id, userId: member.sub, accept: false });
  assert.equal((await read(member, closed.id)).record.membership, "declined");
  assert((await alerts(member)).items.some(x => x.type === "group-declined"));
  assert.equal((await alerts(owner)).items.filter(x => x.type === "group-request").length, 0);
  const next = await write(member, "group-join", { recordId: closed.id });
  assert.notEqual(next.groupRequest.eventId, first.groupRequest.eventId);
  assert.equal((await alerts(owner)).items.filter(x => x.type === "group-request").length, 1);
  await write(member, "group-cancel-request", { recordId: closed.id });
  assert.equal((await read(member, closed.id)).record.membership, "none");
  assert.equal((await alerts(owner)).items.filter(x => x.type === "group-request").length, 0);
  await write(member, "group-join", { recordId: closed.id });
  const results = await Promise.allSettled([
    write(owner, "group-review", { recordId: closed.id, userId: member.sub, accept: true }),
    write(owner, "group-review", { recordId: closed.id, userId: member.sub, accept: false }),
  ]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1, "only one concurrent review applies");
  // Independent PostgreSQL transactions can acquire the lock in either order.
  // The stored membership must match the single successful decision.
  const accepted = results[0].status === "fulfilled";
  const rejected = results.find(x => x.status === "rejected");
  assert.match(rejected.reason.message, /social_group_request_not_pending/);
  assert.equal((await read(member, closed.id)).record.membership, accepted ? "member" : "declined");
  assert.equal(results[accepted ? 0 : 1].value.groupRequest.status, accepted ? "accepted" : "declined");
  if (!accepted) {
    await assert.rejects(read(member, message.id), /social_not_found/);
    await assert.rejects(service.media({ user: member, recordId: message.id, fileId }), /social_not_found/);
    await write(member, "group-join", { recordId: closed.id });
    await write(owner, "group-review", { recordId: closed.id, userId: member.sub, accept: true });
  }
  assert.equal((await read(member, closed.id)).record.membership, "member");
  assert.equal((await read(member, closed.id)).items[0].text, "เฉพาะสมาชิก");
  assert.equal((await read(member, closed.id)).posts[0].text, "โพสต์เดิม");
  assert((await alerts(member)).items.some(x => x.type === "group-accepted"));
  await service.media({ user: member, recordId: message.id, fileId, download: true });
  assert.deepEqual(downloads[0], { uid: owner.sub, id: fileId, viewer: member.sub });
  await assert.rejects(write(member, "group-message", { recordId: closed.id, fileIds: [fileId] }), /file_not_found/);
  await assert.rejects(write(member, "group-message", { recordId: closed.id, text: " " }), /social_empty_post/);
  await write(third, "group-join", { recordId: closed.id });
  await write(owner, "group-review", { recordId: closed.id, userId: third.sub, accept: true });
  assert.deepEqual((await read(member, closed.id)).requests, [], "regular members cannot read admission requests");
  const sent = (await write(owner, "group-message", { recordId: closed.id, fileIds: [fileId] })).record;
  const ownerAlertCount = (await alerts(owner)).unreadCount;
  for (const user of [member, third]) assert((await alerts(user)).items.some(x => x.type === "group-message" && x.target.recordId === closed.id));
  assert.equal((await alerts(outsider)).unreadCount, 0);
  assert.equal((await alerts(owner)).unreadCount, ownerAlertCount);
  const otherGroup = (await write(owner, "group-create", { title: "เปิด", privacy: "open" })).record;
  await write(member, "group-join", { recordId: otherGroup.id });
  const unrelated = (await write(owner, "group-message", { recordId: otherGroup.id, text: "other" })).record;
  await assert.rejects(service.markRead({ user: member, recordId: closed.id, messageIds: [sent.id, unrelated.id] }), /social_invalid_messages/);
  assert.equal((await repo.get(sent.id)).readBy, undefined, "invalid batch rolls back all read changes");
  await service.markRead({ user: member, recordId: closed.id, messageIds: [sent.id] });
  const ownerView = (await read(owner, sent.id)).record;
  assert.equal(ownerView.readCount, 1); assert(ownerView.readAt); assert.equal(ownerView.readBy, undefined);
  assert.equal((await read(third, sent.id)).record.readAt, null, "one member reading does not mark another member read");
  await service.markRead({ user: third, recordId: closed.id, messageIds: [sent.id] });
  assert.equal((await read(owner, sent.id)).record.readCount, 2);
  await assert.rejects(service.markRead({ user: owner, recordId: closed.id, messageIds: [sent.id] }), /social_invalid_messages/);
  await write(member, "group-leave", { recordId: closed.id });
  assert.equal((await read(member, closed.id)).record.membership, "none");
  await assert.rejects(service.media({ user: member, recordId: sent.id, fileId, download: true }), /social_not_found/);
  await assert.rejects(read(member, sent.id), /social_not_found/);
  assert.equal((await alerts(member)).items.filter(x => x.target?.recordId === closed.id).length, 0);
  await assert.rejects(write(owner, "group-leave", { recordId: closed.id }), /social_group_owner_required/);
  await write(member, "group-join", { recordId: closed.id });
  assert.equal((await read(member, closed.id)).record.membership, "pending", "leaving closed group requires fresh approval");
  const legacy = { ...(await repo.get(otherGroup.id)) }; delete legacy.privacy; await repo.put(legacy);
  assert.equal((await write(third, "group-join", { recordId: legacy.id })).record.membership, "member", "existing groups remain open");
  const template = await repo.get(unrelated.id);
  for (let i = 0; i < 105; i++) await repo.put({ ...template, id: String(Date.now() + i + 1000).padStart(16, "0") + "-" + randomUUID(), text: "history " + i });
  const page = await read(member, otherGroup.id);
  assert.equal(page.items.length, 100); assert(page.nextCursor);
  const older = await read(member, otherGroup.id, page.nextCursor);
  assert.equal(older.items.length, 6); assert(!older.nextCursor);
  assert(!page.items.some(x => older.items.some(y => y.id === x.id)));
  await write(owner, "block", { userId: third.sub, enabled: true });
  assert(!(await service.collections({ user: third, kind: "group" })).items.some(x => x.id === closed.id));
  await assert.rejects(read(third, closed.id), /social_not_found/);
  console.log("Community groups: creator-only closed admission, concurrent requests/reviews, private files/history, per-member receipts, notifications, leave revocation and legacy open groups passed");
}
if (require.main === module) suite(new SocialRepository({ allowMemory: true })).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { suite };
