'use strict';
const assert = require('node:assert/strict');
const { createCloudAppCompletion } = require('../services/cloudAppCompletion');
const { CloudFilesService } = require('../services/cloudFilesService');
async function main() {
  const events = []; let providerCalls = 0; let gated = 0;
  const entitlements = {};
  const usageLedger = { record: async event => events.push(event) };
  const complete = async args => {
    providerCalls++;
    assert.equal(args.entitlements, entitlements);
    assert.equal(args.userId, 'user-a');
    assert.equal(args.maxOutputTokens, 1536);
    assert.equal(args.timeoutMs, 45000);
    assert.deepEqual(args.tools, []);
    return { text: '{"draft":"test"}', model: 'configured-model', usage: { totalTokenCount: 12 } };
  };
  const adapter = createCloudAppCompletion({ complete, entitlements, usageLedger,
    gate: { run: async fn => { gated++; return fn(); } } });
  const input = { user:{sub:'user-a'}, systemPrompt:'system', messages:[{role:'user',content:'private request'}], maxOutputTokens:1536, timeoutMs:45000, cloudApp:{runId:'run-a'} };
  const result = await adapter(input);
  assert.equal(result.model, 'configured-model'); assert.equal(gated, 1);
  assert.equal(events[0].usage.totalTokenCount, 12);
  assert.equal(events[0].actionId, 'run-a');
  assert.ok(!JSON.stringify(events).includes('private request'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter({...input,signal:controller.signal}), /execution_cancelled/);
  assert.equal(providerCalls, 1, 'cancelled queued calls never contact the provider');
  assert.equal(events[1].outcome, 'aborted');

  const userId = '11111111-1111-4111-8111-111111111111';
  const file = { id:'22222222-2222-4222-8222-222222222222', name:'private.txt', size:100 };
  let reads = 0; let charged = 0; let remaining = 50;
  const files = new CloudFilesService({ bucket:'example-files', entitlements:{
    state: async () => ({remaining:{downloadBytes:remaining}}),
    consume: async (owner, amounts) => { assert.equal(owner,userId); charged += amounts.downloadBytes; }
  }});
  files.findObject = async () => file;
  files.request = async () => { reads++; return Buffer.alloc(100); };
  await assert.rejects(files.download(userId,file.id), /quota_exceeded:downloadBytes/);
  assert.equal(reads,0,'known exhausted quotas reject before GCS media transfer');
  remaining = 100;
  assert.equal((await files.download(userId,file.id)).body.length,100);
  assert.equal(reads,1); assert.equal(charged,100,'actual bytes charged once');
  console.log('Cloud completion bounds and download quota preflight passed');
}
main().catch(error => { console.error(error); process.exitCode=1; });
