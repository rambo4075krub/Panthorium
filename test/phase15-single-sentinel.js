'use strict';

const assert = require('assert');
const fs = require('fs');
const { SentinelOrchestratorService, AI_PROFILES, FRONTIER_PATTERNS, clampMode } = require('../services/sentinelOrchestratorService');
const { normalizeSentinelPermissions } = require('../repositories/authRepository');
const { SENTINEL_MALE_FILTER } = require('../services/sentinelSpeechAudio');
const { removeThaiPoliteParticles } = require('../services/sentinel');

function buildSentinel({ benchmarkScore = 92, releaseAllowed = true, activeRunning = false, governanceCritical = false, pending = 0, providers = ['groq', 'openai'] } = {}) {
  const calls = { releaseGate: 0, training: 0, activeStart: 0, governanceExecute: 0, audit: [] };
  const service = new SentinelOrchestratorService({
    providers: { available: () => providers },
    production: { async overview() { return { ok: true, status: governanceCritical ? 'critical' : 'healthy', score: governanceCritical ? 42 : 96 }; } },
    governance: { async status(args = {}) { if (args.execute) calls.governanceExecute += 1; return { ok: true, status: governanceCritical ? 'critical' : 'healthy', score: governanceCritical ? 50 : 100, signals: governanceCritical ? [{ code: 'PRODUCTION_CRITICAL', severity: 'critical' }] : [] }; } },
    releaseGate: { async status(args = {}) { if (args.auto) calls.releaseGate += 1; return { ok: true, mergeAllowed: releaseAllowed && benchmarkScore >= 80, score: releaseAllowed && benchmarkScore >= 80 ? 100 : 80, blockers: benchmarkScore >= 80 ? [] : [{ id: 'benchmark_evidence' }], evidence: { benchmark: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }; } },
    benchmark: { status() { return { ok: true, availableProviders: providers, lastRun: { runId: 'bench-1', summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }, history: [{ runId: 'bench-1', summary: { sentinel: { rank: 1, score: benchmarkScore, wins: 2, cases: 3, passed: benchmarkScore >= 80 } } }] }; } },
    activeLearning: { async status() { return { ok: true, running: activeRunning, run: activeRunning ? { runId: 'al-1', status: 'running', stats: governanceCritical ? { consecutiveFailures: 4, unsafeShadow: 1 } : {}, options: { manualActivationRequired: true } } : null, history: [] }; }, async start() { calls.activeStart += 1; return { ok: true, running: true, run: { runId: 'al-new' } }; } },
    learning: { async status() { return { ok: true, policy: {}, events: [] }; }, repository: { async list() { return [{ versionId: 'v1', state: 'active' }]; } } },
    training: { async list() { return { ok: true, stats: { pending } }; }, async draftWithTeachers() { calls.training += 1; return { ok: true, candidates: [{ provider: 'groq' }] }; }, async autoProcessPending() { return { ok: true, processed: 1 }; } },
    audit: { record(event, payload) { calls.audit.push({ event, payload }); } }
  });
  return { service, calls };
}

(async () => {
  assert.equal(clampMode('autopilot'), 'autopilot');
  assert.equal(clampMode('bad'), 'observe');
  assert.deepEqual(normalizeSentinelPermissions([['core', 'command'].join(':'), 'chat']), ['sentinel:command', 'chat']);
  assert.deepEqual(Object.keys(AI_PROFILES), ['sentinel']);
  assert(AI_PROFILES.sentinel.boundaries.includes('no_auto_deploy'));
  assert(AI_PROFILES.sentinel.boundaries.includes('active_only_user_context'));
  assert(FRONTIER_PATTERNS.some((p) => p.id === 'agent_tools_handoffs_guardrails'));
  assert.equal(removeThaiPoliteParticles('สวัสดีครับ พร้อมทำงานแล้วค่ะ'), 'สวัสดี พร้อมทำงานแล้ว');
  assert.equal(removeThaiPoliteParticles('รับทราบค่ะ\nกำลังประมวลผลครับ'), 'รับทราบ\nกำลังประมวลผล');

  const healthy = await buildSentinel({ activeRunning: true }).service.cycle({ execute: false });
  assert.equal(healthy.status, 'healthy');
  assert(healthy.proposals.some((p) => p.id === 'sentinel_control_observe'));

  const low = buildSentinel({ benchmarkScore: 53, releaseAllowed: false, activeRunning: false });
  const lowReport = await low.service.cycle({ execute: true });
  assert(lowReport.proposals.some((p) => p.id === 'sentinel_trigger_release_gate'));
  assert(lowReport.proposals.some((p) => p.id === 'sentinel_benchmark_repair_training'));
  assert(lowReport.proposals.some((p) => p.id === 'sentinel_24h_learning_runner'));
  assert(low.calls.releaseGate >= 1);
  assert.equal(low.calls.training, 1);
  assert.equal(low.calls.activeStart, 1);

  const unsafe = buildSentinel({ governanceCritical: true, activeRunning: true, benchmarkScore: 90 });
  const unsafeReport = await unsafe.service.cycle({ execute: true });
  assert(unsafeReport.proposals.some((p) => p.id === 'sentinel_guard_active_learning'));
  assert(unsafe.calls.governanceExecute >= 1);
  assert.equal(unsafe.calls.activeStart, 0);

  const modeResult = await low.service.setMode('off', { userId: 'tester' });
  assert.equal(modeResult.mode, 'off');

  const api = fs.readFileSync('routes/api.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  const shell = fs.readFileSync('sentinel.html', 'utf8');
  assert(api.includes('router.post("/chat/stream"'), 'Sentinel must expose its SSE chat route');
  assert(api.includes('router.post("/sentinel/command"'), 'administrator commands must use the Sentinel route');
  assert(shell.includes('unlockVoiceAudio();'), 'a user gesture must unlock browser audio before the AI request');
  assert(shell.includes('await new Promise(resolve => setTimeout(resolve, 80))'), 'speech must avoid the Chromium cancel/speak race');
  assert(shell.includes('const startWatchdog = setTimeout'), 'desktop speech must detect silently dropped Chromium utterances');
  assert(shell.includes('await speakRemoteChunk(chunk.text, chunk.lang)'), 'speech must fall back when a native utterance fails');
  assert(SENTINEL_MALE_FILTER.includes('pitch=0.50:tempo=1.16'), 'server speech must match the supplied low-pitch reference while increasing tempo');
  assert(SENTINEL_MALE_FILTER.includes('bass=g=5'), 'server speech must reinforce the low male register');
  assert(shell.includes('u.pitch = 0.22'), 'Sentinel must use its low reference-matched male system-voice profile');
  assert(shell.includes('u.rate = 1.0'), 'Sentinel system voice must speak at a natural brisk pace');
  assert(shell.includes('deepVoiceNames'), 'Sentinel must prefer a deep voice available for the response language');
  assert(shell.includes('femaleVoiceNames'), 'Sentinel must reject explicitly female Thai system voices');
  assert(shell.includes('if (base === "th") return confirmedMale || null'), 'Thai speech must fall back to pitch-lowered audio unless a male voice is confirmed');
  assert(shell.includes('audio.playbackRate = 1.05'), 'processed Thai speech must play slightly faster without lowering pitch through slowdown');
  assert(shell.includes('ห้ามใช้คำลงท้ายภาษาไทยว่า ครับ ค่ะ หรือ คะ'), 'frontend requests must enforce Sentinel neutral Thai sentence endings');
  assert(api.includes('router.post("/speech"'), 'desktop Thai speech must use the authenticated same-origin audio proxy');
  assert(shell.includes('base + "/api/speech"'), 'desktop speech playback must avoid cross-origin media restrictions');
  assert(server.includes('mediaSrc: ["\'self\'", "blob:"]'), 'speech media must remain restricted to same-origin and generated blobs');
  assert(shell.includes('function initGlobalVoice()'), 'global user voice commands must remain available');
  assert(shell.includes('silenceTimer = setTimeout(finishListening, 1400)'), 'global recognition must wait for the user to finish speaking');
  assert(shell.includes('voiceState = "stopping"'), 'recognition must stop before AI processing starts');
  assert(shell.includes('await speak(res.text)'), 'AI processing must wait until speech playback really finishes');
  assert(shell.includes('if (voiceState === "idle") restartListening()'), 'the microphone may resume only after AI speech finishes');
  assert(!shell.includes('callProviderLocal'), 'provider secrets and direct provider calls must remain server-side');

  console.log('Phase 15 Single Sentinel orchestration tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
