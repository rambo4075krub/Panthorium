"use strict";
const { createHash, randomUUID } = require("node:crypto");
const { httpsUrl, source } = require("../social-media-source");
// Official destinations, checked 2026-10-26. A website listing does not imply rebroadcast permission.
const OFFICIAL_CHANNELS = Object.freeze([
  { id: "tv:thaipbs", name: "Thai PBS", provider: "Thai PBS", number: "3", category: "ข่าว / สาระ", websiteUrl: "https://www.thaipbs.or.th/live", scheduleUrl: "https://www.thaipbs.or.th/program/schedules/online" },
  { id: "tv:ch7", name: "7HD", provider: "CH7ON", number: "35", category: "ทั่วไป", websiteUrl: "https://www.ch7.com/th/live/", scheduleUrl: "https://www.ch7.com/th/schedule/" },
  { id: "tv:pptv", name: "PPTV HD 36", provider: "PPTV", number: "36", category: "ข่าว / กีฬา", websiteUrl: "https://www.pptvhd36.com/live", scheduleUrl: "https://www.pptvhd36.com/live" },
].map(c => Object.freeze({ ...c, kind: "tv-channel", status: "approved", official: true, source: { type: "website", url: c.websiteUrl } })));
const fail = (code, status = 400) => { throw Object.assign(Error(code), { code, status, sideEffectNotApplied: true }); };
const admin = user => user.roles?.includes("administrator") && user.permissions?.includes("settings");
const text = (value, max, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail("social_invalid_tv_channel");
  return value.trim();
};
const favoriteId = (uid, channelId) => "tv-favorite:" + createHash("sha256").update(uid + ":" + channelId).digest("hex");
function publicChannel(record, user) {
  const { contact, rightsConfirmedAt, reviewedBy, reviewNote, ...out } = record;
  const canEdit = record.ownerId === user.sub;
  return { ...out, canEdit, ...(canEdit || admin(user) ? { contact, rightsConfirmedAt, reviewedBy, reviewNote } : {}) };
}
async function read(service, user, { query = "", mode, before } = {}) {
  if (mode === "review" && !admin(user)) fail("social_forbidden", 403);
  const sourceRows = await service.repo.list({ kind: "tv-channel", ...(mode === "mine" ? { owner: user.sub } : {}), before, limit: 100 });
  const candidates = [...(!before && !["mine", "review"].includes(mode) ? OFFICIAL_CHANNELS : []), ...sourceRows];
  const items = [];
  for (const r of candidates) {
    if (r.deleted || r.hidden || (r.ownerId && await service.blocked(service.repo, user.sub, r.ownerId))) continue;
    if (mode === "review" ? r.status !== "pending" : mode !== "mine" && r.status !== "approved") continue;
    if (query && ![r.name, r.provider, r.category, r.number].join(" ").toLowerCase().includes(query.toLowerCase())) continue;
    const favorite = !!await service.repo.get(favoriteId(user.sub, r.id));
    if (mode === "favorites" && !favorite) continue;
    items.push({ ...publicChannel(r, user), favorite });
  }
  return { ok: true, items, canReview: !!admin(user), nextCursor: sourceRows.length === 100 ? sourceRows.at(-1).id : null };
}
async function mutate(service, repo, user, action, a) {
  const uid = user.sub;
  if (action === "tv-favorite") {
    const channel = OFFICIAL_CHANNELS.find(c => c.id === a.recordId) || await repo.get(a.recordId);
    if (!channel || channel.kind !== "tv-channel" || channel.deleted || channel.hidden || channel.status !== "approved" ||
        (channel.ownerId && await service.blocked(repo, uid, channel.ownerId))) fail("social_not_found", 404);
    if (typeof a.enabled !== "boolean") fail("social_invalid_input");
    const id = favoriteId(uid, channel.id);
    if (a.enabled) await repo.put({ id, kind: "tv-favorite", ownerId: uid, targetId: channel.id, createdAt: new Date().toISOString() });
    else await repo.remove(id);
    return { ok: true, favorite: a.enabled };
  }
  let previous;
  if (a.recordId) {
    previous = await repo.get(a.recordId);
    if (!previous || previous.kind !== "tv-channel" || previous.deleted) fail("social_not_found", 404);
    if (previous.ownerId !== uid && !admin(user)) fail("social_forbidden", 403);
  }
  if (action === "tv-save") {
    if (previous && previous.ownerId !== uid) fail("social_forbidden", 403);
    if (a.rightsConfirmed !== true) fail("social_tv_rights_required");
    const record = {
      id: previous?.id || String(Date.now()).padStart(16, "0") + "-" + randomUUID(), kind: "tv-channel", ownerId: uid,
      createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      name: text(a.name, 100, true), provider: text(a.provider, 120, true), number: text(a.number || "", 10),
      category: text(a.category || "ทั่วไป", 80), contact: text(a.contact, 200, true),
      websiteUrl: httpsUrl(a.websiteUrl), scheduleUrl: httpsUrl(a.scheduleUrl, true),
      source: source(a.sourceType, a.sourceUrl || a.websiteUrl),
      rightsConfirmedAt: new Date().toISOString(), status: "pending",
      // Editing a suspended channel cannot bypass moderation.
      hidden: !!previous?.hidden,
    };
    await repo.put(record);
    return { ok: true, record: publicChannel(record, user) };
  }
  if (!previous) fail("social_not_found", 404);
  if (action === "tv-review") {
    if (!admin(user)) fail("social_forbidden", 403);
    if (!["approved", "rejected"].includes(a.status)) fail("social_invalid_input");
    previous.status = a.status; previous.reviewedBy = uid;
    previous.reviewedAt = new Date().toISOString(); previous.reviewNote = text(a.reviewNote || "", 1000);
  } else if (action === "tv-delete") {
    previous.deleted = true;
  } else fail("social_unknown_action");
  await repo.put(previous);
  return { ok: true, record: publicChannel(previous, user) };
}
module.exports = { read, mutate, OFFICIAL_CHANNELS };
