'use strict';

const { randomInt, randomUUID, createHash } = require('node:crypto');

// Application protocol, independent of the model's transport frames. Audio stays
// in the compatible provider frame; these events carry state, not duplicate PCM.
const PROTOCOL_VERSION = 1;
function createEventStream(sessionId = randomUUID()) {
  let sequence = 0;
  const connectionId = randomUUID();
  let turnId = randomUUID();
  return {
    sessionId,
    event(event, payload = {}) {
      const envelope = { type: 'conversationEvent', protocolVersion: PROTOCOL_VERSION, sessionId, connectionId, turnId, sequence: ++sequence, event, payload };
      if (event === 'turn.completed') turnId = randomUUID();
      return envelope;
    }
  };
}

function normalizeVoicePhrase(value) {
  const digits = '๐๑๒๓๔๕๖๗๘๙';
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[๐-๙]/g, digit => String(digits.indexOf(digit)))
    .replace(/[\s.,!?。！？،;:]/gu, '').trim();
}

// Deliberately narrow: private, new records only. No update/delete, calendar,
// messages, money, files, external recipients or permission changes.
function privateVoiceApproval(confirmation) {
  const args = confirmation?.args;
  return confirmation?.mutates === true && !['high', 'critical'].includes(confirmation.risk)
    && args && typeof args === 'object' && !Array.isArray(args)
    && ((confirmation.toolId === 'notes.write' && args.action === 'create')
      || (confirmation.toolId === 'memory.write' && args.action === 'remember'))
    && typeof args.content === 'string' && args.content.length <= 600
    && typeof args.title === 'string' && args.title.trim().length > 0 && args.title.trim().length <= 60
    && !Object.keys(args).some(key => /recipient|share|email|permission|public/i.test(key));
}

function createVoiceChallenge(confirmation, { now = Date.now(), ttlMs = 30000, nonce = String(randomInt(100000, 1000000)) } = {}) {
  if (!privateVoiceApproval(confirmation)) return null;
  const title = confirmation.args.title.trim();
  const phrase = `ยืนยัน ${title} รหัส ${nonce}`;
  return { phrase, expiresAt: now + ttlMs, argsHash: createHash('sha256').update(JSON.stringify(confirmation.args)).digest('hex') };
}

function matchVoiceChallenge(challenge, transcript, { now = Date.now(), final = false } = {}) {
  return !!challenge && final === true && now <= challenge.expiresAt
    && normalizeVoicePhrase(transcript) === normalizeVoicePhrase(challenge.phrase);
}

module.exports = { PROTOCOL_VERSION, createEventStream, privateVoiceApproval, createVoiceChallenge, matchVoiceChallenge };
