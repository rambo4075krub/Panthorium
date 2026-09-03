(function () {
  'use strict';
  function getOS() { try { return typeof OS !== 'undefined' ? OS : null; } catch (_) { return null; } }
  function emit(type, detail) { try { window.dispatchEvent(new CustomEvent(`panthorium:ai-${type}`, { detail })); } catch (_) {} }
  async function ensureToken() {
    const system = getOS(); if (system?.config?.accessToken) return system.config.accessToken;
    if (window.PanthoriumAuth?.refreshSession) {
      const ok = await window.PanthoriumAuth.refreshSession().catch(() => false);
      if (ok) return getOS()?.config?.accessToken || '';
    }
    return '';
  }
  async function streamCall(prompt) {
    const system = getOS();
    if (window.PanthoriumAuth?.hasPermission && !window.PanthoriumAuth.hasPermission('chat')) return { ok: false, text: 'บัญชีนี้ไม่มีสิทธิ์ใช้งาน Chat', provider: 'RBAC', via: 'rbac' };
    let token = await ensureToken(); if (!token) throw new Error('authentication_required');
    const base = (system?.config?.backendUrl || '').replace(/\/$/, '');
    const request = async () => fetch(base + '/api/chat/stream', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-session-id': system.config.sessionId }, body: JSON.stringify({ message: prompt, sessionId: system.config.sessionId, mode: 'default' }) });
    let res = await request();
    if (res.status === 401 && window.PanthoriumAuth?.refreshSession) { const ok = await window.PanthoriumAuth.refreshSession().catch(() => false); if (ok) { token = getOS()?.config?.accessToken || ''; res = await request(); } }
    if (!res.ok || !res.body) throw new Error(`stream_http_${res.status}`);
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let text = ''; let meta = {};
    while (true) {
      const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
      for (const frame of frames) {
        let event = 'message'; let data = null;
        for (const line of frame.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); if (line.startsWith('data:')) { try { data = JSON.parse(line.slice(5).trim()); } catch (_) {} } }
        if (!data) continue;
        if (event === 'provider') { meta = { ...meta, ...data }; emit('provider', data); }
        if (event === 'delta') { text += data.delta || ''; emit('stream', { delta: data.delta || '', text }); }
        if (event === 'done') { meta = { ...meta, ...data }; emit('done', { ...meta, text }); }
        if (event === 'error') throw new Error(data.error || 'stream_failed');
      }
    }
    return { ok: true, text, provider: meta.provider ? `Core→${meta.provider}` : 'Sentinel Core', via: 'core-stream', model: meta.model || null, usage: meta.usage || null, latencyMs: meta.latencyMs || null, streaming: meta.streaming || 'unknown' };
  }
  function installVisualStreaming() {
    if (window.__panthoriumStreamVisualInstalled) return; window.__panthoriumStreamVisualInstalled = true;
    window.addEventListener('panthorium:ai-stream', (event) => {
      const loading = document.querySelector('#chat-messages .msg.loading'); if (!loading) return;
      loading.classList.remove('loading'); loading.dataset.streaming = '1'; loading.textContent = event.detail?.text || '';
      const container = document.getElementById('chat-messages'); if (container) container.scrollTop = container.scrollHeight;
    });
  }
  function installCallAI() {
    if (typeof callAI !== 'function') return false;
    const previous = callAI; if (previous.__panthoriumStreaming) return true;
    const wrapped = async function (prompt) {
      try { const result = await streamCall(prompt); if (result.text) return result; }
      catch (error) { console.warn('[Phase4 Stream]', error.message); }
      return previous(prompt);
    };
    wrapped.__panthoriumStreaming = true; callAI = wrapped; return true;
  }
  installVisualStreaming();
  let attempts = 0; const timer = setInterval(() => { attempts += 1; if (installCallAI() || attempts > 60) clearInterval(timer); }, 100);
  window.addEventListener('panthorium:auth-changed', () => setTimeout(installCallAI, 50));
  window.PanthoriumAIStream = { call: streamCall, install: installCallAI };
})();
