"use strict";
const TALK_MESSAGE_TTL = 3 * 24 * 60 * 60 * 1000;
const expiresAt = message => new Date(Date.parse(message.createdAt) + TALK_MESSAGE_TTL).toISOString();
const expired = (message, thread, now = Date.now()) => message?.kind === "message" && thread?.kind === "thread" && thread.context !== "connect" && Date.parse(message.createdAt) + TALK_MESSAGE_TTL <= now;
const expiredResult = message => ({ ok: true, expired: true, record: { id: message.id, kind: "message", deleted: true } });
module.exports = { TALK_MESSAGE_TTL, expiresAt, expired, expiredResult };
