'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { WorkAssistantRepository } = require('../services/workAssistantRepository');
const { WorkAssistantService } = require('../services/workAssistantService');
const { readWorkFile } = require('../services/workDocumentReader');
const { AgentMemoryRepository } = require('../services/agentMemoryRepository');
const { AgentMemoryService } = require('../services/agentMemoryService');
const { ReminderRepository } = require('../services/reminderRepository');
const { ReminderService } = require('../services/reminderService');
const { CreativeStudioService } = require('../services/creativeStudioService');
const { MemoryCreativeStudioRepository } = require('../services/creativeStudioRepository');
const { OfficeArtifactService, extractOfficeText, _internals: office } = require('../services/officeArtifactService');
const { patchOffice } = require('../services/studioEditorService');
const { registerWorkAssistantTools } = require('../services/workAssistantTools');

function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>', '',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>', ''
  ];
  for (const [index, text] of [[4, 'Report amount 1200. Deadline 20 November 2026.'], [6, 'Second page with delivery requirements.']]) {
    const stream = 'BT /F1 12 Tf 72 720 Td (' + text + ') Tj ET'; objects[index] = '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream';
  }
  let body = '%PDF-1.7\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(body);
  body += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(body);
}
function fixture() {
  const user = { sub: randomUUID(), roles: ['member'], permissions: ['chat'], accountVersion: 0 };
  const other = { ...user, sub: randomUUID() }, objects = new Map();
  const files = { bucket: 'work-test', ensureConfigured() {},
    async findObject(owner, id) { const f = objects.get(id); if (!f || f.owner !== owner) throw Object.assign(Error('file_not_found'), { code: 'file_not_found', status: 404 }); return { ...f }; },
    async readOwned(owner, id) { return this.findObject(owner, id); }, async download(owner, id) { return this.readOwned(owner, id); },
    async upload(owner, name, contentType, body) { const file = { id: randomUUID(), owner, name, contentType, body: Buffer.from(body), size: Buffer.byteLength(body) }; objects.set(file.id, file); const { body: bytes, owner: principal, ...publicFile } = file; return publicFile; },
    async remove(owner, id) { await this.findObject(owner, id); objects.delete(id); } };
  const authService = { async validateAccountPrincipal(principal) { return principal; }, repository: { async findUserById(id) { return { id, roles: ['member'], permissions: ['chat'], email: 'work@example.test', emailVerifiedAt: new Date().toISOString() }; } } };
  const memory = new AgentMemoryService({ repository: new AgentMemoryRepository() });
  const reminders = new ReminderService({ repository: new ReminderRepository(), authService, sender: async () => ({ providerMessageId: 'fixture' }) });
  const gateway = { calls: [], text: 'สรุปยอด 1200 [F1.P1]', async complete(input) { this.calls.push(input); return { ok: true, text: this.text }; } };
  const studio = new CreativeStudioService({ repository: new MemoryCreativeStudioRepository(), files, gateway, office: new OfficeArtifactService({ files, gateway }), resolveUser: async u => u });
  const repository = new WorkAssistantRepository({ allowMemory: true });
  const service = new WorkAssistantService({ repository, files, gateway, studio, memory, reminders, authService }); memory.workAssistant = service;
  return { user, other, objects, files, authService, memory, reminders, gateway, studio, repository, service };
}

async function main() {
  const f = fixture(), { service, user, other, files, repository, gateway, memory, reminders } = f;
  const pdf = await files.upload(user.sub, 'brief.pdf', 'application/pdf', pdfFixture());
  const parsed = await readWorkFile(await files.readOwned(user.sub, pdf.id));
  assert.equal(parsed.parts.length, 2); assert.equal(parsed.parts[1].label, 'หน้า 2'); assert.match(parsed.parts[0].text, /1200/);
  const docx = office.documentBuffer({ title: 'รายงาน', sections: [{ paragraphs: ['ชื่อผู้รับ: คุณปานเทพ', 'ยอดรวม 1200 บาท'] }] }, []);
  const readDoc = await readWorkFile({ name: 'report.docx', body: docx }); assert(readDoc.parts.some(part => part.text === 'ยอดรวม 1200 บาท'));
  const xlsx = office.spreadsheetBuffer({ title: 'รายรับ', sheets: [{ name: 'ยอดขาย', rows: [['รายการ', 'จำนวน'], ['A', 100], ['B', 200], ['รวม', 0]] }] });
  const edited = office.zip(patchOffice(office.unzip(xlsx), 'spreadsheet', [{ type: 'set_formula', sheet: 0, cell: 'B4', value: '=SUM(B2:B3)' }]));
  const readSheet = await readWorkFile({ name: 'data.xlsx', body: edited }); assert.match(readSheet.parts.find(part => part.label === 'ยอดขาย!B4').text, /^300/);
  const pptx = office.presentationBuffer({ title: 'งาน', slides: [{ title: 'หนึ่ง', bullets: ['งานแรก'] }, { title: 'สอง', bullets: ['งานถัดไป'] }] }, []);
  assert((await readWorkFile({ name: 'slides.pptx', body: pptx })).parts.some(part => part.label.startsWith('สไลด์ 2')));
  await assert.rejects(() => readWorkFile({ name: 'bad.txt', body: Buffer.from([0xff, 0xfe]) }), /work_source_encoding_unsupported/);
  await assert.rejects(() => readWorkFile({ name: 'bad.pdf', body: Buffer.from('not a PDF') }), /work_invalid_pdf/);
  const projectId = randomUUID(), operationId = randomUUID();
  const create = { user, projectId, expectedVersion: 0, operationId, patch: { title: 'โครงการลูกค้า', text: 'ต้องตรวจเอกสารก่อนส่ง', sourceFileIds: [pdf.id] } };
  let p = (await service.save(create)).project;
  assert.equal(p.version, 1); assert.equal((await service.save(create)).project.version, 1);
  await assert.rejects(() => service.save({ ...create, patch: { title: 'คำขอเปลี่ยนแต่ใช้รหัสเดิม' } }), /work_operation_conflict/);
  await assert.rejects(() => service.get({ user: other, projectId }), /work_project_not_found/);
  await assert.rejects(() => service.save({ user: other, projectId: randomUUID(), expectedVersion: 0, operationId: randomUUID(), patch: { sourceFileIds: [pdf.id] } }), /file_not_found/);
  await assert.rejects(() => service.save({ ...create, operationId: randomUUID(), expectedVersion: 0 }), /work_version_conflict/);
  const answer = await service.analyze({ user, projectId, expectedVersion: p.version, mode: 'summary' });
  assert.equal(answer.citations[0].key, 'F1.P1'); assert.equal(answer.citations[0].fileId, pdf.id);
  assert.deepEqual(gateway.calls[0].tools, []); assert.match(gateway.calls[0].systemPrompt, /UNTRUSTED DATA/);
  gateway.text = 'ยอดรวม [F99.P88]'; await assert.rejects(() => service.analyze({ user, projectId, expectedVersion: p.version, mode: 'question' }), /work_invalid_citation/);
  gateway.text = JSON.stringify({ draft: 'เตรียมเอกสาร [INPUT]', tasks: [{ title: 'ตรวจเอกสาร', assignee: 'คุณเอ', dueAt: null, sourceKeys: ['INPUT'] }, { title: 'งานแต่งขึ้น', sourceKeys: ['DOES.NOTEXIST'] }] });
  const candidates = await service.analyze({ user, projectId, expectedVersion: p.version, mode: 'tasks' }); assert.equal(candidates.proposedTasks.length, 1); assert.equal(candidates.proposedTasks[0].dueAt, null);
  p = (await service.save({ user, projectId, expectedVersion: p.version, operationId: randomUUID(), patch: { draft: 'รายงานลูกค้า\nยอดรวม 1200 บาท\nตรวจเอกสารก่อนส่ง' } })).project;
  const calls = gateway.calls.length, exportId = randomUUID();
  const output = await service.export({ user, projectId, expectedVersion: p.version, operationId: exportId, pluginId: 'document' });
  assert.equal(output.job.status, 'completed'); assert.equal(gateway.calls.length, calls, 'Exporting a reviewed draft must not ask AI to rewrite it');
  const native = output.job.files.find(file => file.name.endsWith('.docx')); assert(native);
  assert.match(extractOfficeText((await files.readOwned(user.sub, native.id)).body), /1200/);
  const count = f.objects.size; await service.export({ user, projectId, expectedVersion: p.version, operationId: exportId, pluginId: 'document' }); assert.equal(f.objects.size, count);
  p = output.project;
  await assert.rejects(() => service.export({ user, projectId, expectedVersion: p.version, operationId: randomUUID(), pluginId: 'spreadsheet' }), /work_table_required/);
  p = (await service.save({ user, projectId, expectedVersion: p.version, operationId: randomUUID(), patch: { draft: '| รายการ | จำนวน |\n| --- | --- |\n| A | 100 |\n| B | 200 |' } })).project;
  const sheetOutput = await service.export({ user, projectId, expectedVersion: p.version, operationId: randomUUID(), pluginId: 'spreadsheet' }); assert.equal(sheetOutput.job.status, 'completed'); p = sheetOutput.project;
  const taskId = randomUUID(), taskOp = randomUUID(), dueAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const task = { title: 'ส่งรายงาน', dueAt, timeZone: 'Asia/Bangkok', assignee: 'คุณเอ', details: 'ตรวจยอดก่อนส่ง', remindBeforeMinutes: 30, emailConsent: true };
  const request = { user, projectId, expectedVersion: p.version, taskId, operationId: taskOp, action: 'create', task, confirmed: true };
  await assert.rejects(() => service.changeTask({ ...request, confirmed: false }), /work_confirmation_required/);
  p = (await service.changeTask(request)).project;
  const reminderId = p.tasks[0].reminderId;
  assert.equal((await reminders.repository.get(user.sub, reminderId)).dueAt, new Date(Date.parse(dueAt) - 1800000).toISOString());
  assert.equal((await memory.repository.get(user.sub, taskId)).title, 'ส่งรายงาน');
  assert.equal((await service.changeTask(request)).project.version, p.version); assert.equal((await reminders.repository.list(user.sub)).length, 1);
  const newDue = new Date(Date.now() + 5 * 86400000).toISOString();
  const moved = await memory.update({ user, memoryId: taskId, content: JSON.stringify({ version: 1, startsAt: newDue, timeZone: 'Asia/Bangkok', description: 'ตรวจใหม่', additionalStartsAt: [] }) });
  assert.equal(moved.ok, true); assert.equal((await reminders.repository.get(user.sub, reminderId)).dueAt, new Date(Date.parse(newDue) - 1800000).toISOString());
  p = (await service.get({ user, projectId })).project; assert.equal(p.tasks[0].dueAt, newDue);
  const before = structuredClone(await reminders.repository.get(user.sub, reminderId));
  const originalUpdate = memory.repository.update; memory.repository.update = async () => { throw Error('injected_calendar_write_failure'); };
  await assert.rejects(() => service.changeTask({ user, projectId, expectedVersion: p.version, taskId, operationId: randomUUID(), action: 'update', task: { ...task, dueAt }, confirmed: true }), /injected_calendar_write_failure/);
  memory.repository.update = originalUpdate;
  assert.deepEqual(await reminders.repository.get(user.sub, reminderId), before, 'Outbox changes roll back if the calendar write fails');
  reminders.repository.memory.get(reminderId).status = 'sending';
  await assert.rejects(() => service.changeTask({ user, projectId, expectedVersion: p.version, taskId, operationId: randomUUID(), action: 'cancel', confirmed: true }), /work_reminder_already_started/);
  assert.equal((await service.get({ user, projectId })).project.tasks[0].status, 'active');
  reminders.repository.memory.get(reminderId).status = 'scheduled';
  assert.equal((await memory.remove({ user, memoryId: taskId })).ok, true);
  assert.equal((await reminders.repository.get(user.sub, reminderId)).status, 'cancelled');
  assert.equal((await service.get({ user, projectId })).project.tasks[0].status, 'cancelled');
  const tools = new Map(); registerWorkAssistantTools({ register(tool) { tools.set(tool.id, tool); } }, { service });
  await assert.rejects(() => tools.get('work.export').run({ user, args: {} }), /immutable_action_confirmation_required/);
  await assert.rejects(() => service.list({ user: { ...user, roles: ['guest'] } }), /account_required/);
  const paged = await tools.get('work.read').run({ user, args: { action: 'sources', projectId, offset: 0 } }); assert(paged.parts.some(part => part.key === 'F1.P1'));
  assert.equal(repository.memory.size, 1);
  console.log('PASS work assistant: actual PDF/Office parsing, citations, account isolation, version conflicts, native exports, replay protection, linked task/calendar/reminder rollback and approval enforcement');
}
if (require.main === module) main().catch(failure => { console.error(failure); process.exitCode = 1; });
module.exports = { fixture, pdfFixture };
