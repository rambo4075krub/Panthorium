(function () {
  'use strict';
  function getOS() { try { return typeof OS !== 'undefined' ? OS : null; } catch (_) { return null; } }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  async function refreshAuth() {
    const system = getOS(); if (system?.config?.accessToken) return system.config.accessToken;
    if (window.PanthoriumAuth?.refreshSession) { const ok = await window.PanthoriumAuth.refreshSession().catch(() => false); if (ok && system?.config?.accessToken) return system.config.accessToken; }
    return '';
  }
  async function api(path, options = {}, retry = true) {
    const system = getOS(); let token = system?.config?.accessToken || ''; if (!token) token = await refreshAuth();
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }; if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...options, headers, credentials: 'include' }); const data = await res.json().catch(() => ({}));
    if (res.status === 401 && retry && window.PanthoriumAuth?.refreshSession) { const ok = await window.PanthoriumAuth.refreshSession().catch(() => false); if (ok) return api(path, options, false); }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
  }
  function card(label, value, sub) { return `<div style="padding:12px;border:1px solid #263548;border-radius:10px;background:#0b1220"><div style="font-size:11px;color:#8fa3bb">${esc(label)}</div><div style="font-size:20px;font-weight:700;margin-top:4px">${esc(value)}</div>${sub ? `<div style="font-size:10px;color:#64748b;margin-top:3px">${esc(sub)}</div>` : ''}</div>`; }
  function openDashboard() {
    if (document.getElementById('phase4-ai-dashboard')) return;
    const wrap = document.createElement('div'); wrap.id = 'phase4-ai-dashboard';
    wrap.style.cssText = 'position:fixed;inset:6%;z-index:9998;background:rgba(8,12,20,.98);border:1px solid #334155;border-radius:16px;color:#e2e8f0;padding:20px;overflow:auto;font-family:system-ui;box-shadow:0 24px 80px #000';
    wrap.innerHTML = '<button id="ai-close" style="float:right">✕</button><h2>🧠 AI Platform</h2><div style="display:flex;gap:8px;margin:8px 0 14px"><button id="ai-refresh">รีเฟรช</button><select id="ai-window"><option value="1">1 ชั่วโมง</option><option value="24" selected>24 ชั่วโมง</option><option value="168">7 วัน</option></select></div><div id="ai-status">กำลังโหลด...</div><h3>AI Operations</h3><div id="ai-metrics" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px"></div><h3>Provider Health</h3><div id="ai-providers"></div><h3>Conversations</h3><div id="ai-conversations"></div>';
    document.body.appendChild(wrap); document.getElementById('ai-close').onclick = () => wrap.remove(); document.getElementById('ai-refresh').onclick = refresh; document.getElementById('ai-window').onchange = refresh; refresh();
  }
  async function deleteConversation(sessionId) {
    if (!confirm(`ลบบทสนทนา ${sessionId} หรือไม่?`)) return;
    try { await api('/api/conversations/' + encodeURIComponent(sessionId), { method: 'DELETE' }); if (typeof toast === 'function') toast('ลบบทสนทนาแล้ว'); refresh(); }
    catch (e) { if (typeof toast === 'function') toast('ลบไม่สำเร็จ: ' + e.message); }
  }
  async function refresh() {
    const status = document.getElementById('ai-status'); if (!status) return; status.textContent = 'กำลังโหลด AI Operations...';
    try {
      const hours = document.getElementById('ai-window')?.value || '24';
      const [providers, conversations, operations] = await Promise.all([api('/api/ai/providers'), api('/api/conversations'), api('/api/ai/operations?hours=' + encodeURIComponent(hours))]);
      const m = operations.metrics || {};
      status.textContent = `Configured ${providers.providers.filter(p => p.configured).length}/${providers.providers.length} providers · ${m.conversations || 0} conversations · ${m.persistence || '-'}`;
      document.getElementById('ai-metrics').innerHTML = [
        card('Requests', m.requests || 0, `${m.windowHours || hours}h`), card('Success rate', `${m.successRate || 0}%`), card('Total tokens', m.totalTokens || 0, `in ${m.inputTokens || 0} · out ${m.outputTokens || 0}`), card('Avg latency', `${m.avgLatencyMs || 0} ms`, `p95 ${m.p95LatencyMs || 0} ms`), card('Fallbacks', m.fallbacks || 0), card('Streams', m.streams || 0, `native ${m.nativeStreams || 0}`), card('Conversations', m.conversations || 0), card('Messages', m.messages || 0)
      ].join('');
      const opMap = new Map((m.providers || []).map(p => [p.provider, p]));
      document.getElementById('ai-providers').innerHTML = providers.providers.map(p => { const op = opMap.get(p.provider) || {}; const health = p.configured ? (op.health || 'idle') : 'not-configured'; const badge = health === 'healthy' ? '🟢' : health === 'degraded' ? '🟠' : health === 'down' ? '🔴' : '⚪'; return `<div style="padding:10px;border-bottom:1px solid #1e293b"><b>${esc(p.provider)}</b> · ${esc(p.model || '-')} · ${p.configured ? 'READY' : 'NOT CONFIGURED'} · ${esc(p.streaming || 'unknown')}<div style="font-size:11px;color:#8fa3bb;margin-top:3px">${badge} ${esc(health)} · requests ${esc(op.requests || 0)} · failures ${esc(op.failures || 0)} · tokens ${esc(op.tokens || 0)} · avg ${esc(op.avgLatencyMs || 0)} ms</div></div>`; }).join('');
      const conv = document.getElementById('ai-conversations'); conv.innerHTML = conversations.sessions.length ? conversations.sessions.map(s => `<div style="padding:9px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(s.sessionId)}</b> · ${esc(s.messages || '?')} messages<div style="font-size:10px;color:#64748b">${s.updatedAt ? new Date(s.updatedAt).toLocaleString('th-TH') : ''}</div></div><button data-ai-delete="${esc(s.sessionId)}">ลบ</button></div>`).join('') : '<div>ยังไม่มีบทสนทนา</div>';
      conv.querySelectorAll('[data-ai-delete]').forEach(btn => btn.onclick = () => deleteConversation(btn.getAttribute('data-ai-delete')));
    } catch (e) { status.textContent = e.message === 'authentication_required' ? 'กรุณาเข้าสู่ระบบใหม่เพื่อเปิด AI Platform' : `โหลดข้อมูลไม่สำเร็จ: ${e.message}`; }
  }
  function installLauncher() {
    const menu = document.querySelector('.start-menu, #start-menu'); if (!menu || document.getElementById('phase4-ai-launcher')) return;
    const btn = document.createElement('button'); btn.id = 'phase4-ai-launcher'; btn.textContent = '🧠 AI Platform'; btn.style.cssText = 'display:block;width:100%;padding:10px;text-align:left'; btn.onclick = openDashboard; menu.appendChild(btn);
  }
  window.PanthoriumAI = { open: openDashboard, refresh };
  window.addEventListener('panthorium:auth-changed', () => { if (document.getElementById('phase4-ai-dashboard')) refresh(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installLauncher); else installLauncher();
  setInterval(installLauncher, 2000);
})();
