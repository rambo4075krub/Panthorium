'use strict';

// Bound decoded response bytes even when Content-Length is absent or misleading.
// A single deadline covers both response headers and the complete body stream.
async function fetchBounded(fetcher, url, { maxBytes, timeoutMs, prefix }) {
  const controller = new AbortController();
  let reader, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(prefix + '_timeout'));
    }, timeoutMs);
  });
  const read = async () => {
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(prefix + '_http_' + response.status);
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maxBytes)) {
      throw new Error(prefix + '_too_large');
    }
    if (!response.body) throw new Error(prefix + '_empty');
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(prefix + '_too_large');
      chunks.push(Buffer.from(value));
    }
    if (!total) throw new Error(prefix + '_empty');
    return Buffer.concat(chunks, total);
  };
  try {
    return await Promise.race([read(), deadline]);
  } catch (error) {
    controller.abort();
    if (reader) reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    if (reader) reader.releaseLock();
  }
}

module.exports = { fetchBounded };
