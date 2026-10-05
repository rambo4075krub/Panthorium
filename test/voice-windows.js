const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { JSDOM, VirtualConsole } = require('jsdom');
const { AuthService } = require('../services/authService');
const { ToolRegistry } = require('../services/toolRegistry');
const { AgentService } = require('../services/agentService');
const { AgentWorkflowService } = require('../services/agentWorkflowService');
const { createApiRouter } = require('../routes/api');
const catalog = require('../voice-window-catalog');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
assert.equal((source('sentinel.html').match(/authorizeAudio\(audio\)/g) || []).length, 0, 'both voice input paths rely on the single server-side speaker check');
const tick = () => new Promise(resolve => setImmediate(resolve));
const admin = { id: 'voice-admin', username: 'admin', permissions: ['chat', 'system:read', 'settings', 'sentinel:command'], roles: ['administrator'] };
const guest = { id: 'voice-guest', username: 'guest', permissions: ['chat', 'system:read'], roles: ['guest'] };

(async () => {
  for (const app of catalog.apps) for (const alias of app.aliases) {
    assert.equal(catalog.parse(`เปิด ${alias}`)?.action, `open_${app.key}`, `open ${alias}`);
    assert.equal(catalog.parse(`ปิด ${alias}`)?.action, `close_${app.key}`, `close ${alias}`);
    assert.equal(catalog.parse(`${alias} เปิดขึ้น`)?.action, `open_${app.key}`, `target-first ${alias}`);
  }
  assert.equal(catalog.parse('ช่วยเปิดหน้าต่าง Learning Lab ให้หน่อยครับ')?.action, 'open_learning_lab');
  assert.equal(catalog.parse('ลงทะเบียน')?.action, 'open_voice_identity', 'bare registration phrase opens Voice Identity');
  assert.equal(catalog.parse('เข้าสู่ระบบ')?.action, 'open_voice_identity', 'bare login phrase opens Voice Identity');
  assert.equal(catalog.parse('เปิดโน้ต เปิดโน้ต')?.action, 'open_notes', 'collapse a duplicated Notes transcript');
  assert.equal(catalog.parse('เปิดโน้ต เปิดโน๊ต')?.action, 'open_notes', 'accept a duplicated transcript with alias variation');
  assert.equal(catalog.parse('เปิดโน้ต แล้วเปิด Settings'), null, 'do not discard a second app command');
  const calendarApp = catalog.apps.find(app => app.id === 'calendar');
  const goalsApp = catalog.apps.find(app => app.id === 'goals');
  const registeredUser = { id: 'calendar-user', sub: 'calendar-user', permissions: ['chat'], roles: ['user'] };
  const filesApp = catalog.apps.find(app => app.id === 'files');
  assert.equal(catalog.allowed(filesApp, registeredUser), true, 'registered chat accounts may use cloud Files');
  assert.equal(catalog.allowed(filesApp, guest), false, 'Guest cannot use account-scoped cloud Files');
  assert.equal(catalog.parse('เปิดปฏิทิน')?.action, 'open_calendar');
  assert.equal(catalog.allowed(calendarApp, registeredUser), true, 'registered users may use the cloud calendar');
  assert.equal(catalog.allowed(calendarApp, guest), false, 'Guest cannot use account-scoped cloud calendar');
  assert.equal(catalog.parse('เปิดเป้าหมาย')?.action, 'open_goals');
  assert.equal(catalog.allowed(goalsApp, registeredUser), true, 'registered users may use account-scoped goal tracking');
  assert.equal(catalog.allowed(goalsApp, guest), false, 'Guest cannot use private cloud goals');
  const preferencesApp = catalog.apps.find(app => app.id === 'assistant-preferences');
  assert.equal(catalog.parse('เปิดความชอบ Sentinel')?.action, 'open_sentinel_preferences');
  assert.equal(catalog.allowed(preferencesApp, registeredUser), true, 'registered users may use account-scoped Sentinel preferences');
  assert.equal(catalog.allowed(preferencesApp, guest), false, 'Guest cannot use private Sentinel preferences');
  assert.equal(catalog.parse('เปิดโน้ต แล้วปิดโน้ต')?.error, 'ambiguous_voice_command', 'do not discard a conflicting repeated command');
  assert.equal(catalog.parse('อย่าเปิด Learning Lab')?.error, 'voice_command_negated');
  assert.equal(catalog.parse('เปิด Learning Lab แล้วลบข้อมูล'), null, 'must not silently drop a destructive second instruction');
  assert.equal(catalog.parse('กลับไปดู Learning Lab'), null, 'กลับ must not close a window');
  const mutations = [];
  const audit = { record() {} };
  const auth = new AuthService({ config: { jwtSecret: 'voice-regression-local-secret-not-production', accessTokenTtl: '1h' }, audit });
  const sentinel = { status: () => ({ name: 'Sentinel', persistence: 'postgresql', providers: [] }), providerCatalog: () => [], clearConversation: async (userId, sessionId) => mutations.push({ userId, sessionId }) };
  const tools = new ToolRegistry({ sentinel, knowledge: { search: async ({ user, query }) => ({ chunks: [{ userId: user.sub, content: query }] }) } });
  const agent = new AgentService({ tools, audit });
  let plannedSteps = [];
  const workflow = new AgentWorkflowService({ agentService: agent, audit, gateway: { complete: async () => ({ ok: true, text: JSON.stringify({ steps: plannedSteps, answer: 'เปิดหน้าต่างแล้ว' }) }) } });
  const serverApp = express();
  // Separate simulated clients keep the real per-IP limiter enabled in tests.
  serverApp.set('trust proxy', 1);
  serverApp.use(express.json());
  serverApp.use('/api', createApiRouter(sentinel, auth, audit, {}, agent, {}, workflow, {}, {}));
  const server = serverApp.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const registeredToken = auth.signAccessToken(guest);
  const registeredNotesResponse = await fetch(`${base}/api/sentinel/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${registeredToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'เปิดโน้ต เปิดโน๊ต' })
  });
  const registeredNotes = await registeredNotesResponse.json();
  assert.equal(registeredNotesResponse.status, 200, JSON.stringify(registeredNotes));
  assert.equal(registeredNotes.results?.[0]?.output?.uiAction, 'open_notes', 'a registered chat account can open Notes without Sentinel Agent permission');
  const calculatorResponse = await fetch(`${base}/api/sentinel/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${registeredToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'เปิดเครื่องคิดเลข' })
  });
  const calculatorCommand = await calculatorResponse.json();
  assert.equal(calculatorResponse.status, 200, JSON.stringify(calculatorCommand));
  assert.equal(calculatorCommand.results?.[0]?.output?.uiAction, 'open_calculator', 'a registered chat account can open the calculator by voice');
  const filesResponse = await fetch(`${base}/api/sentinel/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.signAccessToken(registeredUser)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'เปิดไฟล์' })
  });
  const filesCommand = await filesResponse.json();
  assert.equal(filesResponse.status, 200, JSON.stringify(filesCommand));
  assert.equal(filesCommand.results?.[0]?.output?.uiAction, 'open_files', 'a registered chat account can open Files by voice');
  const dom = new JSDOM(source('sentinel.html'), { url: 'https://panthorium-backend-staging.example.run.app/admin', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  const context = dom.getInternalVMContext();
  const externalPopups = new Map();
  const cloudEvents = new Map();
  w.confirm = () => true;
  Object.defineProperty(w, 'open', { configurable: true, writable: true, value: (url, name, features) => { const popup = { url, name, features, closed: false, focus() {}, close() { this.closed = true; } }; externalPopups.set(name, popup); return popup; } });
  const evaluate = code => vm.runInContext(code, context);
  const load = name => evaluate(source(name));
  let client = 1;
  const requests = [];
  const spoken = [];
  try {
    Object.assign(w, { Headers, AbortSignal, TextDecoder, TextEncoder });
    w.fetch = async (url, options = {}) => {
      const pathname = new URL(url, base).pathname;
      requests.push({ pathname, method: options.method || 'GET' });
      const httpMethod = String(options.method || 'GET').toUpperCase();
      if (pathname === '/api/agent/memory' && httpMethod === 'GET') return Response.json({ ok: true, memories: [...cloudEvents.values()] });
      if (pathname === '/api/agent/memory' && httpMethod === 'POST') {
        const body = JSON.parse(options.body || '{}');
        const memoryId = '00000000-0000-4000-8000-' + String(cloudEvents.size + 1).padStart(12, '0');
        const memory = { memoryId, ...body };
        cloudEvents.set(memoryId, memory);
        return Response.json({ ok: true, memory }, { status: 201 });
      }
      const memoryUpdateId = pathname.startsWith('/api/agent/memory/') ? pathname.slice('/api/agent/memory/'.length) : '';
      if (memoryUpdateId && httpMethod === 'PATCH') {
        const current = cloudEvents.get(memoryUpdateId);
        if (!current) return Response.json({ ok: false, error: 'memory_not_found' }, { status: 404 });
        const updated = { ...current, ...JSON.parse(options.body || '{}') };
        cloudEvents.set(memoryUpdateId, updated);
        return Response.json({ ok: true, memory: updated });
      }
      const memoryDeleteId = pathname.startsWith('/api/agent/memory/') ? pathname.slice('/api/agent/memory/'.length) : '';
      if (memoryDeleteId && /^[0-9a-f-]+$/i.test(memoryDeleteId) && httpMethod === 'DELETE') { cloudEvents.delete(memoryDeleteId); return Response.json({ ok: true }); }
      if (pathname === '/api/auth/logout') return Response.json({ ok: true });
      if (pathname === '/api/auth/login') return Response.json({ ok: true, user: admin, accessToken: auth.signAccessToken(admin) });
      if (pathname === '/api/sentinel/command' || pathname.startsWith('/api/agent/workflow/')) {
        const headers = new Headers(options.headers); headers.set('x-forwarded-for', `192.0.2.${client}`);
        return fetch(base + pathname, { ...options, headers });
      }
      if (pathname.startsWith('/api/chat')) throw new Error('Voice must never fall back to a chat endpoint');
      // Dashboard data is a fixture. All shell, auth, command, window, and module
      // code is real; no open/close functions are mocked for the success cases.
      return Response.json({ ok: true, providers: [], sessions: [], metrics: { providers: [], totals: {} }, summary: {}, examples: [], versions: [], entries: [], alerts: [], blocks: [], memories: [], documents: [], runs: [], jobs: [], integrations: [], history: [], incidents: [], stats: {}, status: 'ready', score: 100 });
    };
    const inline = [...w.document.scripts].find(script => script.textContent.includes('const OS ='))?.textContent;
    assert(inline);
    // Hardware/WebGL boot is outside this DOM regression; the actual runtime
    // functions below and both SpeechRecognition event paths remain unchanged.
    evaluate(inline.replace(/\n    boot\(\);/, '\n    OS.state.booted = true;'));
    load('phase2-auth.js'); await tick();
    await w.PanthoriumAuth.login('admin', 'fixture');
    w.document.getElementById('desktop').classList.add('active');
    assert(w.document.querySelector('#sm-apps .sm-app[data-app-id="files"]'), 'Files appears in Start menu after account authentication');
    assert(w.document.querySelector('#sm-apps .sm-app[data-app-id="goals"]'), 'Goals appears in Start menu for signed-in chat accounts');
    assert(w.document.querySelector('#sm-apps .sm-app[data-app-id="assistant-preferences"]'), 'Sentinel Preferences appears in Start menu for signed-in chat accounts');
    for (const file of ['user-manager.js', 'security-dashboard.js', 'ai-dashboard.js', 'ai-stream-client.js', 'agent-ui.js', 'agent-automation-ui.js', 'agent-memory-ui.js', 'multi-agent-ui.js', 'integrations-ui.js', 'production-intelligence-ui.js', 'training-ui.js', 'governance-ui.js', 'sentinel-control-ui.js', 'voice-identity-ui.js', 'calculator-expression.js', 'voice-window-catalog.js', 'calendar-ui.js', 'reminders-ui.js', 'goal-tracker-ui.js', 'assistant-preferences-ui.js', 'external-apps-ui.js', 'browser-ui.js', 'media-studio-ui.js', 'voice-command-client.js', 'staging-admin-desktop.js']) load(file);
    w.PanthoriumStagingAdminDesktop.render();
    await new Promise(resolve => setTimeout(resolve, 40));
    for (const appId of ['media-studio', 'browser']) {
      assert.equal(w.document.querySelectorAll(`#sm-apps [data-app-id="${appId}"]`).length, 1, `${appId} has one launcher in the Admin menu`);
    }
    assert(w.document.querySelector('#desktop-icons [data-app-id="voice-identity"]'), 'administrator desktop must show Voice Identity icon');
    w.PanthoriumAIStream.install();
    const command = text => w.callAI(text, { voiceMode: true });
    const isVisible = app => { const el = w.document.querySelector(app.selector); return !!el && w.getComputedStyle(el).display !== 'none'; };
    for (const app of catalog.apps) {
      client++;
      let result = await command(`${app.aliases[0]} เปิดขึ้น`);
      assert.equal(result.ok, true, `${app.label}: ${JSON.stringify(result)}`);
      assert.equal(result.text, `เปิด ${app.label}`, 'on-screen result identifies the command');
      assert.equal(isVisible(app), true, `${app.label} did not appear`);
      const root = w.document.querySelector(app.selector);
      if (app.id === 'files') {
        assert.equal(root.querySelector('#files-login'), null, 'Files does not show login/signup controls');
        assert.doesNotMatch(root.textContent, /เข้าสู่ระบบ|สมัครบัญชี/, 'Files does not send users through account creation');
      }
      if (app.id === 'voice-identity') assert(root.querySelector('[data-type] option[value="administrator"]'), 'administrator enrollment option appears on admin page');
      if (app.external) {
        assert.equal(root.querySelector('iframe'), null, `${app.label}: must not embed an iframe`);
        assert(root.querySelector('[data-external-open]'), `${app.label}: real-site opener missing`);
        const popup = externalPopups.get(`panthorium-external-${app.id}`);
        assert(popup, `${app.label}: real browser window was not opened`);
        assert.equal(popup.url, app.externalUrl, `${app.label}: fixed external URL`);
      }
      assert.equal((await command(`เปิด ${app.aliases[0]}`)).ok, true);
      assert.equal(w.document.querySelectorAll(app.selector).length, 1, `${app.label}: duplicate window`);
      if (app.refresher || app.refreshButton) assert.equal((await command(`รีเฟรช ${app.aliases[0]}`)).ok, true, `${app.label} refresh`);
      const closed = await command(`ปิด ${app.aliases[0]}`);
      assert.equal(closed.ok, true);
      assert.equal(closed.text, `ปิด ${app.label}`);
      assert.equal(isVisible(app), false, `${app.label} stayed open`);
      if (app.external) assert.equal(externalPopups.get(`panthorium-external-${app.id}`)?.closed, true, `${app.label}: browser window stayed open`);
      assert.equal((await command(`ปิด ${app.aliases[0]}`)).ok, true, 'close should be idempotent');
      assert.equal((await command(`เปิด ${app.aliases[0]}`)).ok, true);
      assert.equal(isVisible(app), true, `${app.label} did not reopen`);
      if (app.id === 'ai-platform') assert(w.document.querySelector('#phase4-ai-dashboard #ai-window'), 'close/reopen must preserve the full AI dashboard');
      if (app.windowId) {
        w.document.querySelector(app.selector).style.display = 'none';
        assert.equal((await command(`เปิด ${app.aliases[0]}`)).ok, true);
        assert.equal(isVisible(app), true, `${app.label} remained minimized`);
      }
      await command(`ปิด ${app.aliases[0]}`);
      assert(!root.isConnected || w.getComputedStyle(root).display === 'none');
    }
    console.log(`PASS: actual ${catalog.apps.length} registered windows open, focus without duplicates, close, close twice, reopen; supported refresh and minimized restore`);
    await w.PanthoriumCalendar.open();
    const calendarForm = w.document.querySelector('.window[data-id="calendar"] [data-calendar-form]');
    const calendarTitle = w.document.querySelector('.window[data-id="calendar"] [data-calendar-title]');
    const calendarDate = w.document.querySelector('.window[data-id="calendar"] [data-calendar-date]');
    const calendarTime = w.document.querySelector('.window[data-id="calendar"] [data-calendar-time]');
    const calendarDescription = w.document.querySelector('.window[data-id="calendar"] [data-calendar-description]');
    calendarTitle.value = '<img src=x onerror=alert(1)> นัดหมาย';
    calendarDate.value = '2030-01-02';
    calendarTime.value = '09:30';
    calendarDescription.value = 'รายละเอียดนัด';
    calendarForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 80 && cloudEvents.size !== 1; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(cloudEvents.size, 1, 'calendar event is written through the cloud API');
    const savedCalendarEvent = [...cloudEvents.values()][0];
    assert.equal(savedCalendarEvent.kind, 'calendar-event');
    assert.equal(savedCalendarEvent.title, '<img src=x onerror=alert(1)> นัดหมาย');
    assert.equal(JSON.parse(savedCalendarEvent.content).timeZone.length > 0, true);
    const calendarList = w.document.querySelector('.window[data-id="calendar"] [data-calendar-events]');
    assert.equal(calendarList.querySelector('img'), null, 'remote event titles render as text, never HTML');
    assert.match(calendarList.textContent, /นัดหมาย/);
    calendarList.querySelector('[data-delete]').click();
    for (let i = 0; i < 80 && cloudEvents.size !== 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(cloudEvents.size, 0, 'calendar event is removed from the cloud API');
    console.log('PASS: cloud calendar saves, reloads and deletes account-scoped events safely');

    await w.PanthoriumGoals.open();
    const goalForm = w.document.querySelector('.window[data-id="goals"] [data-goals-form]');
    const goalTitle = w.document.querySelector('.window[data-id="goals"] [data-goals-title]');
    const goalDate = w.document.querySelector('.window[data-id="goals"] [data-goals-date]');
    const goalDescription = w.document.querySelector('.window[data-id="goals"] [data-goals-description]');
    goalTitle.value = '<img src=x onerror=alert(1)> เรียนภาษาอังกฤษ';
    goalDate.value = '2030-06-01';
    goalDescription.value = 'ฝึกสัปดาห์ละ 3 ครั้ง';
    goalForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 80 && cloudEvents.size !== 1; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(cloudEvents.size, 1, 'goal is written through the cloud memory API');
    const savedGoal = [...cloudEvents.values()][0];
    assert.equal(savedGoal.kind, 'goal');
    assert.equal(savedGoal.title, '<img src=x onerror=alert(1)> เรียนภาษาอังกฤษ');
    assert.equal(JSON.parse(savedGoal.content).status, 'active');
    const goalList = w.document.querySelector('.window[data-id="goals"] [data-goals-list]');
    assert.equal(goalList.querySelector('img'), null, 'goal title renders as text, never HTML');
    const goalEdit = goalList.querySelector('article form');
    goalEdit.querySelector('[data-progress]').value = '35';
    goalEdit.querySelector('[data-note]').value = 'ทำได้ 7 จาก 20 ชั่วโมง';
    goalEdit.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 80 && JSON.parse(cloudEvents.values().next().value.content).progress !== 35; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const updatedGoal = [...cloudEvents.values()][0];
    assert.equal(JSON.parse(updatedGoal.content).progress, 35, 'goal progress persists through cloud PATCH');
    assert.equal(JSON.parse(updatedGoal.content).progressNote, 'ทำได้ 7 จาก 20 ชั่วโมง');
    assert.equal(goalList.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '35', 'progress bar reflects the latest saved percentage accessibly');
    const deleteGoal = goalList.querySelector('[data-delete]');
    deleteGoal.click();
    assert.equal(cloudEvents.size, 1, 'first delete click only opens inline confirmation');
    goalList.querySelector('[data-cancel-delete]').click();
    assert.equal(cloudEvents.size, 1, 'cancel keeps the cloud goal');
    deleteGoal.click();
    deleteGoal.click();
    for (let i = 0; i < 80 && cloudEvents.size !== 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(cloudEvents.size, 0, 'confirmed delete removes the cloud goal');
    console.log('PASS: cloud goals create, track progress, confirm/cancel deletion, and render safely');

    await w.PanthoriumAssistantPreferences.open();
    const preferenceWindow = w.document.querySelector('.window[data-id="assistant-preferences"]');
    const preferenceForm = preferenceWindow.querySelector('[data-preferences-form]');
    preferenceWindow.querySelector('[data-preferences-name]').value = 'คุณปานเทพ';
    preferenceWindow.querySelector('[data-preferences-style]').value = 'concise';
    preferenceWindow.querySelector('[data-preferences-language]').value = 'thai';
    preferenceForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 80 && cloudEvents.size !== 1; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(cloudEvents.size, 1, 'assistant preferences are written to cloud memory');
    const savedPreferences = [...cloudEvents.values()][0];
    assert.equal(savedPreferences.kind, 'assistant-preference');
    assert.deepEqual(JSON.parse(savedPreferences.content), { version: 1, preferredName: 'คุณปานเทพ', style: 'concise', language: 'thai' });
    preferenceWindow.querySelector('[data-preferences-reset]').click();
    for (let i = 0; i < 80 && JSON.parse(cloudEvents.values().next().value.content).preferredName !== ''; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(JSON.parse([...cloudEvents.values()][0].content), { version: 1, preferredName: '', style: 'natural', language: 'automatic' }, 'reset overwrites the cloud preference with defaults');
    console.log('PASS: Sentinel preferences save and reset as account-scoped cloud memory');

    // Every registered module function must be callable through the same
    // authenticated command path. Mutating/costly controls stop at approval.
    for (const functionCommand of catalog.functionCommands) {
      assert.equal(catalog.parseFunction(functionCommand.aliases[0]).action, functionCommand.action);
      if (functionCommand.requiresConfirmation) continue;
      const result = await command(functionCommand.aliases[0]);
      assert.equal(result.ok, true, `function ${functionCommand.action}`);
      await command(`ปิด ${catalog.apps.find(app => app.id === functionCommand.appId).aliases[0]}`);
    }
    const gatedFunction = catalog.functionCommands.find(command => command.requiresConfirmation);
    const gatedResult = await command(gatedFunction.aliases[0]);
    assert.equal(gatedResult.confirmationRequired, true, 'costly function must request approval');
    assert.equal((await command('ยกเลิก')).text, 'ยกเลิกคำสั่ง');
    console.log(`PASS: ${catalog.functionCommands.length} registered system functions dispatch to their real controls; gated functions require approval`);

    client++;
    await command('เปิด Learning Lab'); await command('เปิด AI Platform');
    assert.equal((await command('ปิดหน้าต่างนี้')).ok, true);
    assert(!isVisible(catalog.apps.find(app => app.id === 'ai-platform')));
    assert(isVisible(catalog.apps.find(app => app.id === 'training-lab')));
    assert.equal((await command('ปิดทุกหน้าต่าง')).text, 'ปิดทุกหน้าต่าง');
    assert(catalog.apps.every(app => !isVisible(app)));
    for (const text of ['อย่าเปิด Learning Lab', 'ไม่ต้องปิด Settings', 'เปิดและปิด Learning Lab']) {
      assert.equal((await command(text)).ok, false, text);
      assert(!isVisible(catalog.apps.find(app => app.id === 'training-lab')));
    }
    // A planner's prose without tool results must not be reported as success.
    assert.match((await command('เปิดฟังก์ชันที่ไม่มีอยู่')).text, /ยังไม่มีการดำเนินการ/);
    assert.equal((await command('แสดงสถานะระบบ')).ok, true);
    assert.equal((await command('ค้นความรู้ คู่มือ Sentinel')).ok, true);
    const originalOpen = w.PanthoriumTraining.open;
    w.PanthoriumTraining.open = () => {}; // regression: installed opener does nothing
    assert.equal((await command('เปิด Learning Lab')).ok, false);
    w.PanthoriumTraining.open = originalOpen;

    // Exercise the actual global recognition -> callAI wrappers -> HTTP -> DOM
    // path with a final transcript; ordinary actions must produce no speech.
    let recognition;
    w.SpeechRecognition = class { constructor() { recognition = this; } start() { this.onstart?.(); } stop() { this.onend?.(); } };
    w.captureSpoken = text => spoken.push(text);
    evaluate('speak = async function(text) { window.captureSpoken(text); return true; }; initGlobalVoice();');
    const globalRecognition = recognition;
    async function utter(text) {
      globalRecognition.start();
      const finalResult = [{ transcript: text, confidence: 0.98 }]; finalResult.isFinal = true;
      globalRecognition.onresult({ resultIndex: 0, results: [finalResult] }); globalRecognition.onend();
      for (let n = 0; w.PanthoriumVoice.state() !== 'idle' && n < 150; n++) await new Promise(resolve => setTimeout(resolve, 20));
      w.PanthoriumVoice.pause();
      assert.equal(w.PanthoriumVoice.state(), 'idle');
    }
    await utter('เปิด Training Lab');
    assert.equal(spoken.length, 0, 'successful commands must not echo or speak an acknowledgement');
    assert(isVisible(catalog.apps.find(app => app.id === 'training-lab')));
    await utter('ปิด Learning Lab');
    await utter('อย่าเปิด Learning Lab');
    assert.equal(spoken.length, 0, 'closing and errors are also silent');
    console.log('PASS: final speech transcript reaches command API and opens/closes the actual Learning Lab silently');

    client++;
    const replaceUser = user => { w.nextUser = user; w.nextToken = auth.signAccessToken(user); evaluate('OS.state.user = window.nextUser; OS.config.accessToken = window.nextToken;'); w.dispatchEvent(new w.CustomEvent('panthorium:auth-changed')); };
    replaceUser(guest);
    w.PanthoriumStagingAdminDesktop.render();
    assert.equal(w.document.querySelector('#desktop-icons [data-app-id="voice-identity"]'), null, 'guest desktop must not show Voice Identity');
    assert.equal(w.document.getElementById('voice-identity-launcher'), null, 'guest must not see a Voice Identity start-menu launcher');
    assert.equal(w.document.querySelector('#sm-apps .sm-app[data-app-id="files"]'), null, 'Guest must not see private Files launcher');
    assert.equal(w.document.querySelector('#sm-apps .sm-app[data-app-id="goals"]'), null, 'Guest must not see private Goals launcher');
    assert.equal(w.document.querySelector('#sm-apps .sm-app[data-app-id="assistant-preferences"]'), null, 'Guest must not see private Sentinel Preferences launcher');
    assert.equal(preferenceWindow.querySelector('[data-preferences-name]').value, '', 'account change clears the previous user name from the open preferences window');
    for (const app of catalog.apps) {
      client++; // each app check is a separate simulated guest client; keep the per-IP limiter enabled
      const result = await command(`เปิด ${app.aliases[0]}`);
      assert.equal(result.ok, catalog.allowed(app, guest), `${app.label}: guest permission: ${JSON.stringify(result)}`);
      assert.equal(isVisible(app), catalog.allowed(app, guest), `${app.label}: guest DOM`);
      if (app.id === 'voice-identity' && result.ok) assert.equal(w.document.querySelector(app.selector + ' [data-type] option[value="administrator"]'), null, 'guest sees only user/family enrollment types');
      if (result.ok) await command(`ปิด ${app.aliases[0]}`);
    }
    assert.equal((await w.PanthoriumVoiceCommands.windowAction('open_learning_lab')).ok, false, 'desktop/client calls also need permission');
    await w.PanthoriumVoiceIdentity.open();
    const guestAdminPageVoiceUi = w.document.getElementById('panthorium-voice-identity');
    assert(guestAdminPageVoiceUi, 'guest can open user/family enrollment');
    assert.equal(guestAdminPageVoiceUi.querySelector('[data-type] option[value="administrator"]'), null, 'guest cannot select administrator type');
    guestAdminPageVoiceUi.remove();
    replaceUser({ ...admin, roles: ['operator'] });
    w.PanthoriumStagingAdminDesktop.render();
    assert.equal(w.document.querySelector('#desktop-icons [data-app-id="voice-identity"]'), null, 'operator must not see the administrator desktop icon');
    await w.PanthoriumVoiceIdentity.open();
    const operatorVoiceUi = w.document.getElementById('panthorium-voice-identity');
    assert(operatorVoiceUi, 'authorized operator may manage user and family voice profiles');
    assert.equal(operatorVoiceUi.querySelector('[data-type] option[value="administrator"]'), null, 'administrator voice enrollment is hidden from operators');
    operatorVoiceUi.remove();
    assert.equal((await command('เปิด Security')).ok, false, 'settings permission alone does not grant administrator role');
    replaceUser(admin);
    w.PanthoriumStagingAdminDesktop.render();
    assert(w.document.querySelector('#desktop-icons [data-app-id="voice-identity"]'), 'administrator icon returns for administrator account');
    replaceUser(registeredUser);
    w.PanthoriumStagingAdminDesktop.render();
    assert(w.document.querySelector('#sm-apps .sm-app[data-app-id="files"]'), 'Start menu refreshes for a signed-in chat account');
    client++;
    const chatFilesOpened = await command('เปิด File');
    assert.equal(chatFilesOpened.ok, true, 'signed-in chat user can open Files by voice');
    assert(isVisible(filesApp), 'Files voice command opens its real app window');
    await command('ปิดไฟล์');
    assert.equal(isVisible(filesApp), false, 'Files voice command closes its real app window');
    replaceUser(admin);
    w.PanthoriumStagingAdminDesktop.render();
    console.log('PASS: guest and operator denied administrator windows by server AND client');

    client++;
    plannedSteps = [{ toolId: 'window.open', args: { appId: 'training-lab' } }, { toolId: 'conversation.clear', args: { sessionId: 's1' }, reason: 'ลบบทสนทนา s1 ของบัญชีนี้' }];
    await utter('ลบบทสนทนา s1');
    assert.equal(spoken.length, 1, 'speak only to request confirmation');
    assert.match(spoken[0], /ต้องยืนยันก่อนดำเนินการ/); assert.equal(mutations.length, 0);
    w.dispatchEvent(new w.CustomEvent('panthorium:auth-changed')); // same user token refresh
    await w.PanthoriumVoiceCommands.windowAction('close_learning_lab');
    await utter('ยืนยัน');
    assert.equal(spoken.length, 1, 'executing the approved action is silent'); assert.equal(mutations.length, 1);
    assert(!isVisible(catalog.apps.find(app => app.id === 'training-lab')), 'confirmation must not replay the earlier window action');
    assert.equal((await command('ยืนยัน')).ok, false); assert.equal(mutations.length, 1);
    await command('ลบบทสนทนา s1'); await command('ยกเลิก'); assert.equal(mutations.length, 1);
    await command('ลบบทสนทนา s1'); replaceUser(guest);
    assert.equal((await command('ยืนยัน')).ok, false); assert.equal(mutations.length, 1);
    assert(!isVisible(catalog.apps.find(app => app.id === 'training-lab')), 'account changes must clear private module windows');
    const apiUser = { ...admin, sub: admin.id };
    tools.register({ id: 'test.mutate', permission: 'settings', risk: 'low', mutates: true, validateArgs: () => null, run: async () => { mutations.push('must not run'); } });
    plannedSteps = [{ toolId: 'test.mutate', args: {} }];
    const gated = await workflow.run({ user: apiUser, request: 'mutate' });
    assert.equal(gated.confirmationRequired, true, 'mutates metadata must enforce confirmation even without an explicit flag');
    const revoked = await workflow.confirm({ user: { ...apiUser, permissions: ['chat'] }, workflowId: gated.workflowId });
    assert.equal(revoked.ok, false, 'confirmation must use current principal permissions');
    assert.equal(mutations.length, 1);
    console.log('PASS: no deletion before confirmation; cancel, replay and account switch protected; completed UI actions not repeated');
    assert(!requests.some(item => item.pathname.startsWith('/api/chat')));
    const guestDom = new JSDOM('<!doctype html><html><body><div id="sm-apps"></div></body></html>', { url: 'https://panthorium-staging.example.run.app/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const gw = guestDom.window;
    gw.OS = { config: { accessToken: 'guest-session-token' }, state: { user: guest } };
    gw.PanthoriumAuth = { isGuest: () => true, isAdministrator: () => false, isAdminEntry: () => false, hasPermission: permission => permission === 'chat' };
    gw.fetch = async url => ({ ok: true, status: 200, json: async () => String(url).includes('/status') ? { configured: true, gateEnabled: true } : { profiles: [] } });
    gw.eval(source('voice-identity-ui.js'));
    gw.document.dispatchEvent(new gw.Event('DOMContentLoaded'));
    await tick();
    assert(gw.document.getElementById('voice-identity-launcher'), 'guest start menu keeps the Voice Identity icon');
    assert.equal(gw.document.querySelector('#voice-identity-launcher span')?.textContent, 'ลงทะเบียน/เข้าสู่ระบบ/Voice Identity', 'launcher label describes registration and login');
    await gw.PanthoriumVoiceIdentity.open();
    await new Promise(resolve => setTimeout(resolve, 0));
    gw.PanthoriumVoiceIdentity.openLogin();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(gw.document.activeElement, gw.document.querySelector('[data-login-email]'), 'voice login phrase focuses the login email without leaving Voice Identity');
    assert.deepEqual([...gw.document.querySelectorAll('[data-type] option')].map(option => option.value), ['user', 'family'], 'guest registration offers user and family only');
    assert(gw.document.querySelector('[data-email][type="email"]'), 'guest voice signup asks for email');
    assert(gw.document.querySelector('[data-password][type="password"]'), 'guest voice signup asks for a password');
    assert(gw.document.querySelector('[data-password-confirm][type="password"]'), 'guest voice signup confirms the password');
    assert(gw.document.querySelector('[data-request-otp]') && gw.document.querySelector('[data-verify-otp]'), 'guest confirms email with OTP');
    assert(gw.document.querySelector('[data-login-email]') && gw.document.querySelector('[data-forgot]'), 'guest can sign in or recover password');
    assert(gw.document.querySelector('[data-reset-email][type="email"]') && gw.document.querySelector('[data-reset-password-confirm][type="password"]'), 'password recovery has an email and password confirmation field');
    assert(gw.document.querySelector('[data-remember]') && gw.document.querySelector('[data-login-remember]'), 'remember choice appears on signup and login');
    assert.match(gw.document.querySelector('#panthorium-voice-identity [data-state]').textContent, /ด่านคัดเสียงเปิดใช้งานแล้ว/, 'guest sees the staged speaker gate enabled');
    gw.close();
    const signedDom = new JSDOM('<!doctype html><html><body><div id="sm-apps"></div></body></html>', { url: 'https://panthorium-staging.example.run.app/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const sw = signedDom.window;
    const securityRequests = [];
    sw.OS = { config: { accessToken: 'signed-user-token' }, state: { user: { id: 'signed-user', email: 'owner@example.com', roles: ['user'], permissions: ['chat'] } } };
    sw.PanthoriumAuth = { isGuest: () => false, isAdministrator: () => false, isAdminEntry: () => false, hasPermission: permission => permission === 'chat' };
    sw.fetch = async (url, options = {}) => {
      const path = String(url); securityRequests.push({ path, body: options.body ? JSON.parse(options.body) : null });
      if (path.includes('/status')) return { ok: true, status: 200, json: async () => ({ configured: true, gateEnabled: true }) };
      if (path.includes('/profiles')) return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    sw.eval(source('voice-identity-ui.js'));
    sw.document.dispatchEvent(new sw.Event('DOMContentLoaded'));
    await tick();
    await sw.PanthoriumVoiceIdentity.open();
    await tick();
    assert.equal(sw.document.querySelector('[data-security-email]')?.value, 'owner@example.com', 'signed-in account email is used in security panel');
    assert(sw.document.querySelector('[data-security-otp]') && sw.document.querySelector('[data-security-password]') && sw.document.querySelector('[data-security-password-confirm]'), 'password change requires email OTP and confirmation fields');
    sw.document.querySelector('[data-security-request-otp]').click(); await new Promise(resolve => setTimeout(resolve, 0));
    assert(securityRequests.some(request => request.path === '/api/auth/password/forgot'), 'password change requests an email OTP');
    sw.document.querySelector('[data-security-otp]').value = '123456';
    sw.document.querySelector('[data-security-password]').value = 'new-password-123';
    sw.document.querySelector('[data-security-password-confirm]').value = 'new-password-123';
    sw.document.querySelector('[data-security-password-submit]').click(); await new Promise(resolve => setTimeout(resolve, 0));
    const resetRequest = securityRequests.find(request => request.path === '/api/auth/password/reset');
    assert.equal(resetRequest?.body?.confirmPassword, 'new-password-123', 'confirmed password is sent with OTP');
    assert.equal(sw.document.querySelector('[data-security-state]').textContent, 'เปลี่ยนรหัสผ่านสำเร็จ');
    sw.close();
    console.log('PASS: signed-in Voice Identity can change password with email OTP and confirmation');
    console.log('PASS: guest and signed-in Voice Identity security flows are separated');
  } finally { w.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
