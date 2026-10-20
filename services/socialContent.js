"use strict";
const video = r => (r.files || []).some(f => /^video\//.test(f.contentType));
function moduleFor(r) {
  if (r.kind === "watch") return video(r) ? "short" : "watch";
  if (r.kind === "community") return r.audience === "group" ? "community" : video(r) ? "short" : "watch";
  if (r.kind === "thread" && r.context === "connect") return "connect";
  return ({ short: "short", listing: "market", order: "market", thread: "talk", message: "talk", call: "talk", live: "live", connect: "connect", profile: "profile", friend: "friends" })[r.kind] || "community";
}
module.exports = { moduleFor };
