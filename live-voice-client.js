(function () {
  "use strict";
  if (document.body?.dataset.geminiLiveEnabled !== "true") return;

  const button = document.getElementById("global-voice");
  if (!button) return;
  let socket = null;
  let audioContext = null;
  let microphone = null;
  let processor = null;
  let mutedOutput = null;
  let activeSources = new Set();
  let nextPlaybackTime = 0;
  let serverReady = false;
  let starting = false;
  let outputTranscript = "";

  const setStatus = (label, mode = "idle") => {
    button.title = label;
    const notice = document.getElementById("orb-system-notice");
    if (notice) { notice.textContent = label; notice.classList.toggle("show", true); }
    document.querySelectorAll("[data-voice-status]").forEach(row => { row.classList.toggle("active", row.dataset.voiceStatus === mode); if (row.dataset.voiceStatus === mode) row.textContent = label; });
    window.dispatchEvent(new CustomEvent("panthorium:live-state", { detail:{mode,label} }));
    button.classList.toggle("listening", mode === "listening");
    button.classList.toggle("processing", mode === "processing");
    button.textContent = mode === "processing" ? "⏳" : mode === "listening" ? "⏹" : "🎤";
  };

  function backendWebSocketUrl() {
    const base = window.PanthoriumAuth?.getBackendUrl?.() || window.location.origin;
    return base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:").replace(/\/$/, "") + "/api/live";
  }

  async function getAccessToken() {
    const auth = window.PanthoriumAuth;
    if (!auth) throw new Error("Panthorium auth unavailable");
    await auth.ensureSession?.();
    const token = auth.getAccessToken?.();
    if (!token) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้เสียงสด");
    return token;
  }

  function pcm16Base64(floatSamples) {
    const bytes = new Uint8Array(floatSamples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < floatSamples.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, floatSamples[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return btoa(binary);
  }

  function downsample(samples, inputRate, outputRate = 16000) {
    if (inputRate <= outputRate) return samples;
    const ratio = inputRate / outputRate;
    const output = new Float32Array(Math.floor(samples.length / ratio));
    for (let i = 0; i < output.length; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let total = 0;
      for (let j = start; j < end; j += 1) total += samples[j];
      output[i] = total / Math.max(1, end - start);
    }
    return output;
  }

  function playPcm24k(base64) {
    if (!audioContext || typeof base64 !== "string") return;
    const binary = atob(base64);
    const length = Math.floor(binary.length / 2);
    if (!length) return;
    const audio = audioContext.createBuffer(1, length, 24000);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const value = (binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8));
      channel[i] = (value & 0x8000) ? (value - 0x10000) / 0x8000 : value / 0x7fff;
    }
    const source = audioContext.createBufferSource();
    source.buffer = audio;
    source.connect(audioContext.destination);
    const startAt = Math.max(audioContext.currentTime + 0.025, nextPlaybackTime);
    nextPlaybackTime = startAt + audio.duration;
    activeSources.add(source);
    window.dispatchEvent(new CustomEvent("panthorium:ai-speaking", { detail:{speaking:true} }));
    source.onended = () => { activeSources.delete(source); if (!activeSources.size) window.dispatchEvent(new CustomEvent("panthorium:ai-speaking", {detail:{speaking:false}})); };
    source.start(startAt);
  }

  function stopPlayback() {
    nextPlaybackTime = audioContext?.currentTime || 0;
    for (const source of activeSources) {
      try { source.stop(); } catch (_) {}
    }
    activeSources.clear();
    window.dispatchEvent(new CustomEvent("panthorium:ai-speaking", {detail:{speaking:false}}));
  }

  function handleModelFrame(frame) {
    if (frame.type === "ready") {
      serverReady = true;
      setStatus("กำลังฟัง Gemini Live · แตะไมค์เพื่อจบ", "listening");
      return;
    }
    if (frame.type === "uiAction") {
      const requestId = String(frame.requestId || "");
      const action = String(frame.action || "");
      Promise.resolve(window.PanthoriumVoiceCommands?.windowAction?.(action))
        .then(result => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "uiActionResult", requestId, result: { ok: result?.ok === true, error: result?.error || null, text: result?.text || "" } }));
        })
        .catch(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "uiActionResult", requestId, result: { ok: false, error: "ui_action_failed" } }));
        });
      return;
    }
    if (frame.type === "toolResult") {
      if (frame.error) console.info("Gemini Live function result", frame.toolId || "unknown", frame.error);
      return;
    }
    const content = frame.serverContent || frame.server_content;
    if (!content) return;
    if (content.interrupted) stopPlayback();
    const input = content.inputTranscription || content.input_transcription;
    const output = content.outputTranscription || content.output_transcription;
    if (input?.text) { outputTranscript = ""; window.PanthoriumOrb?.setTranscript?.(input.text, 0); }
    if (output?.text) { outputTranscript += output.text; window.PanthoriumOrb?.setTranscript?.(outputTranscript, 0); }
    const parts = content.modelTurn?.parts || content.model_turn?.parts || [];
    for (const part of parts) {
      const audio = part.inlineData?.data || part.inline_data?.data;
      if (audio) { setStatus("Gemini Live กำลังตอบ", "listening"); playPcm24k(audio); }
    }
    if (content.turnComplete || content.turn_complete) setStatus("Gemini Live พร้อมฟัง", "listening");
  }

  async function openLiveSession() {
    window.dispatchEvent(new CustomEvent("panthorium:live-start"));
    window.PanthoriumVoice?.pause?.();
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      throw new Error("เบราว์เซอร์นี้ไม่รองรับไมโครโฟนเสียงสด");
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextCtor();
    await audioContext.resume();
    if (audioContext.state !== "running") throw new Error("เปิดเสียงไม่สำเร็จ กรุณาอนุญาตเสียงเว็บไซต์");
    const token = await getAccessToken();
    microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    socket = new WebSocket(backendWebSocketUrl());
    socket.binaryType = "arraybuffer";
    setStatus("กำลังเชื่อม Gemini Live", "processing");

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("เชื่อม Gemini Live ไม่สำเร็จ")), 45000);
      socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token }));
      socket.onerror = () => { clearTimeout(timeout); reject(new Error("เชื่อม Gemini Live ไม่สำเร็จ")); };
      socket.onclose = event => {
        clearTimeout(timeout);
        if (!serverReady) reject(new Error(event.reason || "Gemini Live ปฏิเสธการเชื่อมต่อ"));
        else { cleanup(false); setStatus(event.reason || "Gemini Live จบการเชื่อมต่อ · แตะไมค์เพื่อเริ่มใหม่"); }
      };
      socket.onmessage = event => {
        let frame;
        try {
          const json = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
          frame = JSON.parse(json);
        } catch (_) { return; }
        if (frame.type === "ready") { clearTimeout(timeout); serverReady = true; resolve(); }
        handleModelFrame(frame);
        if (frame.error) {
          clearTimeout(timeout);
          reject(new Error("Gemini Live ใช้งานไม่ได้ในขณะนี้"));
          cleanup();
          setStatus("Gemini Live ใช้งานไม่ได้ในขณะนี้ · แตะไมค์เพื่อลองใหม่");
        }
      };
    });

    const source = audioContext.createMediaStreamSource(microphone);
    processor = audioContext.createScriptProcessor(1024, 1, 1);
    mutedOutput = audioContext.createGain();
    mutedOutput.gain.value = 0;
    processor.onaudioprocess = event => {
      if (!serverReady || socket?.readyState !== WebSocket.OPEN) return;
      const samples = downsample(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
      if (!samples.length) return;
      socket.send(JSON.stringify({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: pcm16Base64(samples) } } }));
    };
    source.connect(processor);
    processor.connect(mutedOutput);
    mutedOutput.connect(audioContext.destination);
  }

  function cleanup(closeSocket = true) {
    serverReady = false;
    const closingSocket = socket;
    if (closingSocket) { closingSocket.onclose = null; closingSocket.onerror = null; closingSocket.onmessage = null; }
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (_) {} processor = null; }
    if (mutedOutput) { try { mutedOutput.disconnect(); } catch (_) {} mutedOutput = null; }
    if (microphone) { for (const track of microphone.getTracks()) track.stop(); microphone = null; }
    stopPlayback();
    if (closeSocket && socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "user_stopped");
    socket = null;
    if (audioContext) { const context = audioContext; audioContext = null; context.close().catch(() => {}); }
    setStatus("กดไมค์เพื่อเริ่มเสียงสด");
  }

  // Intercept the global voice button during capture so the legacy
  // Sentinel transcription onclick cannot consume the click first.
  async function toggle() {
    if (starting) return;
    if (socket && socket.readyState < WebSocket.CLOSING) { cleanup(); return; }
    starting = true;
    try { await openLiveSession(); }
    catch (error) { console.warn("Gemini Live voice session failed", error); cleanup(); setStatus(error.message || "เชื่อมเสียงสดไม่สำเร็จ"); }
    finally { starting = false; }
  }
  window.PanthoriumLiveVoice = { toggle, stop:cleanup, isActive:() => serverReady };
  button.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); toggle(); }, true);
  window.addEventListener("pagehide", () => cleanup());
})();


