'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { fixture } = require('./work-assistant');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 120; i++) { if (check()) return; await wait(10); } assert.fail('UI state did not settle'); }
(async () => {
  const f = fixture(), dom = new JSDOM('<!doctype html><div id="sm-apps"></div>', { url: 'https://work.panthorium.test', runScripts: 'outside-only' }), w = dom.window;
  w.OS = { state: { user: f.user }, config: { accessToken: 'fixture' } };
  let windowOptions, failSave = false, conflict = false, slowAnalysis = false, pendingAnalysis;
  const calls = [], voiceTexts = [];
  w.createWindow = (id, title, html, options) => { windowOptions = options; const root = w.document.createElement('div'); root.className = 'window'; root.dataset.id = id; root.innerHTML = html; w.document.body.append(root); };
  w.PanthoriumWindowManager = { restore() {} }; w.PanthoriumLiveVoice = { isActive: () => false, async toggle() {}, sendText: text => voiceTexts.push(text) };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async (url, options = {}) => {
    const path = new URL(url, w.location.href).pathname, body = typeof options.body === 'string' ? JSON.parse(options.body) : {}, user = { ...w.OS.state.user };
    calls.push({ path, options, body, user });
    const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
    try {
      let data;
      if (path === '/api/work') data = await f.service.list({ user });
      else if (path === '/api/files') data = { files: [...f.objects.values()].filter(file => file.owner === user.sub).map(({ body, owner, ...file }) => file) };
      else if (path.startsWith('/api/actions/')) data = { output: {} };
      else if (path.startsWith('/api/studio/jobs/')) data = await f.studio.get({ user, jobId: path.split('/').at(-1) });
      else if (/^\/api\/work\//.test(path)) {
        const projectId = path.split('/')[3];
        if (path.endsWith('/analyze')) {
          if (slowAnalysis) return await new Promise((resolve, reject) => { pendingAnalysis = resolve; options.signal?.addEventListener('abort', () => reject(new w.DOMException('cancelled', 'AbortError')), { once: true }); });
          data = await f.service.analyze({ user, projectId, ...body });
        } else if (path.endsWith('/tasks')) data = await f.service.changeTask({ user, projectId, ...body });
        else if (path.endsWith('/export')) data = await f.service.export({ user, projectId, ...body });
        else if (options.method === 'PUT') {
          if (failSave) { failSave = false; throw Error('network down'); }
          if (conflict) return response({ ok: false, error: 'work_version_conflict' }, 409);
          data = await f.service.save({ user, projectId, ...body });
        } else data = await f.service.get({ user, projectId });
      } else throw Error('unexpected URL ' + path);
      return response({ ok: true, ...data });
    } catch (failure) { if (failure.message === 'network down' || failure.name === 'AbortError') throw failure; return response({ ok: false, error: failure.code || failure.message }, failure.status || 400); }
  };
  w.eval(fs.readFileSync(require.resolve('../work-assistant-ui.js'), 'utf8'));
  w.PanthoriumWorkAssistant.open();
  const q = selector => w.document.querySelector(selector), input = (selector, value) => { q(selector).value = value; q(selector).dispatchEvent(new w.Event('input', { bubbles: true })); };
  await until(() => q('[data-work-editor]')?.hidden === false);
  assert(q('#sm-apps [data-app-id="work-assistant"]'));
  input('[data-work-title]', '<img src=x onerror=alert(1)> ลูกค้า'); input('[data-work-text]', 'กำหนดให้ส่งรายงานเมื่อผู้ใช้ยืนยัน');
  input('[data-work-draft]', 'รายงานฉบับแรก\nข้อมูลจริง 1200 บาท');
  q('[data-work-save]').click(); await until(() => /บันทึกแล้ว/.test(q('[data-work-status]').textContent));
  assert.equal(q('[data-work-projects]').selectedOptions[0].textContent, '<img src=x onerror=alert(1)> ลูกค้า'); assert.equal(q('[data-work] img'), null);
  let p = (await f.service.list({ user: f.user })).projects[0]; assert.match(p.draft, /1200/);
  input('[data-work-draft]', 'รายงานฉบับสอง'); q('[data-work-save]').click(); await until(() => /บันทึกแล้ว/.test(q('[data-work-status]').textContent));
  assert.match(q('[data-work-history]').textContent, /รายงานฉบับแรก/);
  failSave = true; input('[data-work-draft]', 'ร่างที่ต้องกู้คืน'); q('[data-work-save]').click();
  await until(() => /เชื่อมต่อไม่สำเร็จ/.test(q('[data-work-status]').textContent));
  assert([...Object.keys(w.localStorage)].some(key => key.includes(f.user.sub)));
  windowOptions.onClose(); q('.window').remove(); w.PanthoriumWorkAssistant.open();
  await until(() => /พบร่างที่ยังไม่ซิงก์/.test(q('[data-work-evidence]')?.textContent || ''));
  [...q('[data-work-evidence]').querySelectorAll('button')].find(b => b.textContent === 'กู้ร่างขึ้นมา').click();
  assert.equal(q('[data-work-draft]').value, 'ร่างที่ต้องกู้คืน'); q('[data-work-save]').click(); await until(() => /บันทึกแล้ว/.test(q('[data-work-status]').textContent));
  conflict = true; input('[data-work-draft]', 'ร่างที่ชนฉบับบนเซิร์ฟเวอร์'); q('[data-work-save]').click();
  await until(() => q('[data-work-conflict]').hidden === false); assert.equal(q('[data-work-draft]').value, 'ร่างที่ชนฉบับบนเซิร์ฟเวอร์');
  conflict = false; q('[data-work-copy]').click(); await until(() => q('[data-work-title]').value.endsWith('(ร่างกู้คืน)'));
  assert.equal((await f.service.list({ user: f.user })).projects.length, 2);
  q('[data-work-voice]').click(); await until(() => voiceTexts.length === 1); assert.match(voiceTexts[0], /work\.read/);
  q('[data-work-add-task]').click(); const dialog = q('[data-work-dialog]'); assert(dialog.open);
  const fields = dialog.querySelectorAll('input'); fields[0].value = 'ส่งรายงานจริง'; fields[1].value = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16); fields[2].value = 'คุณเอ';
  const submit = [...dialog.querySelectorAll('button')].find(b => b.textContent === 'ยืนยันและบันทึก'); submit.click(); submit.click();
  await until(() => !dialog.open); assert.equal(calls.filter(call => call.path.endsWith('/tasks')).length, 1); assert.match(q('[data-work-tasks]').textContent, /ส่งรายงานจริง/);
  f.gateway.text = 'สรุปจากข้อมูล [INPUT]'; q('[data-work-mode="summary"]').click();
  await until(() => /ประมวลผลแล้ว/.test(q('[data-work-status]').textContent)); assert.equal(q('[data-work-draft]').value, 'สรุปจากข้อมูล [INPUT]'); assert.match(q('[data-work-evidence]').textContent, /INPUT/);
  slowAnalysis = true; q('[data-work-mode="summary"]').click(); await until(() => !!pendingAnalysis); q('[data-work-stop]').click(); await until(() => /หยุดแล้ว/.test(q('[data-work-status]').textContent));
  assert.equal(q('[data-work-draft]').value, 'สรุปจากข้อมูล [INPUT]'); slowAnalysis = false;
  p = (await f.service.list({ user: f.user })).projects.find(item => item.title.endsWith('(ร่างกู้คืน)'));
  await w.PanthoriumWorkAssistant.review({ toolId: 'work.save', requiresConfirmation: true, args: { patch: { text: 'WRONG OUTER PAYLOAD' } }, confirmation: { toolId: 'work.save', actionId: randomUUID(), approvalHash: 'a'.repeat(64), approvalExpiresAt: new Date(Date.now() + 60000).toISOString(), args: { projectId: p.id, expectedVersion: p.version, patch: { text: 'EXACT APPROVED CONTENT <script>bad()</script>' } } } });
  assert.match(q('[data-work-approvals]').textContent, /EXACT APPROVED CONTENT/); assert.doesNotMatch(q('[data-work-approvals]').textContent, /WRONG OUTER PAYLOAD/); assert.equal(q('[data-work-approvals] script'), null);
  input('[data-work-draft]', 'ข้อมูลลับของบัญชีแรก'); w.OS.state.user = { ...f.other }; w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert.equal(q('[data-work]'), null); assert.equal(Object.keys(w.localStorage).filter(key => key.includes(f.user.sub)).length, 0);
  w.PanthoriumWorkAssistant.open(); await until(() => q('[data-work-editor]')?.hidden === false);
  assert.equal(q('[data-work-draft]').value, ''); assert.doesNotMatch(q('[data-work]').textContent, /ข้อมูลลับของบัญชีแรก/);
  windowOptions.onClose(); w.close();
  console.log('PASS work assistant UI: server-backed workflows, autosave, local recovery, conflict preservation, task confirmation, cancellation, exact approval payload, XSS and account switching');
})().catch(failure => { console.error(failure); process.exitCode = 1; });
