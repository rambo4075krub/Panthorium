"use strict";
const assert = require("node:assert/strict");
const express = require("express");
const { randomUUID } = require("node:crypto");
const { AuthService } = require("../services/authService");
const { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService");
const { createSocialRouter } = require("../routes/social");
(async () => {
  const auth = new AuthService({
      config: {
        jwtSecret: "social-http-test-only-secret",
        accessTokenTtl: "1h",
      },
      audit: { record() {} },
    }),
    user = { id: randomUUID(), roles: ["user"], permissions: ["chat"] },
    other = { ...user, id: randomUUID() },
    social = new SocialService({
      repository: new SocialRepository({ allowMemory: true }),
      files: {},
    });
  await social.init();
  const app = express();
  app.use(express.json());
  app.use("/api/social", createSocialRouter(auth, social));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const req = (path, body, actor = user, extra = {}) =>
    fetch(base + "/api/social" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + auth.signAccessToken(actor),
        "Content-Type": "application/json",
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal(
      (await fetch(base + "/api/social/feed/community")).status,
      401,
    );
    assert.equal(
      (await req("/feed/community", null, { ...user, roles: ["guest"] }))
        .status,
      403,
    );
    assert.equal(
      (
        await req("/actions", {
          action: "profile",
          input: { name: "Owner", discoverable: true },
        })
      ).status,
      200,
    );
    const body = {
        action: "publish",
        input: {
          module: "community",
          text: "private text",
          audience: "private",
        },
      },
      key = randomUUID();
    const first = await (
      await req("/actions", body, user, { "Idempotency-Key": key })
    ).json();
    assert(first.record.id);
    const replay = await (
      await req("/actions", body, user, { "Idempotency-Key": key })
    ).json();
    assert.equal(replay.record.id, first.record.id);
    assert.equal(
      (
        await req(
          "/records/" + encodeURIComponent(first.record.id),
          null,
          other,
        )
      ).status,
      404,
    );
    const own = await req("/records/" + encodeURIComponent(first.record.id));
    assert.match(own.headers.get("cache-control"), /no-store/);
    assert.equal((await own.json()).record.text, "private text");
    assert.equal((await req("/reports")).status, 403);
    await req("/actions", { action: "profile", input: { name: "Reader", discoverable: true } }, other);
    const thread = (await (await req("/actions", { action: "thread", input: { userId: other.id } })).json()).record;
    await req("/actions", { action: "accept-thread", input: { recordId: thread.id, accept: true } }, other);
    const message = (await (await req("/actions", { action: "message", input: { recordId: thread.id, text: "receipt" } })).json()).record;
    const receiptPath = "/records/" + thread.id + "/read", receiptBody = { messageIds: [message.id] };
    assert.equal((await fetch(base + "/api/social" + receiptPath, { method: "POST" })).status, 401);
    assert.equal((await req(receiptPath, receiptBody, { ...other, roles: ["guest"] })).status, 403);
    assert.equal((await req(receiptPath, receiptBody, { ...other, permissions: [] })).status, 403);
    assert.equal((await req(receiptPath, receiptBody)).status, 403, "sender cannot mark their own message read");
    assert.equal((await req(receiptPath, receiptBody, { ...other, id: randomUUID() })).status, 404);
    const receipt = await req(receiptPath, receiptBody, other);
    assert.equal(receipt.status, 200);
    assert.match(receipt.headers.get("cache-control"), /no-store/);
    assert((await (await req("/records/" + thread.id)).json()).items[0].readAt);
    console.log(
      "Social HTTP: authentication, guest denial, private records, no-store and idempotent writes passed",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
