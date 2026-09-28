const assert = require('node:assert/strict');
const { SentinelTrainingService } = require('../services/sentinelTrainingService');
const { SentinelTrainingRepository } = require('../services/sentinelTrainingRepository');

// Three independent judges with a quorum of two: one unavailable provider must
// not stall training, but dropping below the quorum still fails closed and a
// single dissenting judge still blocks approval.
const user = { sub: 'quorum-test' };

function judgeText({ score = 96, safe = true, correct = true, relevant = true } = {}) {
  return { text: JSON.stringify({ score, safe, correct, relevant, reason: 'ok' }), model: 'judge' };
}

function service(callDetailed, options = {}) {
  return new SentinelTrainingService({
    repository: new SentinelTrainingRepository(),
    providers: { available: () => ['openai', 'gemini', 'anthropic'], catalog: () => [], callDetailed },
    evaluatorProviders: ['openai', 'gemini', 'anthropic'],
    minEvaluators: 2,
    audit: { record() {} },
    ...options
  });
}

(async () => {
  // One of three judges is quota limited: the remaining two form a quorum.
  const quotaLimited = service(async provider => {
    if (provider === 'anthropic') throw new Error('rate_limit_exceeded');
    return judgeText();
  });
  const passed = await quotaLimited.addExample({ prompt: 'ทดสอบองค์ประชุมกรรมการ', answer: 'คำตอบนี้ถูกต้อง ปลอดภัย และตรงคำถาม', user });
  assert.equal(passed.example.status, 'approved', 'a quorum of judges must be able to approve');
  assert.equal(passed.evaluation.error, null);
  const passedDetail = passed.example.evaluation;
  assert.equal(passedDetail.evaluatorsConfigured, 3);
  assert.equal(passedDetail.evaluatorsResponded, 2);
  assert.equal(passedDetail.reason, null);
  assert.equal(passedDetail.failures.length, 1);
  assert.equal(passedDetail.failures[0].provider, 'anthropic');

  // Two of three judges fail: below the quorum the gate must stay closed.
  const belowQuorum = service(async provider => {
    if (provider === 'openai') return judgeText();
    throw new Error('provider_down');
  });
  const blocked = await belowQuorum.addExample({ prompt: 'ทดสอบเมื่อกรรมการไม่ถึงองค์ประชุม', answer: 'ข้อมูลนี้ต้องไม่ผ่านเมื่อกรรมการเหลือคนเดียว', user });
  assert.equal(blocked.example.status, 'rejected', 'fewer judges than the quorum must fail closed');
  assert.equal(blocked.evaluation.error, 'incomplete_evaluation');
  assert.equal(blocked.example.evaluation.reason, 'incomplete_evaluation');
  assert.equal(blocked.example.evaluation.evaluatorsResponded, 1);

  // A quorum is not a majority vote: any judge that answers can still veto.
  const dissenting = service(async provider => {
    if (provider === 'anthropic') throw new Error('rate_limit_exceeded');
    return provider === 'gemini' ? judgeText({ safe: false }) : judgeText();
  });
  const vetoed = await dissenting.addExample({ prompt: 'ทดสอบกรรมการค้าน', answer: 'คำตอบที่กรรมการรายหนึ่งชี้ว่าไม่ปลอดภัย', user });
  assert.equal(vetoed.example.status, 'rejected', 'a single unsafe verdict must still block approval');
  assert.equal(vetoed.example.evaluation.safe, false);

  // Fewer configured judges than the quorum must be refused before any call.
  let calls = 0;
  const understaffed = new SentinelTrainingService({
    repository: new SentinelTrainingRepository(),
    providers: { available: () => ['openai'], catalog: () => [], callDetailed: async () => { calls++; return judgeText(); } },
    evaluatorProviders: ['openai', 'gemini', 'anthropic'],
    minEvaluators: 2,
    audit: { record() {} }
  });
  const refused = await understaffed.addExample({ prompt: 'ทดสอบกรรมการพร้อมใช้ไม่พอ', answer: 'ต้องไม่ผ่านเมื่อมีกรรมการพร้อมใช้รายเดียว', user });
  assert.equal(refused.example.status, 'rejected');
  assert.equal(calls, 0, 'an understaffed panel must not spend provider calls');

  console.log('Phase 16 evaluator quorum tests passed');
})().catch(error => { console.error(error); process.exit(1); });
