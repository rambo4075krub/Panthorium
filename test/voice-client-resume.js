'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  const dom = new JSDOM('<body data-gemini-live-enabled="true"><button id="desktop-voice"></button><button id="chat-mic"></button><div id="chat-messages"></div></body>');
  let processor; let starts = 0; let stops = 0; let micStops = 0;
  const listeners = new Map(); const sockets = [];
  let task = { packId: 'learning', featureId: 'notes', scope: 'personal', sessionId: 'cloud-task' };
  class AudioContext {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0; }
    async resume() {} async close() {}
    createMediaStreamSource() { return { connect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {} }; return processor; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return { connect() {}, start() { starts++; }, stop() { stops++; } }; }
  }
  class Socket {
    static OPEN = 1; static CLOSING = 2;
    constructor() { this.readyState = 1; this.bufferedAmount = 0; this.sent = []; sockets.push(this); setImmediate(() => { this.onopen?.(); this.frame({ type: 'ready', sessionId: '00000000-0000-0000-0000-000000000001', resumable: true }); }); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
    frame(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    disconnected() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' }); }
  }
  const window = { AudioContext, location: { origin: 'https://test' }, PanthoriumAuth: { ensureSession: async () => {}, getAccessToken: () => 'token' },
    PanthoriumCloudApps: { voiceContext: () => task }, speechSynthesis: { cancel() {} }, dispatchEvent() {}, addEventListener: (name, callback) => listeners.set(name, callback) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../live-voice-client.js'), 'utf8'), { window, document: dom.window.document,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { micStops++; } }] }) } },
    WebSocket: Socket, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    TextDecoder, Uint8Array, DataView, Float32Array, Set, Math, Promise, setTimeout, clearTimeout, console,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary') });
  await window.PanthoriumLiveVoice.toggle();
  assert.equal(sockets[0].sent[0].context.packId, 'learning');
  sockets[0].bufferedAmount = 65537;
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(1024).fill(.1) } });
  assert.equal(sockets[0].sent.length, 1, 'congested input is dropped, never buffered for replay');
  sockets[0].bufferedAmount = 0;
  const audio = { serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(24000).toString('base64') } }] } } };
  sockets[0].frame(audio); assert.equal(starts, 1);
  window.PanthoriumLiveVoice.stopPlayback(); assert.equal(stops, 1, 'explicit stop silences playback immediately');
  sockets[0].frame(audio); assert.equal(starts, 1, 'late output is suppressed after explicit stop');
  sockets[0].frame({ serverContent: { inputTranscription: { text: 'คำถามใหม่' } } });
  for (let i = 0; i < 12; i++) sockets[0].frame(audio);
  assert(starts <= 9, 'playback cannot queue more than four seconds');
  const firstFrameCount = sockets[0].sent.length;
  sockets[0].disconnected();
  await new Promise(resolve => setTimeout(resolve, 550)); await tick();
  assert.equal(sockets.length, 2); assert.equal(sockets[1].sent.length, 1, 'resume sends auth, never old audio or approvals');
  assert.equal(sockets[1].sent[0].sessionId, '00000000-0000-0000-0000-000000000001');
  assert.equal(sockets[0].sent.length, firstFrameCount);
  listeners.get('panthorium:cloud-app-context')({ detail: { ...task } });
  assert(window.PanthoriumLiveVoice.isActive(), 'republishing identical task context preserves voice');
  task = { ...task, featureId: 'plan' }; listeners.get('panthorium:cloud-app-context')({ detail: task });
  assert(!window.PanthoriumLiveVoice.isActive(), 'a task switch requires fresh verified cloud context');

  await window.PanthoriumLiveVoice.toggle();
  sockets[2].frame({ type: 'toolApprovalRequired', approvalRequestId: 'approval', callId: 'call', toolId: 'notes.write', args: { title: 'private' }, voiceChallenge: { phrase: 'ยืนยัน private รหัส 123456' } });
  sockets[2].disconnected(); await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(sockets.length, 3, 'pending approval is cancelled on disconnect, never resumed or replayed');
  assert(micStops >= 3);
  window.PanthoriumLiveVoice.stop(); dom.window.close();
  console.log('Browser voice: bounded capture/playback, immediate stop, context changes and safe reconnect passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
