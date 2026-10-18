'use strict';
const assert = require('node:assert/strict');
const { EntitlementService } = require('../services/entitlementService');
const catalog = require('../billing-catalog');
class Pool {
  constructor() { this.free = new Map(); this.grants = []; }
  async connect() { return this; }
  release() {}
  async query(sql, p = []) {
    if (sql.startsWith('CREATE') || sql.includes('pg_advisory')) return { rows: [] };
    if (sql === 'BEGIN') { this.backup = structuredClone({ free: this.free, grants: this.grants }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(this, this.backup); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.startsWith('SELECT * FROM panthorium_entitlement_grants')) return { rows: structuredClone(this.grants.filter(r => r.user_id === p[0])) };
    if (sql.startsWith('UPDATE panthorium_entitlement_grants')) { this.grants.find(r => r.order_id === p[0]).used = JSON.parse(p[1]); return { rows: [] }; }
    const key = p.slice(0, 2).join(':');
    if (sql.startsWith('INSERT INTO panthorium_free_usage')) { if (!this.free.has(key)) this.free.set(key, {}); return { rows: [] }; }
    if (sql.startsWith('SELECT used FROM panthorium_free_usage')) return { rows: this.free.has(key) ? [{ used: structuredClone(this.free.get(key)) }] : [] };
    if (sql.startsWith('UPDATE panthorium_free_usage')) { this.free.set(key, JSON.parse(p[2])); return { rows: [] }; }
    throw new Error(sql);
  }
}
(async () => {
  const start = Date.parse('2026-10-17T17:00:00Z'), end = Date.parse('2026-11-30T17:00:00Z');
  let now = start - 1;
  const pool = new Pool(), rights = new EntitlementService({ pool, now: () => now });
  await rights.consume('free', { textInputTokens: 5000, textOutputTokens: 1000 });
  await assert.rejects(rights.consume('free', { textInputTokens: 1 }), /quota_exceeded/);
  now = start;
  let state = JSON.parse(JSON.stringify(await rights.state('free')));
  assert.equal(state.plan, 'free'); assert.equal(state.remaining.textInputTokens, null);
  assert(catalog.hasQuota(state, 'textInputTokens')); assert(catalog.hasQuota(state, 'textOutputTokens'));
  assert.equal(state.promotion.endsAt, '2026-12-01T00:00:00+07:00');
  pool.grants.push({ order_id: 'addon', user_id: 'free', snapshot: catalog.get('text-s'), used: {}, product_id: 'text-s' });
  await rights.consume('free', { textInputTokens: 10000000, textOutputTokens: 10000000 });
  assert.deepEqual(pool.grants[0].used, {}, 'promotion must preserve purchased add-ons');
  assert.equal(pool.free.get('free:2026-10').textInputTokens, 5000);
  assert.equal(pool.free.get('free:2026-10').promotion_textInputTokens, 10000000);
  await assert.rejects(rights.consume('free', { textInputTokens: -1 }), /invalid_usage/);
  await assert.rejects(rights.consume('free', { textInputTokens: 0.5 }), /invalid_usage/);
  await assert.rejects(rights.consume('free', { downloadBytes: 1 }), /quota_exceeded/);
  await rights.consume('free', { voiceInputSeconds: 40, voiceOutputSeconds: 20 });
  await rights.consume('free', { voiceInputSeconds: 100000, voiceOutputSeconds: 100000 });
  assert.equal((await rights.state('free')).remaining.voiceOutputSeconds, null);
  await assert.rejects(rights.consume('free', { textInputTokens: 1, downloadBytes: 1 }), /quota_exceeded/);
  assert.equal(pool.free.get('free:2026-10').promotion_textInputTokens, 10000000, 'failed mixed usage rolls back');
  pool.grants.push({ order_id: 'paid', user_id: 'paid', snapshot: catalog.get('life'), used: {}, product_id: 'life' });
  state = await rights.state('paid'); assert.equal(state.promotion, null); assert.deepEqual(state.unlimited, []);
  await assert.rejects(rights.consume('paid', { textInputTokens: 62501 }), /quota_exceeded/);
  now = end - 1;
  await rights.consume('fresh', { textInputTokens: 10000000, textOutputTokens: 10000000 });
  assert.equal((await rights.state('fresh')).unlimited.length, 4);
  now = end;
  state = await rights.state('fresh'); assert.equal(state.promotion, null); assert.equal(state.remaining.textInputTokens, 5000); assert.equal(state.remaining.textOutputTokens, 1000);
  await rights.consume('fresh', { textInputTokens: 5000, textOutputTokens: 1000 });
  await assert.rejects(rights.consume('fresh', { textOutputTokens: 1 }), /quota_exceeded/);
  assert(!catalog.hasQuota(await rights.state('fresh'), 'textOutputTokens'));
  await rights.consume('fresh', { voiceInputSeconds: 40, voiceOutputSeconds: 20 });
  await assert.rejects(rights.consume('fresh', { voiceOutputSeconds: 1 }), /dailyVoiceSeconds/);
  assert.equal((await rights.state('fresh')).remaining.voiceInputSeconds, 0);
  assert(catalog.displayDetails(catalog.get('free'), start).some(x => x.includes('ไม่จำกัดโทเคน')));
  assert(!catalog.displayDetails(catalog.get('free'), end).some(x => x.includes('ไม่จำกัดโทเคน')));
  assert.equal(catalog.get('free').quotas.textInputTokens, 5000, 'base package is unchanged');
  // Exercise the HTTP completion preflight and meter with JSON-safe unlimited quotas.
  const { EventEmitter } = require('node:events');
  const { completeLive } = require('../services/geminiLiveCompletion');
  const userId = '123e4567-e89b-42d3-a456-426614174000';
  now = start;
  const socket = new EventEmitter(); socket.readyState = 1;
  socket.close = () => { socket.readyState = 3; };
  socket.send = () => socket.emit('message', JSON.stringify({ usageMetadata: { promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1000000 }], responseTokensDetails: [{ modality: 'TEXT', tokenCount: 100000 }] }, serverContent: { outputTranscription: { text: 'hello' }, turnComplete: true } }));
  const completion = await completeLive({ entitlements: rights, userId, connect: async () => { setImmediate(() => socket.emit('message', '{"setupComplete":{}}')); return socket; } });
  assert.equal(completion.text, 'hello');
  assert.equal(pool.free.get(userId + ':2026-10').promotion_textInputTokens, 1000000);
  console.log('Free promotion: Bangkok boundaries, exhausted/new accounts, actual consumption, add-on preservation, paid limits, mixed rollback and December reset passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
