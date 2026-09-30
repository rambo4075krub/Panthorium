'use strict';

const assert = require('assert');
const fs = require('fs');
const { SentinelOrchestratorService, AI_PROFILES, FRONTIER_PATTERNS, clampMode } = require('../services/sentinelOrchestratorService');
const { normalizeSentinelPermissions } = require('../repositories/authRepository');
const { SENTINEL_MALE_VOICES, applySentinelPronunciations } = require('../services/sentinelSpeechAudio');
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
  assert.equal(applySentinelPronunciations('Panthorium OS is online'), 'แพนทอเรี่ยมโอเอส is online');
  assert.equal(applySentinelPronunciations('panthorium   os'), 'แพนทอเรี่ยมโอเอส');

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
  const sentinelService = fs.readFileSync('services/sentinel.js', 'utf8');
  const gatewayService = fs.readFileSync('services/aiGateway.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  const shell = fs.readFileSync('sentinel.html', 'utf8');
  assert(api.includes('router.post("/chat/stream"'), 'Sentinel must expose its SSE chat route');
  assert(api.includes('router.post("/sentinel/command"'), 'administrator commands must use the Sentinel route');
  assert(shell.includes('unlockVoiceAudio();'), 'a user gesture must unlock browser audio before the AI request');
  assert(!shell.includes('await new Promise(resolve => setTimeout(resolve, 80))'), 'system speech must not wait for a browser-native voice queue');
  assert.equal(SENTINEL_MALE_VOICES['th-TH'], 'th-TH-NiwatNeural', 'Thai speech must use the configured Niwat system voice');
  assert.equal(SENTINEL_MALE_VOICES['en-US'], 'th-TH-NiwatNeural', 'English speech must keep the same Niwat voice');
  assert(!shell.includes('previousChunkLanguage !== chunk.lang'), 'language switches must not add artificial silence');
  assert(shell.includes('lang: "th-TH"'), 'all mixed-language speech chunks must use one Niwat voice');
  assert(shell.includes('const preparedRemotePromises = chunks.map'), 'upcoming Niwat audio chunks should preload during playback');
  assert(shell.includes('audio.ontimeupdate = () => updateTranscript(false)'), 'Niwat audio must advance the current transcript on desktop and mobile');
  assert(shell.includes('showOrbTranscriptForChar(charIndex)'), 'speech progress must move the active sentence into the center transcript row');
  assert(shell.includes('transcriptStartChar, transcriptEndChar'), 'each synthesized chunk must retain its position in the complete transcript');
  assert(fs.readFileSync('services/sentinelSpeechAudio.js', 'utf8').includes('lang: "th-TH"'), 'the system must synthesize every language through Thai Niwat');
  assert(shell.includes('voice: conversationalVoice'), 'spoken questions, not system commands, must identify the low-latency chat path');
  assert(api.includes('voiceMode: voice === true'), 'the speech flag must reach Sentinel without exposing an admin mode');
  assert(sentinelService.includes('historyLimit: voiceMode ? 12 : 40'), 'voice commands must use bounded recent context for faster processing');
  assert(!sentinelService.includes('โหมดสนทนาด้วยเสียง: ตอบให้ตรงคำถามและไม่เกิน 2 ประโยค'), 'voice replies must not be limited to two sentences');
  assert(!shell.includes('speechSynthesis.speak(u)'), 'device voices must not substitute for the Niwat system voice');
  assert(shell.includes('const pieces = [];') && shell.includes('lang: "th-TH"'), 'Thai and English text must remain in one language/voice path');
  assert(gatewayService.includes('orderedProviders(preferredProvider, streamingFirst = false)'), 'voice streaming should prioritize providers that return native deltas');
  assert(sentinelService.includes('โหมดตอบด้วยเสียง: เริ่มตอบประเด็นสำคัญทันที'), 'voice answers should be concise and speech-ready');
  assert(shell.includes('const expectedMaleProfile = "th-TH-NiwatNeural"'), 'the client must reject audio that is not Niwat');
  assert(api.includes('if (lang === "th-TH" || lang === "en-US") throw neuralError'), 'the server must not replace Thai or English speech with another voice');
  assert(shell.includes('audio.playbackRate = 1.0'), 'neural speech must play without artificial pitch or tempo distortion');
  assert(shell.includes('ห้ามใช้คำลงท้ายภาษาไทยว่า ครับ ค่ะ หรือ คะ'), 'frontend requests must enforce Sentinel neutral Thai sentence endings');
  assert(api.includes('router.post("/speech"'), 'desktop Thai speech must use the authenticated same-origin audio proxy');
  assert(shell.includes('base + "/api/speech"'), 'desktop speech playback must avoid cross-origin media restrictions');
  assert(server.includes('mediaSrc: ["\'self\'", "blob:"]'), 'speech media must remain restricted to same-origin and generated blobs');
  assert(shell.includes('function initGlobalVoice()'), 'global user voice commands must remain available');
  assert(shell.includes('silenceTimer = setTimeout(finishListening, 1800)'), 'global recognition must wait through natural speech pauses');
  assert(shell.includes('voiceState = "stopping"'), 'recognition must stop before AI processing starts');
  assert(shell.includes('recognition.continuous = !mobileSpeech'), 'mobile speech recognition must use reliable one-command sessions');
  assert(shell.includes('await navigator.mediaDevices.getUserMedia'), 'mobile speech must request microphone access from a direct user gesture');
  assert(shell.includes('setTimeout(() => { if (!autoResume || recognitionBlocked) return; try { recognition.start(); }'), 'automatic startup must respect explicit pause and recognition failure');
  assert(shell.includes('ยังไม่ได้ยินเสียง ตรวจสอบสิทธิ์ไมโครโฟน'), 'mobile speech must report when no microphone signal reaches recognition');
  assert(shell.includes('const shouldProcess = !discardOnEnd && !!text'), 'mobile recognition must process captured interim text when the browser ends the session');
  assert(shell.includes('finishListening({ discard: false })'), 'tapping stop on mobile must submit the captured command instead of discarding it');
  assert(shell.includes('await speakVoiceResponse(res.text)'), 'AI processing must await the shared speech completion handler');
  assert(shell.includes('if (voiceState === "idle") restartListening()'), 'the microphone may resume only after AI speech finishes');
  assert(!shell.includes('callProviderLocal'), 'provider secrets and direct provider calls must remain server-side');

  console.log('Phase 15 Single Sentinel orchestration tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
