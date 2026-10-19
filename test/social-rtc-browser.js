"use strict";
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { AuthService } = require("../services/authService");
const { SocialRepository } = require("../services/socialRepository");
const { SocialService } = require("../services/socialService");
const { createSocialRouter } = require("../routes/social");
(async () => {
  const auth = new AuthService({
      config: {
        jwtSecret: "social-browser-test-only-secret",
        accessTokenTtl: "1h",
      },
      audit: { record() {} },
    }),
    a = { id: randomUUID(), roles: ["user"], permissions: ["chat"] },
    b = { ...a, id: randomUUID() };
  a.sub = a.id;
  b.sub = b.id;
  const social = new SocialService({
    repository: new SocialRepository({ allowMemory: true }),
    files: {},
  });
  await social.init();
  for (const user of [a, b])
    await social.write({
      user,
      action: "profile",
      input: { name: user.id, discoverable: true },
    });
  const write = (user, action, input) =>
    social.write({ user, action, input, requestId: randomUUID() });
  const thread = (await write(a, "thread", { userId: b.id })).record;
  await write(b, "accept-thread", { recordId: thread.id, accept: true });
  const call = (await write(a, "call", { recordId: thread.id, video: true }))
    .record;
  await write(b, "call-answer", { recordId: call.id, accept: true });
  const app = express();
  app.use(express.json());
  app.use("/api/social", createSocialRouter(auth, social));
  app.get("/social-rtc.js", (req, res) =>
    res.sendFile(path.join(__dirname, "../social-rtc.js")),
  );
  app.get("/", (req, res) =>
    res
      .type("html")
      .send(
        '<html><body><div id="screen"></div><script src="/social-rtc.js"></script></body></html>',
      ),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let browser, pa, pb;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-device-for-media-stream",
        "--allow-loopback-in-peer-connection",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const ca = await browser.newContext({
        permissions: ["camera", "microphone"],
      }),
      cb = await browser.newContext({ permissions: ["camera", "microphone"] });
    pa = await ca.newPage();
    pb = await cb.newPage();
    for (const page of [pa, pb])
      await page.addInitScript(() => {
        const Native = window.RTCPeerConnection;
        window.testPeers = [];
        window.RTCPeerConnection = class extends Native {
          constructor(...args) {
            super(...args);
            window.testPeers.push(this);
          }
        };
      });
    await Promise.all([pa.goto(base), pb.goto(base)]);
    const start = async (page, user, r) =>
      page.evaluate(
        async ({ token, user, r }) => {
          window.state = "starting";
          const api = async (path, options = {}) => {
            const res = await fetch(path, {
              ...options,
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
                ...options.headers,
              },
            });
            const data = await res.json();
            if (!res.ok) throw Error(data.error);
            return data;
          };
          await window.PanthoriumSocialRTC.start({
            id: r.id,
            kind: r.kind,
            owner: r.ownerId,
            uid: user.id,
            video: true,
            read: (path) => api(path),
            write: (action, input) =>
              api("/api/social/actions", {
                method: "POST",
                headers: { "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({ action, input }),
              }),
            render: document.getElementById("screen"),
            status: (text) => {
              window.state = text;
            },
          });
        },
        { token: auth.signAccessToken(user), user, r },
      );
    await Promise.all([start(pa, a, call), start(pb, b, call)]);
    await Promise.all([
      pa.waitForFunction(
        () => !!document.querySelector("video[data-peer]")?.videoWidth,
        {},
        { timeout: 30000 },
      ),
      pb.waitForFunction(
        () => !!document.querySelector("video[data-peer]")?.videoWidth,
        {},
        { timeout: 30000 },
      ),
    ]);
    for (const page of [pa, pb])
      await page.waitForFunction(
        async () => {
          for (const peer of window.testPeers)
            for (const report of (await peer.getStats()).values())
              if (
                report.type === "inbound-rtp" &&
                report.kind === "audio" &&
                report.bytesReceived > 0
              )
                return true;
          return false;
        },
        {},
        { timeout: 30000 },
      );
    assert(
      await pa.evaluate(
        () =>
          document.querySelector("video[data-peer]").srcObject.getAudioTracks()
            .length > 0,
      ),
    );
    assert(
      await pb.evaluate(
        () =>
          document.querySelector("video[data-peer]").srcObject.getAudioTracks()
            .length > 0,
      ),
    );
    await pa.evaluate(() => window.PanthoriumSocialRTC.stop());
    await pb.waitForFunction(
      () => !window.PanthoriumSocialRTC.isActive(),
      {},
      { timeout: 10000 },
    );
    const live = (await write(a, "live-start", { title: "real browser live" }))
      .record;
    await write(b, "live-join", { recordId: live.id });
    await Promise.all([start(pa, a, live), start(pb, b, live)]);
    await pb.waitForFunction(
      () => !!document.querySelector("video[data-peer]")?.videoWidth,
      {},
      { timeout: 30000 },
    );
    assert.equal(
      await pb.locator("video:not([data-peer])").count(),
      0,
      "viewer must not open a camera",
    );
    await pa.evaluate(() => window.PanthoriumSocialRTC.stop());
    await pb.waitForFunction(
      () => !window.PanthoriumSocialRTC.isActive(),
      {},
      { timeout: 10000 },
    );
    console.log(
      "Real Chromium RTC: two authenticated accounts exchanged video+audio, ended call, watched live without viewer camera, and stopped on host end. Fake hardware and local network only; TURN/NAT is not certified.",
    );
  } catch (error) {
    for (const page of [pa, pb])
      if (page)
        console.error(
          "RTC browser state",
          await page
            .evaluate(() => ({
              state: window.state,
              active: window.PanthoriumSocialRTC?.isActive(),
              connections: window.testPeers?.map((p) => ({
                ice: p.iceConnectionState,
                connection: p.connectionState,
                signaling: p.signalingState,
              })),
              media: [...document.querySelectorAll("video")].map((v) => ({
                peer: v.dataset.peer,
                width: v.videoWidth,
                ready: v.readyState,
              })),
            }))
            .catch(() => null),
        );
    throw error;
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
