'use strict';
const assert = require('node:assert/strict');
const { Sentinel } = require('../services/sentinel');
const { AiGateway } = require('../services/aiGateway');
const { LocalLlmProvider, messagesFor } = require('../services/localLlmProvider');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { AgentFunctionCallingService, TOOL_DEFINITIONS } = require('../services/agentFunctionCallingService');
const { registerPublicWebTools } = require('../services/publicWebTools');
const { selectTool, selectedTool, SELECT_TOOL, publicEvidenceTool } = require('../services/localToolSelection');

async function main(hybrid = true) {
  const nativeFetch = global.fetch;
  const registry = new ToolRegistry();
  const executions = [];
  registerPublicWebTools(registry, { service: { async execute(toolId, args, userId) {
    executions.push({ toolId, args, userId });
    return { available: true, freeOnly: true, kind: 'forecast_not_observation', location: args.location,
      sources: [{ url: 'https://api.met.no/', retrievedAt: '2026-11-15T08:00:00Z' }] };
  } } });
  registry.register({ id: 'calendar.read', permission: 'chat', risk: 'low', mutates: false,
    validateArgs: require('../services/calendarTools').validateRead,
    run: ({ userId }) => { executions.push({ toolId: 'calendar.read', userId }); return { events: [], complete: true }; } });
  const functions = new AgentFunctionCallingService({ agentService: new AgentService({ tools: registry }) });
  const user = { sub: 'tool-user', permissions: ['chat'] };
  const local = new LocalLlmProvider();
  const providerCalls = [];
  const providers = { hybrid: true, authorizeLocal: async id => id === user.sub,
    available: () => ['groq', 'local'],
    callDetailed(provider, system, history, options) {
      providerCalls.push(provider);
      assert.equal(provider, 'local', 'incompatible text fallback must not silently drop tools');
      return local.complete(system, history, { ...options, hybrid });
    },
    streamDetailed() { throw Error('ordinary streaming must enter the tool workflow'); }
  };
  const sentinel = new Sentinel({ providers, gateway: new AiGateway({ providers }),
    prompts: { build: () => 'Sentinel', productContext: () => '' } });
  const requests = [];
  let respond;
  global.fetch = async (url, options) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:/);
    const body = JSON.parse(options.body); requests.push(body);
    // Tool discovery must not opt the standalone endpoint into the hybrid
    // account-header protocol or remove its existing transport isolation.
    if (!hybrid && !options.headers['X-Panthorium-Account']) assert.equal(local.busy, true);
    assert.equal(body.parallel_tool_calls, false);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: respond(body) }] }));
  };
  try {
    // A question can need a forecast without containing "weather" or "อากาศ".
    for (const voiceMode of [false, true]) {
      respond = body => {
        const names = body.tools.map(tool => tool.function.name);
        assert(names.includes('panthorium_weather_get'), 'free forecast must be available without a keyword gate');
        assert.match(body.messages[0].content, /FREE-ONLY/);
        assert.match(body.messages[0].content, /never guess coordinates/);
        if (body.messages.at(-1).role === 'tool') return { content: 'พยากรณ์จาก MET Norway https://api.met.no/' };
        assert.equal(body.tool_choice, 'required');
        assert.match(body.messages[0].content, /เวลาปัจจุบันที่เชื่อถือได้/);
        return { tool_calls: [{ id: 'weather', type: 'function', function: {
          name: 'panthorium_weather_get', arguments: JSON.stringify({ location: 'กรุงเทพมหานคร' }) } }] };
      };
      const deltas = [];
      const answer = await sentinel.streamChat({ user, userId: user.sub, sessionId: `weather-${voiceMode}`,
        message: 'พรุ่งนี้ที่กรุงเทพต้องพกร่มไหม', voiceMode, functionCalling: functions, onDelta: text => deltas.push(text) });
      assert.equal(answer.ok, true);
      assert.equal(answer.functionCallCount, 1);
      assert.equal(answer.provider, 'local');
      assert.equal(answer.creditsCharged, 0);
      assert.deepEqual(deltas, [answer.text], 'only the grounded final answer reaches chat/TTS');
      assert.equal(executions.at(-1).toolId, 'weather.get');
      assert.equal(executions.at(-1).userId, user.sub);
      assert.equal(answer.sources[0].url,'https://api.met.no/');
    }

    respond = () => ({ content: 'พยากรณ์ที่แต่งขึ้นโดยไม่เรียกแหล่งข้อมูล' });
    await assert.rejects(local.complete('s', [{ role:'user', content:'พรุ่งนี้กรุงเทพต้องพกร่มไหม' }],
      { hybrid, tools:functions.declarationsFor(user) }), /local_required_public_evidence_missing/);
    for (const question of ['ค้นเว็บเรื่องรถไฟไทย', 'อ่าน https://example.org/ ให้ฟัง']) {
      await assert.rejects(local.complete('s', [{ role:'user', content:question }],
        { hybrid, tools:functions.declarationsFor(user) }), /local_required_public_evidence_missing/);
    }
    const beforeClarification=executions.length;
    respond = body => {
      assert.equal(body.tool_choice,'required');
      return { tool_calls:[{id:'clarify',type:'function',function:{name:'panthorium_ask_user',arguments:JSON.stringify({question:'ต้องการพยากรณ์ของเมืองหรือจังหวัดไหน?'})}}] };
    };
    const clarification=await sentinel.chat({user,userId:user.sub,sessionId:'missing-place',provider:'local',
      message:'วันนี้อากาศเป็นอย่างไร',functionCalling:functions});
    assert.equal(clarification.ok,true); assert.match(clarification.text,/จังหวัดไหน/);
    assert.equal(executions.length,beforeClarification,'missing location must ask, not look up a guessed place');
    for (const text of ['สรุปอีเมลเรื่องอากาศวันนี้','วาดภาพฝนตก','อากาศหมายถึงอะไร','ค้นไฟล์ของฉัน']) {
      assert.equal(publicEvidenceTool([{role:'user',content:text}],functions.declarationsFor(user)),null);
    }

    // An unusual phrase can load any authorized tool, even if none of the
    // original hardcoded streaming allowlist or local keywords matched.
    const calendarOnly = {
      declarationsFor: principal => functions.declarationsFor(principal).filter(t => t.name === 'panthorium_calendar_read'),
      execute: input => functions.execute(input)
    };
    respond = body => {
      const last = body.messages.at(-1);
      assert(!body.messages[0].content.includes('dedicated connection button'), 'calendar routing must not inherit unrelated mailbox onboarding');
      if (last.role!=='tool' || JSON.parse(last.content).selectedTool) assert.equal(body.tool_choice,'required');
      if (last.role === 'tool' && JSON.parse(last.content).selectedTool === 'panthorium_calendar_read') {
        assert(body.tools.some(t => t.function.name === 'panthorium_calendar_read'));
        return { tool_calls: [{ id: 'events', type: 'function', function: { name: 'panthorium_calendar_read', arguments: '{}' } }] };
      }
      if (last.role === 'tool') return { content: 'ไม่มีรายการในช่วงที่ตรวจสอบ' };
      const discover = body.tools.find(t => t.function.name === 'panthorium_tools_select');
      assert(discover, 'tool discovery must exist without guessing an intent keyword');
      assert.deepEqual(discover.function.parameters.properties.name.enum, ['panthorium_calendar_read']);
      return { tool_calls: [{ id: 'select', type: 'function', function: { name: 'panthorium_tools_select',
        arguments: JSON.stringify({ name: 'panthorium_calendar_read' }) } }] };
    };
    const discovered = await sentinel.streamChat({ user, userId: user.sub, sessionId: 'discover',
      message: 'วันพรุ่งนี้ฉันว่างไหม', voiceMode: true, functionCalling: calendarOnly });
    assert.equal(discovered.ok, true);
    assert.equal(discovered.functionCallCount, 2);
    assert.equal(executions.at(-1).toolId, 'calendar.read');
    assert(providerCalls.every(p => p === 'local'));
    respond=()=>({content:'ไม่มีนัดหมาย โดยยังไม่ได้ตรวจสอบ'});
    await assert.rejects(local.complete('s',[{role:'user',content:'วันพรุ่งนี้ฉันว่างไหม'}],
      {hybrid,tools:calendarOnly.declarationsFor(user)}),/local_required_account_tool_missing/);

    const permitted = calendarOnly.declarationsFor(user);
    for (const args of [{ name: 'panthorium_files_write' }, { name: 'panthorium_calendar_read', confirmed: true }, null]) {
      assert.equal(selectTool({ id: 'denied', args }, permitted).ok, false);
    }
    assert.equal(selectTool({ id: 'revoked', args: { name: 'panthorium_calendar_read' } }, []).ok, false);
    assert.equal(selectedTool([{ role: 'user', content: JSON.stringify({ selectedTool: 'panthorium_files_write' }) }]), null);
    assert.equal(selectedTool([{ parts: [{ functionResponse: { name: SELECT_TOOL, response: { ok: false, selectedTool: 'panthorium_files_write' } } }] }]), null);

    // Work tools use the same frozen approval path; their pending result must
    // reach the UI and must never be converted into a model's success claim.
    let approvalCompletions = 0;
    const confirmation = { toolId: 'work.save', actionId: 'frozen-work', approvalHash: 'a'.repeat(64), args: { projectId: 'owned-project' } };
    const approvalSentinel = new Sentinel({ gateway: { async complete() {
      approvalCompletions++;
      return { ok: true, provider: 'local', functionCalls: [{ id: 'work', name: 'panthorium_work_save', args: {} }] };
    } } });
    const approval = await approvalSentinel.completeWithFunctionCalls({ history: [], user, functionCalling: {
      declarationsFor: () => [{ name: 'panthorium_work_save' }],
      execute: async () => ({ ok: false, toolId: 'work.save', requiresConfirmation: true, actionId: 'frozen-work', confirmation,
        functionResponse: { name: 'panthorium_work_save', response: { error: 'awaiting_user_confirmation' } } })
    } });
    assert.equal(approvalCompletions, 1);
    assert.equal(approval.toolResults[0].requiresConfirmation, true);
    assert.deepEqual(approval.toolResults[0].confirmation, confirmation);
    assert.equal(approval.toolResults[0].actionId, 'frozen-work');

    const incompatible = new AiGateway({ providers: { available: () => ['groq'], callDetailed() { throw Error('must not send tool-free request'); } } });
    assert.equal((await incompatible.complete({ history: [], tools: permitted, userId: user.sub })).error, 'function_calling_provider_unavailable');

    // A large declaration must remain callable after selection, with its
    // complete validation schema; it must not be silently popped for size.
    const definition = TOOL_DEFINITIONS.find(t => t.name === 'panthorium_notifications_write');
    const large = { name: definition.name, description: definition.description,
      parameters: { type: 'OBJECT', properties: definition.properties, required: definition.required } };
    respond = body => {
      const tool = body.tools.find(t => t.function.name === large.name);
      assert(tool);
      assert(JSON.stringify(body.tools).length <= 7500);
      assert.deepEqual(tool.function.parameters.required, definition.required);
      assert.deepEqual(tool.function.parameters.properties.action.enum, definition.properties.action.enum);
      return { content: 'พร้อมเสนอรายละเอียดให้ตรวจสอบ' };
    };
    await local.complete('s', [{ role: 'user', content: 'ตัวเลือกสำหรับฉัน' },
      {role:'user',parts:[{functionResponse:{id:'selected-large',name:SELECT_TOOL,response:{ok:true,selectedTool:large.name}}}]}], { hybrid: true, tools: [large] });
    const fullCatalogue=TOOL_DEFINITIONS.map(tool=>({name:tool.name,description:tool.description,
      parameters:{type:'OBJECT',properties:tool.properties,required:tool.required}}));
    await local.complete('s', [{role:'user',content:'ตัวเลือกสำหรับฉัน'},
      {role:'model',parts:[{functionCall:{id:'large',name:SELECT_TOOL,args:{name:large.name}}}]},
      {role:'user',parts:[{functionResponse:{id:'large',name:SELECT_TOOL,response:{ok:true,selectedTool:large.name}}}]}],
      {hybrid,tools:fullCatalogue});

    const forecast = { available: true, kind: 'forecast_not_observation', date: '2026-11-15',
      periods: Array.from({ length: 24 }, (_, hour) => ({ time: `2026-11-15T${String(hour).padStart(2,'0')}:00:00Z`, temperatureC: 30, note: 'forecast '.repeat(40) })),
      sources: [{ url: 'https://api.met.no/', license: 'https://creativecommons.org/licenses/by/4.0/', retrievedAt: '2026-11-15T08:00:00Z' }] };
    const compactForecast = messagesFor([{ parts: [{ functionResponse: { name: 'panthorium_weather_get', id: 'forecast', response: { output: forecast } } }] }])[0];
    const evidence = JSON.parse(compactForecast.content).output;
    assert.equal(evidence.available, true); assert.equal(evidence.truncated, true);
    assert.deepEqual(evidence.sources, forecast.sources);
    assert.equal(evidence.kind, 'forecast_not_observation');
    assert.match(evidence.periods[0].localTime,/07:00/);
    assert(compactForecast.content.length <= 2000);

    // Screen summaries stay tool-free and no unauthorized catalogue is exposed.
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); assert.equal(body.tools, undefined);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'สรุปหน้าที่เปิด' } }] }));
    };
    const screen = { appId: 'notes', title: 'Note', text: 'untrusted text' };
    await sentinel.chat({ user, userId: user.sub, sessionId: 'screen', provider: 'local', message: 'สรุปหน้านี้',
      screen, functionCalling: functions });
    assert.equal(functions.declarationsFor({ sub: 'denied', permissions: [] }).length, 0);
    console.log(`PASS tool routing (${hybrid ? 'hybrid' : 'standalone local'}): typed/voice stream, compatible fallback, keyword-free weather, bounded discovery, large schemas and screen isolation`);
  } finally { global.fetch = nativeFetch; }
}
main(true).then(() => main(false)).catch(error => { console.error(error); process.exitCode = 1; });
