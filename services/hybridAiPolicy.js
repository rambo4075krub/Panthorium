'use strict';
const {hasQuota} = require('../billing-catalog');
function localEnabled(env = process.env) { return env.PANTHORIUM_LOCAL_QWEN === '1' && env.PANTHORIUM_QWEN_DISABLED !== '1' && !(env.LOCAL_QWEN_DISABLE_FILE && require('fs').existsSync(env.LOCAL_QWEN_DISABLE_FILE)); }
async function routeProviders(providers, candidates, {preferredProvider, history = [], voiceMode = false} = {}, userId) {
  if (!providers.hybrid) return candidates;
  if (preferredProvider === 'local') return candidates.filter(p => p === 'local'); // Never silently bill a free request.
  let liveAllowed = false;
  try {
    const state = userId && providers.entitlements ? await providers.entitlements.state(userId) : null;
    liveAllowed = !!state && ['textInputTokens','textOutputTokens','voiceInputSeconds','voiceOutputSeconds'].every(k => hasQuota(state,k));
  } catch { /* Billing unavailable: free path only. */ }
  let ordered = candidates.filter(p => p !== 'gemini-live' || liveAllowed);
  const last = [...history].reverse().find(m => m.role === 'user' && typeof m.content === 'string')?.content || '';
  // Capability policy, not a claim that a small model always wins benchmarks.
  // Short text transformations use the private/free model; voice, research and
  // complex reasoning default to Gemini. An explicit paid preference wins.
  if (!preferredProvider && !voiceMode && last.length < 1800 && /^(สรุปข้อความ|เรียบเรียง|แก้คำผิด|ปรับสำนวน|rewrite\b|proofread\b|summarize this\b)/i.test(last.trim()))
    ordered = [...ordered.filter(p=>p==='local'),...ordered.filter(p=>p!=='local')];
  return ordered;
}
function localTools(tools = [], history = []) {
  const text = history.filter(m=>typeof m.content==='string').slice(-2).map(m=>m.content).join(' ');
  const groups = [[/อีเมล|เมล|เมล์|กล่องจดหมาย|ไฟล์แนบ|mail|inbox|outlook|attachment/i,/mailbox_/], [/คำนวณ|เท่าไร|เท่าไหร่|บวก|ลบ|ลด|ราคา|calculate|\d\s*[+*/-]\s*\d/i,/calculate/], [/ค้น|เว็บ|ข่าว|search|web/i,/web_/], [/อากาศ|weather/i,/weather/], [/โน้ต|บันทึก|note/i,/notes_|knowledge/], [/ไฟล์|file/i,/files_/], [/ปฏิทิน|นัด|calendar/i,/calendar/], [/แจ้งเตือน|notification/i,/notifications/], [/เตือน|reminder/i,/reminders/], [/รูป|ภาพ|สร้าง|เอกสาร|video|image/i,/studio/], [/mcp/i,/mcp_/]];
  const mailboxRequested = /อีเมล|เมล|เมล์|กล่องจดหมาย|ไฟล์แนบ|mail|inbox|outlook|attachment/i.test(text);
  const selected = tools.filter(t=>mailboxRequested ? /mailbox_/.test(t.name) : groups.some(([query,name])=>query.test(text)&&name.test(t.name)));
  const prior = history.flatMap(m=>(m.parts||[]).map(p=>p.functionCall?.name).filter(Boolean));
  return [...tools.filter(t=>prior.includes(t.name)),...selected,...tools.filter(t=>/system_status|ai_providers|mcp_list/.test(t.name))]
    .filter((t,i,a)=>a.findIndex(x=>x.name===t.name)===i).slice(0,6);
}
module.exports = {localEnabled,routeProviders,localTools};
