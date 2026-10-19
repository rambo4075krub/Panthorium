"use strict";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService");
async function suite(repository) {
  await repository.init();
  const a = { sub: randomUUID(), roles: ["user"], permissions: ["chat"] },
    b = { ...a, sub: randomUUID() },
    c = { ...a, sub: randomUUID() },
    admin = {
      ...c,
      roles: ["administrator"],
      permissions: ["chat", "settings"],
    };
  const image = randomUUID(),
    video = randomUUID();
  const assets = new Map([
    [
      a.sub + image,
      { id: image, name: "photo.png", size: 12, contentType: "image/png" },
    ],
    [
      a.sub + video,
      { id: video, name: "clip.mp4", size: 20, contentType: "video/mp4" },
    ],
  ]);
  let reads = 0;
  const downloads = [];
  const files = {
    findObject: async (uid, id) => {
      const f = assets.get(uid + id);
      if (!f) throw Object.assign(Error("file_not_found"), { status: 404 });
      return f;
    },
    preview: async (uid, id) => {
      reads++;
      return {
        ...(await files.findObject(uid, id)),
        body: Buffer.from("private"),
      };
    },
    download: async (owner, id, viewer) => {
      downloads.push({ owner, id, viewer });
      return files.preview(owner, id);
    },
  };
  const service = new SocialService({
    repository,
    files,
    turnUrls: "turn:relay.test:3478",
    turnSecret: "test-secret",
  });
  const write = (user, action, input = {}, requestId = randomUUID()) =>
    service.write({ user, action, input, requestId });
  for (const user of [a, b, c])
    await write(user, "profile", {
      name: "Person " + user.sub,
      bio: "test",
      discoverable: true,
    });
  await assert.rejects(
    () => service.read({ user: { ...a, roles: ["guest"] } }),
    /account_required/,
  );
  await assert.rejects(
    () =>
      write(b, "publish", {
        module: "community",
        text: "stolen",
        fileIds: [image],
      }),
    /file_not_found/,
  );
  const post = (
    await write(a, "publish", {
      module: "community",
      title: "<img onerror=x>",
      text: "hello",
      fileIds: [image],
      audience: "private",
    })
  ).record;
  assert.equal(
    (await service.read({ user: b, module: "community" })).items.length,
    0,
  );
  await assert.rejects(
    () => service.media({ user: b, recordId: post.id, fileId: image }),
    /social_not_found/,
  );
  assert.equal(reads, 0);
  const watch = (
    await write(a, "publish", {
      module: "watch",
      title: "movie",
      fileIds: [video],
    })
  ).record;
  assert.equal(
    (await service.read({ user: b, module: "watch" })).items.length,
    1,
  );
  await service.media({
    user: b,
    recordId: watch.id,
    fileId: video,
    download: true,
  });
  assert.deepEqual(downloads[0], { owner: a.sub, id: video, viewer: b.sub });
  const group = (await write(a, "group-create", { title: "Team group" }))
    .record;
  await assert.rejects(
    () =>
      write(b, "publish", {
        module: "community",
        text: "outside",
        audience: "group",
        groupId: group.id,
      }),
    /social_join_required/,
  );
  await write(b, "group-join", { recordId: group.id });
  const grouped = (
    await write(b, "publish", {
      module: "community",
      text: "members only",
      audience: "group",
      groupId: group.id,
    })
  ).record;
  assert.equal(
    (await service.read({ user: a, recordId: group.id })).items.length,
    1,
  );
  await assert.rejects(
    () => service.read({ user: c, recordId: grouped.id }),
    /social_not_found/,
  );
  await write(b, "group-leave", { recordId: group.id });
  await assert.rejects(
    () => service.read({ user: b, recordId: grouped.id }),
    /social_not_found/,
  );
  const playlist = (await write(b, "playlist-create", { title: "Saved" }))
    .record;
  await write(b, "playlist-add", { recordId: playlist.id, targetId: watch.id });
  assert.equal(
    (await service.read({ user: b, recordId: playlist.id })).items.length,
    1,
  );
  await assert.rejects(
    () => service.read({ user: c, recordId: playlist.id }),
    /social_not_found/,
  );
  await write(a, "edit", { recordId: watch.id, audience: "private" });
  assert.equal(
    (await service.read({ user: b, recordId: playlist.id })).items.length,
    0,
  );
  await write(a, "edit", { recordId: watch.id, audience: "public" });
  const followerPost = (
    await write(a, "publish", {
      module: "community",
      text: "followers",
      audience: "followers",
    })
  ).record;
  await assert.rejects(
    () => service.read({ user: b, recordId: followerPost.id }),
    /social_not_found/,
  );
  await write(b, "follow", { userId: a.sub });
  assert.equal(
    (await service.read({ user: b, recordId: followerPost.id })).record.id,
    followerPost.id,
  );
  await write(b, "follow", { userId: a.sub, enabled: false });
  await assert.rejects(
    () => service.read({ user: b, recordId: followerPost.id }),
    /social_not_found/,
  );
  const repeat = randomUUID();
  const first = await write(
    b,
    "comment",
    { recordId: watch.id, text: "nice" },
    repeat,
  );
  const second = await write(
    b,
    "comment",
    { recordId: watch.id, text: "nice" },
    repeat,
  );
  assert.equal(first.record.id, second.record.id);
  await assert.rejects(
    () => write(b, "comment", { recordId: watch.id, text: "changed" }, repeat),
    /social_request_conflict/,
  );
  const thread = (await write(a, "thread", { userId: b.sub })).record;
  await assert.rejects(
    () =>
      write(a, "message", { recordId: thread.id, text: "before acceptance" }),
    /social_thread_not_accepted/,
  );
  await assert.rejects(
    () => write(c, "accept-thread", { recordId: thread.id }),
    /social_not_found/,
  );
  await write(b, "accept-thread", { recordId: thread.id, accept: true });
  const msg = (
    await write(a, "message", {
      recordId: thread.id,
      text: "private",
      fileIds: [image],
    })
  ).record;
  await assert.rejects(
    () => service.read({ user: c, recordId: thread.id }),
    /social_not_found/,
  );
  await assert.rejects(
    () => service.media({ user: c, recordId: msg.id, fileId: image }),
    /social_not_found/,
  );
  assert.equal(
    (await service.read({ user: b, recordId: thread.id })).items.length,
    1,
  );
  const call = (await write(a, "call", { recordId: thread.id, video: true }))
    .record;
  await assert.rejects(
    () =>
      write(a, "signal", {
        recordId: call.id,
        to: b.sub,
        type: "offer",
        payload: { type: "offer", sdp: "test" },
      }),
    /social_call_not_accepted/,
  );
  await write(b, "call-answer", { recordId: call.id, accept: true });
  const sentSignal = await write(a, "signal", {
    recordId: call.id,
    to: b.sub,
    type: "offer",
    payload: { type: "offer", sdp: "test" },
  });
  for (const user of [a, b, c])
    await assert.rejects(
      () => service.read({ user, recordId: sentSignal.id }),
      /social_not_found/,
    );
  assert.equal(
    (await service.rtc({ user: b, recordId: call.id })).signals.length,
    1,
  );
  assert.equal(
    (await service.rtc({ user: a, recordId: call.id })).signals.length,
    0,
  );
  await assert.rejects(
    () => service.rtc({ user: c, recordId: call.id }),
    /social_not_found/,
  );
  await write(a, "call-end", { recordId: call.id });
  await assert.rejects(
    () => service.rtc({ user: b, recordId: call.id }),
    /social_call_not_accepted/,
  );
  const product = (
    await write(a, "listing", {
      title: "one item",
      priceSatang: 10000,
      stock: 1,
    })
  ).record;
  const orders = await Promise.allSettled([
    write(b, "order", { recordId: product.id, quantity: 1 }),
    write(c, "order", { recordId: product.id, quantity: 1 }),
  ]);
  assert.equal(
    orders.filter((x) => x.status === "fulfilled").length,
    1,
    "stock must not oversell",
  );
  const order = orders.find((x) => x.status === "fulfilled").value.record;
  assert.equal(order.paymentStatus, "not_collected");
  await assert.rejects(
    () => write(b, "order-status", { recordId: order.id, status: "fulfilled" }),
    /social_invalid_order_state|social_not_found/,
  );
  await write(a, "order-status", { recordId: order.id, status: "cancelled" });
  assert.equal((await repository.get(product.id)).stock, 1);
  const live = (await write(a, "live-start", { title: "Live" })).record;
  await write(b, "live-join", { recordId: live.id });
  await write(c, "live-join", { recordId: live.id });
  await assert.rejects(
    () =>
      write(b, "signal", {
        recordId: live.id,
        to: c.sub,
        type: "offer",
        payload: {},
      }),
    /social_forbidden/,
  );
  await write(b, "live-chat", { recordId: live.id, text: "hi" });
  await write(a, "live-end", { recordId: live.id });
  await assert.rejects(
    () => service.rtc({ user: b, recordId: live.id }),
    /social_live_ended/,
  );
  assert.equal(
    (await service.read({ user: a, module: "connect" })).optInRequired,
    true,
  );
  await assert.rejects(
    () =>
      write(a, "connect", {
        enabled: true,
        name: "A",
        gender: "male",
        preferences: ["male"],
      }),
    /social_adult_consent_required/,
  );
  for (const u of [a, b])
    await write(u, "connect", {
      enabled: true,
      adultConfirmed: true,
      name: "adult",
      gender: "male",
      preferences: ["male"],
    });
  await write(a, "interest", { userId: b.sub });
  await assert.rejects(
    () => write(a, "thread", { userId: b.sub, context: "connect" }),
    /social_match_required/,
  );
  await write(b, "interest", { userId: a.sub });
  const match = (
    await write(a, "thread", { userId: b.sub, context: "connect" })
  ).record;
  assert.equal(match.status, "accepted");
  await write(b, "connect", { enabled: false });
  await assert.rejects(
    () => service.read({ user: a, recordId: match.id }),
    /social_not_found/,
  );
  await write(b, "block", { userId: a.sub });
  await assert.rejects(
    () => service.read({ user: a, recordId: thread.id }),
    /social_not_found/,
  );
  await assert.rejects(
    () => service.media({ user: b, recordId: watch.id, fileId: video }),
    /social_not_found/,
  );
  await write(b, "block", { userId: a.sub, enabled: false });
  assert.equal(
    (await service.read({ user: b, recordId: thread.id })).record.id,
    thread.id,
  );
  await write(b, "report", { recordId: watch.id, reason: "review" });
  await assert.rejects(() => service.reports({ user: a }), /social_forbidden/);
  assert.equal((await service.reports({ user: admin })).items.length, 1);
  await write(admin, "moderate", {
    recordId: watch.id,
    hidden: true,
    reason: "test",
  });
  await assert.rejects(
    () => service.media({ user: b, recordId: watch.id, fileId: video }),
    /social_not_found/,
  );
  await write(a, "delete", { recordId: post.id });
  await assert.rejects(
    () => service.media({ user: a, recordId: post.id, fileId: image }),
    /social_not_found/,
  );
  console.log(
    "Social: durable CRUD, file ownership, audience revocation, consent, blocks, RTC recipients, stock concurrency, replay and moderation passed",
  );
  return { service, a, b };
}
if (require.main === module)
  suite(new SocialRepository({ allowMemory: true })).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { suite };
