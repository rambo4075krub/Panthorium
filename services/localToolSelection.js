'use strict';

const SELECT_TOOL = 'panthorium_tools_select';
const CLARIFY_TOOL = 'panthorium_ask_user';
const PUBLIC_TOOLS = ['panthorium_weather_get','panthorium_web_search','panthorium_web_read'];

function requiredAccountTools(history, tools) {
  const question=[...history].reverse().find(item=>item.role==='user'&&typeof item.content==='string')?.content || '';
  if (/คืออะไร|หมายถึง|อธิบาย|วิธีใช้|how to|explain|what is/i.test(question)) return [];
  const intents = [
    [/อีเมล|เมล|เมล์|กล่องจดหมาย|ไฟล์แนบ|mail|inbox|attachment/i,/^panthorium_mailbox_/],
    [/ปฏิทิน|นัดหมาย|มีนัด|ว่าง(?:ไหม|มั้ย|หรือ)|ตารางเวลา|calendar|schedule|availability|am i free/i,/^panthorium_calendar_read$/],
    [/โน้ต|บันทึกของฉัน|my notes|\bnotes?\b/i,/^panthorium_notes_/],
    [/จำไว้|ความจำ|จำฉัน|remember|memory/i,/^panthorium_memory_/],
    [/แจ้งเตือน|notifications?/i,/^panthorium_notifications_/],
    [/เตือน|reminders?/i,/^panthorium_reminders_/],
    [/ไฟล์|files?/i,/^panthorium_files_/],
    [/เป้าหมาย|goals?/i,/^panthorium_goals_/],
    [/โครงการ|งานค้าง|projects?|tasks?/i,/^panthorium_work_/],
    [/วาด|สร้าง.*(?:รูป|ภาพ|วีดีโอ|วิดีโอ|เอกสาร|สไลด์)|(?:create|generate|make).*(?:image|video|document|presentation)/i,/^panthorium_studio_/]
  ];
  const group=intents.find(([intent,names])=>intent.test(question)&&tools.some(tool=>names.test(tool.name)))?.[1];
  if (!group || history.some(item=>item.parts?.some(part=>group.test(part.functionResponse?.name || '')))) return [];
  return tools.filter(tool=>group.test(tool.name));
}

function publicEvidenceTool(history, tools) {
  const question = [...history].reverse().find(item=>item.role==='user'&&typeof item.content==='string')?.content || '';
  // This only enforces evidence for explicit retrieval intents. Every other
  // authorized tool remains discoverable independently of these phrases.
  let name;
  const explicitWeb = /ค้น(?:หา)?(?:ข้อมูล)?(?:จาก|ใน|บน)?(?:เว็บ|อินเทอร์เน็ต)|ข่าวล่าสุด|ค้นข่าว|search (?:the )?(?:web|internet)|look up|browse|latest news/i.test(question);
  if (!explicitWeb && /อีเมล|เมล์|กล่องจดหมาย|โน้ต|ไฟล์ของฉัน|mail|inbox|my notes|my files/i.test(question)) return null;
  const explanation = /คืออะไร|หมายถึง|เกิดจาก|อธิบาย|แต่งเรื่อง|วาด|สร้างภาพ|what is|explain|write a story|draw|generate an image/i.test(question);
  if (!explanation && /อากาศ|พยากรณ์|พกร่ม|ฝน.*(?:ไหม|หรือ|วันนี้|พรุ่งนี้)|อุณหภูมิ|weather|forecast|rain|umbrella/i.test(question)) name='panthorium_weather_get';
  else if (/https:\/\/[^\s]+/i.test(question)) name='panthorium_web_read';
  else if (explicitWeb) name='panthorium_web_search';
  if (!name || history.some(item=>item.parts?.some(part=>part.functionResponse?.name===name))) return null;
  return tools.find(tool=>tool.name===name) || null;
}

function clarificationDeclaration() {
  return { name:CLARIFY_TOOL, description:'Ask one short question only when a requested tool task is missing necessary input. Do not invent that input, account state, or current facts.',
    parameters:{type:'OBJECT',properties:{question:{type:'STRING',description:'Short clarification question in the user language, at most 400 characters.'}},required:['question']} };
}

function clarificationQuestion(call, tools) {
  const args=call.args;
  if (!tools.length || !args || typeof args!=='object' || Array.isArray(args) ||
      Object.keys(args).length!==1 || typeof args.question!=='string' || !args.question.trim() ||
      args.question.length>400 || /[\x00-\x1f\x7f]/.test(args.question)) return null;
  return args.question.trim();
}

// The small local model cannot receive every full schema in one context.
// This catalogue contains only names already authorized for this chat surface.
// Selecting a name loads its schema on the next turn; it executes no action.
function selectionDeclaration(tools) {
  return {
    name: SELECT_TOOL,
    description: 'Load an available tool when its function is not currently supplied. Choose a name from the enum, then call that function with its schema on the next turn. Selection alone does not perform the task or approve an action.',
    parameters: { type: 'OBJECT', properties: {
      name: { type: 'STRING', description: 'Exact authorized tool name to load.', enum: tools.map(tool => tool.name) }
    }, required: ['name'] }
  };
}

function selectedTool(history) {
  // Only server-produced successful responses may activate a schema. Text
  // from a webpage, user message or proposed model arguments cannot do so.
  for (const item of [...history].reverse()) {
    for (const part of [...(item.parts || [])].reverse()) {
      const result = part.functionResponse;
      if (result?.name === SELECT_TOOL && result.response?.ok === true) return result.response.selectedTool;
    }
  }
  return null;
}

function selectTool(call, tools) {
  let args = call.args;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
  const validId = typeof call.id === 'string' && call.id.trim() && call.id.length <= 128 && !/[\x00-\x1f\x7f]/.test(call.id);
  const validArgs = args && typeof args === 'object' && !Array.isArray(args) &&
    Object.keys(args).length === 1 && typeof args.name === 'string' && tools.some(tool => tool.name === args.name);
  const response = validId && validArgs ? { ok: true, selectedTool: args.name }
    : { ok: false, error: 'function_not_available' };
  return { ...response, toolId: 'tools.select',
    functionResponse: { name: SELECT_TOOL, ...(validId ? { id: call.id } : {}), response } };
}

module.exports = { SELECT_TOOL, CLARIFY_TOOL, PUBLIC_TOOLS, selectionDeclaration, selectedTool, selectTool,
  publicEvidenceTool, requiredAccountTools, clarificationDeclaration, clarificationQuestion };
