(function () {
  "use strict";
  if (document.body?.dataset.geminiLiveEnabled !== "true") return;

  let currentStatus = { label: "กดไมค์เพื่อเริ่มเสียงสด", mode: "idle" };
  function syncChatButton() {
    const { label, mode } = currentStatus;
    const active = mode === "listening" || mode === "processing";
    for (const id of ["chat-mic", "desktop-voice"]) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("listening", active);
      button.classList.toggle("processing", mode === "processing");
      if (id === 'chat-mic' && window.PanthoriumWorkspace) button.innerHTML = window.PanthoriumWorkspace.icon(active ? 'stop' : 'mic');
      else button.textContent = active ? "⏹" : "🎤";
    }
  }
  let socket = null;
  let audioContext = null;
  let microphone = null;
  let processor = null;
  let mutedOutput = null;
  let activeSources = new Set();
  let nextPlaybackTime = 0;
  let serverReady = false;
  let starting = false;
  let sessionOwner = "chat";
  let outputTranscript = "";
  let inputTranscript = "";
  let chatUserRow = null;
  let chatAssistantRow = null;
  let sessionGeneration = 0;
  let cancelConnection = null;
  let resumeSessionId = null;
  let resumeEnabled = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let outputSuppressed = false;
  let activeContextKey = null;
  const MAX_INPUT_BUFFER_BYTES = 64 * 1024;
  const MAX_PLAYBACK_SECONDS = 4;
  const MAX_AUDIO_FRAME_BYTES = 512 * 1024;
  const cancelled = () => Object.assign(new Error("voice_session_cancelled"), { code: "voice_session_cancelled" });

  function updateChatTranscript(kind, text) {
    const messages = document.getElementById("chat-messages");
    if (!messages || !text) return;
    let row = kind === "user" ? chatUserRow : chatAssistantRow;
    if (!row?.isConnected) {
      row = document.createElement("div");
      row.className = "msg " + (kind === "user" ? "user" : "ai");
      messages.appendChild(row);
      if (kind === "user") chatUserRow = row; else chatAssistantRow = row;
    }
    row.textContent = text;
    messages.scrollTop = messages.scrollHeight;
  }
  const approvalDialogs = new Map();

  const setStatus = (label, mode = "idle") => {
    currentStatus = { label, mode };
    syncChatButton();
    window.dispatchEvent(new CustomEvent("panthorium:live-state", { detail:{mode,label} }));
    if (mode === "error") {
      const notice = document.getElementById("orb-system-notice");
      if (notice) { notice.textContent = label; notice.classList.add("show"); }
    }
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
    if (!audioContext || outputSuppressed || typeof base64 !== "string") return;
    if (base64.length > MAX_AUDIO_FRAME_BYTES * 4 / 3 + 4) { stopPlayback(); setStatus('เสียงตอบมีขนาดเกินขอบเขต กรุณาถามใหม่', 'error'); return; }
    let binary;
    try { binary = atob(base64); } catch (_) { return; }
    const length = Math.floor(binary.length / 2);
    if (!length) return;
    if (Math.max(0, nextPlaybackTime - audioContext.currentTime) + length / 24000 > MAX_PLAYBACK_SECONDS) {
      stopPlayback(); outputSuppressed = true;
      setStatus('หยุดเสียงที่ค้างแล้ว กรุณาถามใหม่', 'listening');
      return;
    }
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

  function sendToolApproval(frame, approved) {
    const approvalRequestId = String(frame.approvalRequestId || "");
    const callId = String(frame.callId || "");
    if (socket?.readyState === WebSocket.OPEN && approvalRequestId && callId) {
      socket.send(JSON.stringify({ type: "toolApprovalResult", approvalRequestId, callId, approved: approved === true }));
    }
  }

  function showToolApproval(frame) {
    const approvalRequestId = String(frame.approvalRequestId || "");
    if (!approvalRequestId || !String(frame.callId || "")) return;
    if (approvalDialogs.has(approvalRequestId)) return;
    const dialog = document.createElement("dialog");
    if (typeof dialog.showModal !== "function" && !frame.voiceChallenge) {
      sendToolApproval(frame, false);
      setStatus("เบราว์เซอร์ไม่รองรับการยืนยันคำสั่งนี้ จึงยกเลิกการทำรายการ", "listening");
      return;
    }

    dialog.setAttribute("aria-labelledby", `panthorium-approval-title-${approvalDialogs.size}`);
    dialog.style.cssText = "width:min(92vw,560px);max-height:82vh;overflow:auto;border:1px solid #718096;border-radius:16px;padding:22px;background:#101827;color:#f7fafc;box-shadow:0 18px 70px #000b;font:inherit;z-index:2147483000";
    const heading = document.createElement("h2");
    heading.id = dialog.getAttribute("aria-labelledby");
    heading.textContent = "อนุมัติการดำเนินการ";
    heading.style.cssText = "margin:0 0 8px;font-size:1.2rem";
    const description = document.createElement("p");
    description.textContent = String(frame.description || "Panthorium ต้องการเรียกใช้เครื่องมือ").slice(0, 240);
    const metadata = document.createElement("p");
    metadata.textContent = `เครื่องมือ: ${String(frame.toolId || frame.name || "unknown").slice(0, 100)} · ความเสี่ยง: ${String(frame.risk || "medium").slice(0, 24)}${frame.mutates ? " · มีการเปลี่ยนแปลงข้อมูล" : ""}`;
    const detailLabel = document.createElement("h3");
    detailLabel.textContent = "รายละเอียดที่จะส่งให้เครื่องมือ";
    detailLabel.style.cssText = "margin:16px 0 6px;font-size:1rem";
    const details = document.createElement("pre");
    details.textContent = JSON.stringify(frame.args ?? {}, null, 2).slice(0, 256000);
    details.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:34vh;overflow:auto;padding:12px;border-radius:8px;background:#080d16;color:#e2e8f0;font-size:.85rem";
    const note = document.createElement("p");
    note.textContent = frame.voiceChallenge?.phrase
      ? `ตรวจรายละเอียดก่อนยืนยัน หลังฟังรายการแล้วพูดว่า “${frame.voiceChallenge.phrase}” หรือกดอนุมัติ หากไม่ตรงให้ยกเลิก`
      : "คำสั่งจะทำงานหลังจากคุณกดอนุมัติเท่านั้น หากรายละเอียดไม่ตรง ให้ยกเลิก";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:18px";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "ยกเลิก";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "อนุมัติและดำเนินการ";
    approve.style.cssText = "background:#2563eb;color:white;border:0;border-radius:8px;padding:10px 14px;font:inherit;cursor:pointer";
    cancel.style.cssText = "background:#334155;color:white;border:0;border-radius:8px;padding:10px 14px;font:inherit;cursor:pointer";
    const reminderNeedsEmailConsent = frame.toolId === "reminders.write" && frame.args?.action === "create" && frame.args?.emailConsent === true;
    let emailConsent = null;
    if (reminderNeedsEmailConsent) {
      emailConsent = document.createElement("input");
      emailConsent.type = "checkbox";
      emailConsent.id = `panthorium-reminder-email-consent-${approvalDialogs.size}`;
      const consentLabel = document.createElement("label");
      consentLabel.htmlFor = emailConsent.id;
      consentLabel.textContent = "ฉันยินยอมให้ Panthorium ส่งอีเมลแจ้งเตือนนี้ไปยังอีเมลที่ยืนยันในบัญชี";
      consentLabel.style.cssText = "display:flex;align-items:flex-start;gap:10px;margin:12px 0;cursor:pointer";
      consentLabel.prepend(emailConsent);
      approve.textContent = "ยินยอมส่งอีเมลและดำเนินการ";
      approve.disabled = true;
      approve.style.opacity = ".55";
      emailConsent.addEventListener("change", () => { approve.disabled = !emailConsent.checked; approve.style.opacity = approve.disabled ? ".55" : "1"; });
      dialog.append(heading, description, metadata, detailLabel, details, note, consentLabel, actions);
    } else {
      dialog.append(heading, description, metadata, detailLabel, details, note, actions);
    }
    actions.append(cancel, approve);
    document.body.append(dialog);

    const finish = approved => {
      if (!approvalDialogs.has(approvalRequestId)) return;
      approvalDialogs.delete(approvalRequestId);
      sendToolApproval(frame, approved);
      if (dialog.open) dialog.close();
      dialog.remove();
      if (serverReady) setStatus("กำลังฟัง Gemini Live · แตะไมค์เพื่อจบ", "listening");
    };
    approvalDialogs.set(approvalRequestId, { dialog, finish });
    cancel.addEventListener("click", () => finish(false));
    approve.addEventListener("click", () => finish(!reminderNeedsEmailConsent || emailConsent?.checked === true));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
    dialog.addEventListener("click", event => { if (event.target === dialog) finish(false); });
    setStatus("Gemini Live รอการยืนยันก่อนดำเนินการ", "processing");
    try {
      if (typeof dialog.showModal === 'function') { dialog.showModal(); cancel.focus(); }
      else { dialog.setAttribute('open', ''); }
    } catch (_) { if (!frame.voiceChallenge) finish(false); }
  }

  function handleModelFrame(frame) {
    if (frame.type === 'conversationEvent' && frame.protocolVersion === 1) {
      window.dispatchEvent(new CustomEvent('panthorium:conversation-event', { detail: frame }));
      if (frame.event === 'approval.resolved') {
        const pending = approvalDialogs.get(frame.payload?.approvalRequestId);
        if (pending) { approvalDialogs.delete(frame.payload.approvalRequestId); if (pending.dialog.open && typeof pending.dialog.close === 'function') pending.dialog.close(); pending.dialog.remove(); }
      }
      if (frame.event === 'session.resume_unavailable') resumeEnabled = false;
      if (frame.event === 'approval.voice_unavailable') setStatus('ยืนยันด้วยเสียงไม่ได้ กรุณาตรวจและยืนยันบนอุปกรณ์', 'processing');
      if (frame.event === 'assistant.interrupted') stopPlayback();
      if (frame.event === 'session.go_away') setStatus(frame.payload?.resumeAvailable ? 'การเชื่อมต่อกำลังเปลี่ยน กรุณารอสักครู่' : 'การเชื่อมต่อใกล้สิ้นสุด กรุณาเริ่มใหม่หลังจบงาน', 'listening');
      return;
    }
    if (frame.type === "ready") {
      serverReady = true;
      resumeSessionId = typeof frame.sessionId === 'string' ? frame.sessionId : null;
      resumeEnabled = frame.resumable === true;
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
    if (frame.type === "toolApprovalRequired") {
      showToolApproval(frame);
      return;
    }
    if (frame.type === "toolResult") {
      if (frame.error) console.info("Gemini Live function result", frame.toolId || "unknown", frame.error);
      return;
    }
    const content = frame.serverContent || frame.server_content;
    if (!content) return;
    if (content.interrupted) { stopPlayback(); outputSuppressed = false; }
    const input = content.inputTranscription || content.input_transcription;
    const output = content.outputTranscription || content.output_transcription;
    if (input?.text) { outputSuppressed = false; inputTranscript += input.text; updateChatTranscript("user", inputTranscript); window.PanthoriumOrb?.setTranscript?.(inputTranscript, 0); }
    if (output?.text) { outputTranscript += output.text; updateChatTranscript("ai", outputTranscript); window.PanthoriumOrb?.setTranscript?.(outputTranscript, 0); }
    const parts = content.modelTurn?.parts || content.model_turn?.parts || [];
    for (const part of parts) {
      const audio = part.inlineData?.data || part.inline_data?.data;
      if (audio) { setStatus("Gemini Live กำลังตอบ", "listening"); playPcm24k(audio); }
    }
    if (content.turnComplete || content.turn_complete) {
      inputTranscript = ""; outputTranscript = ""; chatUserRow = null; chatAssistantRow = null;
      outputSuppressed = false;
      setStatus("Gemini Live พร้อมฟัง", "listening");
    }
  }

  async function openLiveSession(generation) {
    const ensureCurrent = () => { if (generation !== sessionGeneration) throw cancelled(); };
    inputTranscript = ""; outputTranscript = ""; chatUserRow = null; chatAssistantRow = null;
    outputSuppressed = false;
    setStatus("กำลังเปิดไมโครโฟน", "processing");
    window.dispatchEvent(new CustomEvent("panthorium:live-start"));
    window.PanthoriumVoice?.pause?.();
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      throw new Error("เบราว์เซอร์นี้ไม่รองรับไมโครโฟนเสียงสด");
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextCtor();
    await audioContext.resume();
    ensureCurrent();
    if (audioContext.state !== "running") throw new Error("เปิดเสียงไม่สำเร็จ กรุณาอนุญาตเสียงเว็บไซต์");
    const token = await getAccessToken();
    ensureCurrent();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (generation !== sessionGeneration) { stream.getTracks().forEach(track => track.stop()); throw cancelled(); }
    microphone = stream;
    socket = new WebSocket(backendWebSocketUrl());
    socket.binaryType = "arraybuffer";
    setStatus("กำลังเชื่อม Gemini Live", "processing");

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("เชื่อม Gemini Live ไม่สำเร็จ")), 45000);
      cancelConnection = () => { clearTimeout(timeout); reject(cancelled()); };
      const context = window.PanthoriumCloudApps?.voiceContext?.() || null;
      activeContextKey = JSON.stringify(context);
      socket.onopen = () => { if (generation !== sessionGeneration || !socket) return; socket.send(JSON.stringify({ type: "auth", token, protocolVersion: 1,
        ...(resumeSessionId && resumeEnabled ? { sessionId: resumeSessionId } : {}), context })); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error("เชื่อม Gemini Live ไม่สำเร็จ")); };
      socket.onclose = event => {
        clearTimeout(timeout);
        if (!serverReady) reject(new Error(event.reason || "Gemini Live ปฏิเสธการเชื่อมต่อ"));
        else {
          const canResume = resumeEnabled && resumeSessionId && !approvalDialogs.size && reconnectAttempts < 2 && [1006, 1011, 1012, 1013].includes(event.code);
          if (canResume) {
            reconnectAttempts++;
            cleanup(false, true);
            setStatus('การเชื่อมต่อขาด กำลังเชื่อมต่อใหม่โดยไม่ทำรายการซ้ำ', 'processing');
            const retryGeneration = sessionGeneration;
            reconnectTimer = setTimeout(async () => {
              reconnectTimer = null;
              if (retryGeneration !== sessionGeneration) return;
              starting = true;
              try { await openLiveSession(retryGeneration); }
              catch (error) { cleanup(); setStatus('กลับเข้าบทสนทนาไม่ได้ กรุณาเริ่มใหม่และตรวจสถานะงานเดิม', 'error'); }
              finally { starting = false; }
            }, reconnectAttempts * 500);
          } else { cleanup(false); setStatus(event.reason || "Gemini Live จบการเชื่อมต่อ · แตะไมค์เพื่อเริ่มใหม่"); }
        }
      };
      socket.onmessage = event => {
        let frame;
        try {
          const json = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
          frame = JSON.parse(json);
        } catch (_) { return; }
        if (frame.type === "ready") { clearTimeout(timeout); cancelConnection = null; serverReady = true; resolve(); }
        handleModelFrame(frame);
        if (frame.error) {
          clearTimeout(timeout);
          reject(new Error("Gemini Live ใช้งานไม่ได้ในขณะนี้"));
          cleanup();
          setStatus("Gemini Live ใช้งานไม่ได้ในขณะนี้ · แตะไมค์เพื่อลองใหม่", "error");
        }
      };
    });

    ensureCurrent();
    const source = audioContext.createMediaStreamSource(microphone);
    processor = audioContext.createScriptProcessor(1024, 1, 1);
    mutedOutput = audioContext.createGain();
    mutedOutput.gain.value = 0;
    processor.onaudioprocess = event => {
      if (!serverReady || socket?.readyState !== WebSocket.OPEN) return;
      // Capture/playback only: no offline recording, inference or request replay.
      if ((socket.bufferedAmount || 0) > MAX_INPUT_BUFFER_BYTES) {
        setStatus('เครือข่ายส่งเสียงไม่ทัน กรุณาหยุดแล้วพูดใหม่', 'listening');
        return;
      }
      const samples = downsample(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
      if (!samples.length) return;
      socket.send(JSON.stringify({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: pcm16Base64(samples) } } }));
    };
    source.connect(processor);
    processor.connect(mutedOutput);
    mutedOutput.connect(audioContext.destination);
  }

  function cleanup(closeSocket = true, preserveResume = false) {
    sessionGeneration++;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (!preserveResume) { resumeSessionId = null; resumeEnabled = false; reconnectAttempts = 0; }
    cancelConnection?.(); cancelConnection = null;
    serverReady = false;
    for (const pending of approvalDialogs.values()) {
      if (pending.dialog.open && typeof pending.dialog.close === 'function') pending.dialog.close();
      pending.dialog.remove();
    }
    approvalDialogs.clear();
    const closingSocket = socket;
    if (closingSocket) { closingSocket.onopen = null; closingSocket.onclose = null; closingSocket.onerror = null; closingSocket.onmessage = null; }
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (_) {} processor = null; }
    if (mutedOutput) { try { mutedOutput.disconnect(); } catch (_) {} mutedOutput = null; }
    if (microphone) { for (const track of microphone.getTracks()) track.stop(); microphone = null; }
    stopPlayback();
    if (closeSocket && socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "user_stopped");
    socket = null;
    if (audioContext) { const context = audioContext; audioContext = null; context.close().catch(() => {}); }
    setStatus("กดไมค์เพื่อเริ่มเสียงสด");
  }

  // Desktop and chat controls share one microphone and one Live connection.
  async function toggle(owner = "chat") {
    if (starting || reconnectTimer) { cleanup(); return; }
    if (socket && socket.readyState < WebSocket.CLOSING) { cleanup(); return; }
    starting = true;
    sessionOwner = owner;
    try { await openLiveSession(sessionGeneration); }
    catch (error) { if (error.code === "voice_session_cancelled") return; console.warn("Gemini Live voice session failed", error); cleanup(); setStatus(error.name === "NotAllowedError" || error.name === "SecurityError"
      ? "กรุณาอนุญาตไมโครโฟนให้ Panthorium Browser แล้วลองใหม่"
      : error.message || "เชื่อมเสียงสดไม่สำเร็จ", "error"); }
    finally { starting = false; }
  }
  window.PanthoriumLiveVoice = {
    toggle, stop:cleanup,
    stopPlayback:() => { outputSuppressed = true; stopPlayback(); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stopPlayback' })); },
    isActive:() => serverReady, syncChatButton,
    stopChatSession:() => { if (sessionOwner === "chat") cleanup(); }
  };
  document.getElementById("desktop-voice")?.addEventListener("click", () => toggle("desktop"));
  window.addEventListener('panthorium:cloud-app-context', event => {
    const next = JSON.stringify(event.detail || null);
    if ((serverReady || starting || reconnectTimer) && activeContextKey !== null && next !== activeContextKey) {
      cleanup(); activeContextKey = next;
      setStatus('บริบทงานเปลี่ยนแล้ว แตะไมค์เพื่อเริ่มคุยในงานที่เลือก');
    }
  });
  window.addEventListener("panthorium:auth-changed", () => {
    if (!window.PanthoriumAuth?.getAccessToken?.()) cleanup();
  });
  syncChatButton();
  window.addEventListener("pagehide", () => cleanup());
})();


