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
  const dom = new JSDOM(source('sentinel.html'), { url: 'https://panthorium-backend-staging.example.run.app/admin', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  const context = dom.getInternalVMContext();
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
    for (const file of ['user-manager.js', 'security-dashboard.js', 'ai-dashboard.js', 'ai-stream-client.js', 'agent-ui.js', 'agent-automation-ui.js', 'agent-memory-ui.js', 'multi-agent-ui.js', 'integrations-ui.js', 'production-intelligence-ui.js', 'training-ui.js', 'governance-ui.js', 'sentinel-control-ui.js', 'voice-window-catalog.js', 'external-apps-ui.js', 'voice-command-client.js', 'staging-admin-desktop.js']) load(file);
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
      if (app.external) {
        const frame = root.querySelector('iframe');
        assert(frame, `${app.label}: external iframe missing`);
        assert.equal(frame.src, app.externalUrl, `${app.label}: fixed external URL`);
        assert.equal(frame.getAttribute('sandbox'), 'allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts allow-same-origin');
        assert(root.querySelector('[data-external-open-tab]'), `${app.label}: open-tab fallback missing`);
      }
      assert.equal((await command(`เปิด ${app.aliases[0]}`)).ok, true);
      assert.equal(w.document.querySelectorAll(app.selector).length, 1, `${app.label}: duplicate window`);
      if (app.refresher || app.refreshButton) assert.equal((await command(`รีเฟรช ${app.aliases[0]}`)).ok, true, `${app.label} refresh`);
      const closed = await command(`ปิด ${app.aliases[0]}`);
      assert.equal(closed.ok, true);
      assert.equal(closed.text, `ปิด ${app.label}`);
      assert.equal(isVisible(app), false, `${app.label} stayed open`);
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
    for (const app of catalog.apps) {
      const result = await command(`เปิด ${app.aliases[0]}`);
      assert.equal(result.ok, catalog.allowed(app, guest), `${app.label}: guest permission`);
      assert.equal(isVisible(app), catalog.allowed(app, guest), `${app.label}: guest DOM`);
      if (result.ok) await command(`ปิด ${app.aliases[0]}`);
    }
    assert.equal((await w.PanthoriumVoiceCommands.windowAction('open_learning_lab')).ok, false, 'desktop/client calls also need permission');
    replaceUser({ ...admin, roles: ['operator'] });
    assert.equal((await command('เปิด Security')).ok, false, 'settings permission alone does not grant administrator role');
    replaceUser(admin);
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
  } finally { w.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
