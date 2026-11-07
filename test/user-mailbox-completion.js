'use strict';
const assert = require('node:assert/strict');
const { createMailboxCompletion, LOCAL_INPUT_LIMIT } = require('../services/mailbox/completion');
const { AiGateway } = require('../services/aiGateway');
const { LocalLlmProvider } = require('../services/localLlmProvider');
const { localTools } = require('../services/hybridAiPolicy');

(async () => {
  const savedFetch = global.fetch, requests = [];
  const local = new LocalLlmProvider();
  const providers = {
    authorizeLocal: async () => true,
    available: () => ['local'],
    callDetailed: (provider, prompt, history, options) => local.complete(prompt, history, { ...options, hybrid: true })
  };
  const complete = createMailboxCompletion(new AiGateway({ providers }));
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'สรุปจากข้อมูลที่ให้มา' } }] });
  };
  try {
    // Exercise the actual gateway -> local provider boundary. This previously
    // cut the beginning off JSON longer than 2,400 characters.
    const sources = [{ messageId: 'source-a', subject: 'ต้นฉบับ', text: 'ก'.repeat(2700) }];
    const result = await complete({ user: { sub: 'owner', roles:['administrator'], permissions:['chat'] }, provider: 'local', question: 'สรุปต้นฉบับ', sources });
    assert(result.ok); assert.equal(result.sourceTruncated, false);
    assert.deepEqual(JSON.parse(requests.at(-1).messages.at(-1).content), { question: 'สรุปต้นฉบับ', sources });
    assert.equal(requests.at(-1).tools, undefined, 'private email summaries cannot call tools');

    const many = Array.from({ length: 10 }, (_, i) => ({ messageId: 'mail-' + i, attachmentId: 'file-' + i, subject: 'หัวข้อ', text: 'ข้อความ "คำพูด"\n'.repeat(6000) }));
    const snapshot = JSON.stringify(many);
    const excerpt = await complete({ user: { sub: 'owner', roles:['administrator'], permissions:['chat'] }, provider: 'local', question: 'สรุปทั้งสิบฉบับ', sources: many });
    assert(excerpt.ok); assert.equal(excerpt.sourceTruncated, true);
    const sent = requests.at(-1).messages.at(-1).content;
    assert(sent.length <= LOCAL_INPUT_LIMIT); const data = JSON.parse(sent);
    assert.deepEqual(data.sources.map(x => [x.messageId, x.attachmentId]), many.map(x => [x.messageId, x.attachmentId]));
    assert(data.sources.every(x => x.truncated));
    assert.match(requests.at(-1).messages[0].content, /summary of excerpts/);
    assert.equal(JSON.stringify(many), snapshot, 'never alter the original sources or claim they were read completely');

    const before = requests.length;
    const tooLarge = await complete({ user: { sub: 'owner', roles:['administrator'], permissions:['chat'] }, provider: 'local', question: 'สรุป', sources: [{ messageId: 'x'.repeat(4000), text: 'body' }] });
    assert.equal(tooLarge.ok, false); assert.equal(tooLarge.error, 'mailbox_local_context_too_large');
    assert.equal(requests.length, before, 'unfit metadata is not silently removed');
    await assert.rejects(() => local.complete('brief', [{ role: 'user', content: 'x'.repeat(7000) }], { hybrid: true, preserveInput: true }), /local_context_too_large/);

    const calls = [];
    const fallback = createMailboxCompletion({ complete: async input => { calls.push(input); return { ok: input.lockedProvider === 'local', text: 'สรุป', provider: input.lockedProvider }; } });
    await fallback({ user: { sub: 'owner', roles:['administrator'], permissions:['chat'] }, question: 'สรุป', sources });
    assert.deepEqual(calls.map(x => x.lockedProvider), ['gemini-live', 'local']);
    calls.length = 0;
    await fallback({ user: { sub: 'owner', roles:['administrator'], permissions:['chat'] }, provider: 'local', question: 'สรุป', sources });
    assert.deepEqual(calls.map(x => x.lockedProvider), ['local'], 'free preference never bills a paid fallback');

    const tools = ['read', 'write', 'analyze'].map(name => ({ name: 'panthorium_mailbox_' + name }));
    for (const question of ['สรุปอีเมลล่าสุดของฉัน', 'อ่านอีเมล์ให้ฟัง', 'วิเคราะห์ไฟล์แนบ', 'ตอบกลับเมล์นี้', 'search my inbox']) {
      assert.deepEqual(localTools(tools, [{ role: 'user', content: question }]), tools, question);
    }
    assert.deepEqual(localTools(tools, [{ role: 'user', content: 'สวัสดี' }]), []);
    const catalog = [{name:'panthorium_calculate'}, ...Array.from({length:8},(_,i)=>({name:'panthorium_web_'+i})), ...tools];
    assert.deepEqual(localTools(catalog, [{role:'user',content:'ค้นหาและลบอีเมลวันที่ 10 ถึง 12'}]), tools, 'mail intent cannot become arithmetic or lose mailbox tools behind web tools');
    console.log('Mailbox completion: intact local JSON, bounded explicit excerpts, source attribution, provider isolation and Thai voice tools passed');
  } finally { global.fetch = savedFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
