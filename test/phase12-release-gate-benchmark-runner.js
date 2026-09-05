'use strict';

const assert = require('assert');
const { SentinelReleaseGateService, releaseGateBenchmarkCases } = require('../services/sentinelReleaseGateService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  let runCalls = 0;
  const gate = new SentinelReleaseGateService({
    benchmark: {
      status() {
        return { ok: true, availableProviders: ['groq', 'openai'], history: [], lastRun: null };
      },
      async run({ cases, userId }) {
        runCalls += 1;
        assert.equal(cases.length, releaseGateBenchmarkCases().length);
        assert(String(userId).startsWith('release-gate:'));
        return {
          ok: true,
          runId: 'release-bench-1',
          durationMs: 12,
          providers: ['groq', 'openai'],
          leaderboard: [
            { name: 'Sentinel AI', score: 88, wins: 2, cases: 3 },
            { name: 'groq', score: 84, wins: 1, cases: 3 }
          ]
        };
      }
    },
    minBenchmarkScore: 80
  });

  const started = await gate.startBenchmark({ userId: 'admin-test', requestId: 'req-1' });
  assert.equal(started.ok, true);
  assert.equal(started.accepted, true);
  assert.equal(started.job.status, 'running');

  const duplicate = await gate.startBenchmark({ userId: 'admin-test', requestId: 'req-2' });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.alreadyRunning, true);

  for (let i = 0; i < 20 && gate.benchmarkJobStatus().status === 'running'; i += 1) await sleep(25);
  const job = gate.benchmarkJobStatus();
  assert.equal(job.status, 'completed');
  assert.equal(runCalls, 1);
  assert.equal(job.result.runId, 'release-bench-1');
  assert.equal(job.result.sentinel.score, 88);
  assert.equal(job.result.mergeReadyIfRechecked, true);

  const noProviderGate = new SentinelReleaseGateService({
    benchmark: { status() { return { ok: true, availableProviders: [] }; } }
  });
  const noProvider = await noProviderGate.startBenchmark();
  assert.equal(noProvider.ok, false);
  assert.equal(noProvider.error, 'no_benchmark_provider');

  console.log('Phase 12 Release Gate benchmark runner tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
