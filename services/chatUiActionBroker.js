'use strict';
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const windows = require('../voice-window-catalog');
const screens = require('../screen-voice-catalog');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const denied = error => ({ ok: false, error });
function principal(user) {
  return typeof user?.sub === 'string' && user.sub.length > 0 && !user.sub.startsWith('guest:') &&
    typeof user.sid === 'string' && user.sid.length > 0 && !user.roles?.includes('guest');
}
function permitted(user, toolId, args, action) {
  if (!principal(user) || !user.permissions?.includes('chat') || !object(args)) return false;
  if (toolId === 'screen.command') {
    if (Object.keys(args).length !== 1 || !screens.parse(args.command) || typeof action !== 'string') return false;
    const prefix = 'screen_command:' + encodeURIComponent(args.command) + '#';
    return action.startsWith(prefix) && /^[a-f0-9-]{36}$/i.test(action.slice(prefix.length));
  }
  const target = windows.actionFor(action);
  return !!target && toolId === 'window.' + target.operation && Object.keys(args).length === 1 &&
    args.appId === target.app.id && windows.allowed(target.app, user);
}
class ChatUiActionBroker {
  constructor({ timeoutMs = 10000, maxPending = 100 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxPending) || maxPending < 1) throw new Error('invalid_ui_broker_limits');
    this.timeoutMs = timeoutMs; this.maxPending = maxPending; this.pending = new Map();
  }
  dispatch({ user, toolId, args, action, signal, send, authorize } = {}) {
    if (authorize != null && typeof authorize !== 'function') return Promise.resolve(denied('ui_action_permission_denied'));
    if (!permitted(user, toolId, args, action) || (authorize && authorize(user) !== true)) return Promise.resolve(denied('ui_action_permission_denied'));
    if (signal?.aborted) return Promise.resolve({ ...denied('ui_action_cancelled'), dispatched: false });
    if (this.pending.size >= this.maxPending) return Promise.resolve(denied('ui_action_capacity_exceeded'));
    if (typeof send !== 'function') return Promise.resolve(denied('ui_action_transport_unavailable'));
    const id = randomUUID(), nonce = randomBytes(32).toString('hex');
    return new Promise(resolve => {
      const record = { id, nonce, owner: user.sub, sid: user.sid, toolId, args: structuredClone(args), action,
        authorize, claimed: false, expiresAt: Date.now() + this.timeoutMs, resolve };
      const abort = () => this.finish(record, this.interrupted(record, 'ui_action_cancelled'));
      record.cleanup = () => { clearTimeout(record.timer); signal?.removeEventListener('abort', abort); };
      record.timer = setTimeout(() => this.finish(record, this.interrupted(record, 'ui_action_timeout')), this.timeoutMs);
      this.pending.set(id, record); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      try {
        Promise.resolve(send({ id, nonce, action })).catch(() => this.finish(record, this.interrupted(record, 'ui_action_transport_unavailable')));
      } catch { this.finish(record, this.interrupted(record, 'ui_action_transport_unavailable')); }
    });
  }
  interrupted(record, error) {
    return record.claimed ? { ...denied('ui_action_outcome_unknown'), dispatched: true, reconciliationRequired: true }
      : { ...denied(error), dispatched: false };
  }
  finish(record, result) {
    if (this.pending.get(record.id) !== record) return;
    this.pending.delete(record.id); record.cleanup(); record.resolve(result);
  }
  lookup({ user, id, nonce } = {}) {
    const record = this.pending.get(id);
    if (!record || !principal(user) || user.sub !== record.owner || user.sid !== record.sid ||
        typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce) ||
        !timingSafeEqual(Buffer.from(nonce), Buffer.from(record.nonce))) return { error: 'ui_action_not_found' };
    if (Date.now() >= record.expiresAt) {
      this.finish(record, this.interrupted(record, 'ui_action_timeout')); return { error: 'ui_action_expired' };
    }
    if (!permitted(user, record.toolId, record.args, record.action) || (record.authorize && record.authorize(user) !== true)) return { error: 'ui_action_permission_denied' };
    return { record };
  }
  claim(input) {
    const { record, error } = this.lookup(input);
    if (error) return denied(error);
    if (record.claimed) return denied('ui_action_already_claimed');
    record.claimed = true;
    return { ok: true, action: record.action };
  }
  acknowledge(input = {}) {
    const { record, error } = this.lookup(input);
    if (error) return denied(error);
    if (!record.claimed) return denied('ui_action_not_claimed');
    const value = input.result, limit = record.toolId === 'screen.command' ? 6000 : 240;
    if (!object(value) || Object.keys(value).some(key => !['ok', 'error', 'text', 'confirmationRequired', 'dispatched'].includes(key)) ||
        typeof value.ok !== 'boolean' || (value.error != null && (typeof value.error !== 'string' || value.error.length > 120)) ||
        (value.text != null && (typeof value.text !== 'string' || value.text.length > limit)) ||
        (value.confirmationRequired != null && typeof value.confirmationRequired !== 'boolean') ||
        (value.dispatched != null && typeof value.dispatched !== 'boolean') ||
        (value.confirmationRequired === true && (record.toolId !== 'screen.command' || !value.ok)) ||
        (value.ok && value.dispatched === false && value.confirmationRequired !== true)) return denied('invalid_ui_action_result');
    const result = { ok: value.ok, dispatched: value.dispatched !== false,
      ...(value.ok ? { text: (value.text || '').replace(/\u0000/g, ''), confirmationRequired: value.confirmationRequired === true,
        completed: value.confirmationRequired !== true && !(record.toolId === 'screen.command' && ['click', 'fill'].includes(screens.parse(record.args.command)?.action)) } : { error: value.error || 'ui_action_failed' }) };
    this.finish(record, result);
    return { ok: true };
  }
}
module.exports = { ChatUiActionBroker };
