'use strict';
const assert = require('node:assert/strict');
const { fetchBounded } = require('../electron/update-download.cjs');

(async () => {
  const options = { maxBytes: 8, timeoutMs: 1000, prefix: 'update' };
  assert.equal((await fetchBounded(async () => new Response('complete'), 'https://example.invalid/', options)).toString(), 'complete');
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '9' }]) {
    await assert.rejects(fetchBounded(async () => new Response('too-large', { headers }), 'https://example.invalid/', options), /update_too_large/);
  }
  let cancelled = false, signal;
  const streaming = async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); },
      cancel() { cancelled = true; }
    }));
  };
  await assert.rejects(fetchBounded(streaming, 'https://example.invalid/', options), /update_too_large/);
  assert.equal(cancelled, true);
  assert.equal(signal.aborted, true);
  let pendingSignal;
  await assert.rejects(fetchBounded(async (_url, init) => { pendingSignal = init.signal; return new Promise(() => {}); }, 'https://example.invalid/', { ...options, timeoutMs: 20 }), /update_timeout/);
  assert.equal(pendingSignal.aborted, true);
  let stalledCancelled = false;
  await assert.rejects(fetchBounded(async () => new Response(new ReadableStream({ cancel() { stalledCancelled = true; } })), 'https://example.invalid/', { ...options, timeoutMs: 20 }), /update_timeout/);
  assert.equal(stalledCancelled, true);
  await assert.rejects(fetchBounded(async () => new Response('', { status: 503 }), 'https://example.invalid/', options), /update_http_503/);
  await assert.rejects(fetchBounded(async () => new Response(''), 'https://example.invalid/', options), /update_empty/);
  console.log('Update downloads enforce streamed byte limits and header/body deadlines, cancel excess/stalled responses');
})().catch(error => { console.error(error); process.exitCode = 1; });
