'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { registerPersonalFunctionTools } = require('../services/personalFunctionTools');

class MemoryStore {
  constructor() {
    this.records = new Map();
    this.repository = { get: async (userId, id) => this.records.get(`${userId}:${id}`) || null };
  }
  async remember({ user, kind, title, content, tags }) {
    const memory = { memoryId: randomUUID(), kind, title, content, tags, updatedAt: new Date().toISOString() };
    this.records.set(`${user.sub}:${memory.memoryId}`, memory);
    return { ok: true, memory };
  }
  async list({ user, kind, limit = 30 }) {
    return { ok: true, memories: [...this.records.entries()].filter(([key, value]) => key.startsWith(`${user.sub}:`) && (!kind || value.kind === kind)).map(([, value]) => value).slice(0, limit) };
  }
  async search({ user, query, limit = 10 }) {
    const rows = await this.list({ user, limit: 100 });
    return { ok: true, memories: rows.memories.filter(item => `${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase())).slice(0, limit) };
  }
  async update({ user, memoryId, ...changes }) {
    const key = `${user.sub}:${memoryId}`;
    const current = this.records.get(key);
    if (!current) return { ok: false, error: 'memory_not_found' };
    const memory = { ...current, ...changes, updatedAt: new Date().toISOString() };
    this.records.set(key, memory);
    return { ok: true, memory };
  }
  async remove({ user, memoryId }) {
    return { ok: this.records.delete(`${user.sub}:${memoryId}`) };
  }
}

async function main() {
  const tools = new Map();
  const memory = new MemoryStore();
  const calls = [];
  let listedFileOwner = null;
  const reminders = {
    list: async ({ user }) => { calls.push(['reminders.list', user.sub]); return { ok: true, reminders: [], deliveryAvailable: true }; },
    create: async input => { calls.push(['reminders.create', input.user.sub, input.emailConsent]); return { ok: true, reminder: { reminderId: randomUUID() } }; },
    cancel: async input => { calls.push(['reminders.cancel', input.user.sub]); return { ok: true }; }
  };
  const files = {
    list: async userId => { listedFileOwner = userId; return { files: [{ id: 'file-1', name: 'plan.txt' }], usedBytes: 10, maxBytes: 1000, maxFiles: 10 }; },
    download: async (userId, id) => ({ id, name: 'plan.txt', contentType: 'text/plain', body: Buffer.from(`owner:${userId}`, 'utf8') }),
    upload: async (userId, name, contentType, body) => ({ id: randomUUID(), name, contentType, size: body.length, owner: userId }),
    remove: async (userId, id) => ({ id, owner: userId })
  };
  const knowledge = {
    ingest: async input => ({ ok: true, document: { documentId: randomUUID(), title: input.title } }),
    get: async () => ({ ok: true, document: { title: 'Owned document' } }),
    remove: async () => ({ ok: true })
  };
  registerPersonalFunctionTools({ register: tool => tools.set(tool.id, tool) }, { memory, reminders, files, knowledge });
  const owner = { sub: 'user-1', permissions: ['chat'] };
  const other = { sub: 'user-2', permissions: ['chat'] };

  for (const id of ['calendar.write', 'goals.write', 'notes.write', 'memory.write', 'reminders.write', 'files.write', 'knowledge.write']) {
    const tool = tools.get(id);
    assert.ok(tool, `${id} is registered`);
    assert.equal(tool.permission, 'chat');
    assert.equal(tool.mutates, true);
    assert.equal(tool.requiresConfirmation, true, `${id} requires user approval`);
  }

  const calendar = tools.get('calendar.write');
  assert.equal(calendar.validateArgs({ action: 'create', title: 'Sprint', startsAt: '2026-10-12T10:00:00Z', extra: true }), 'invalid_tool_args');
  assert.equal(calendar.validateArgs({ action: 'create', title: 'Sprint', startsAt: 'not-a-date' }), 'invalid_calendar_event');
  const created = await calendar.run({ user: owner, requestId: 'r1', args: { action: 'create', title: 'Sprint', startsAt: '2026-10-12T10:00:00Z', timeZone: 'Asia/Bangkok' } });
  assert.equal(created.event.title, 'Sprint');
  const read = await tools.get('calendar.read').run({ user: owner, args: {} });
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].title, 'Sprint');
  await assert.rejects(() => calendar.run({ user: other, args: { action: 'delete', eventId: created.event.eventId, expectedTitle: 'Sprint' } }), /record_not_found/);

  const reminder = tools.get('reminders.write');
  const reminderArgs = { action: 'create', kind: 'appointment', title: 'Dentist', dueAt: '2027-01-02T10:00:00Z', timeZone: 'Asia/Bangkok' };
  assert.equal(reminder.validateArgs(reminderArgs), 'invalid_reminder', 'email consent is mandatory');
  assert.equal(reminder.validateArgs({ ...reminderArgs, emailConsent: true }), null);
  await reminder.run({ user: owner, args: { ...reminderArgs, emailConsent: true } });
  assert.deepEqual(calls.at(-1), ['reminders.create', 'user-1', true]);

  const filesRead = tools.get('files.read');
  const listed = await filesRead.run({ user: owner, args: { action: 'list' } });
  assert.equal(listedFileOwner, 'user-1');
  const text = await filesRead.run({ user: owner, args: { action: 'read_text', fileId: '123e4567-e89b-42d3-a456-426614174000', expectedName: 'plan.txt' } });
  assert.equal(text.text, 'owner:user-1');
  assert.equal(tools.get('files.write').validateArgs({ action: 'save_text', fileName: 'unsafe.exe', content: 'x' }), 'invalid_file_request');

  const notes = tools.get('notes.write');
  assert.equal(notes.validateArgs({ action: 'create', title: 'Note', content: 'text', owner: 'user-2' }), 'invalid_tool_args');
  const note = await notes.run({ user: owner, args: { action: 'create', title: 'Note', content: 'Private text' } });
  assert.ok(note.note.noteId);
  await assert.rejects(() => notes.run({ user: other, args: { action: 'delete', noteId: note.note.noteId, expectedTitle: 'Note' } }), /record_not_found/);

  const knowledgeWrite = tools.get('knowledge.write');
  assert.equal(knowledgeWrite.validateArgs({ action: 'ingest', title: 'Doc', content: 'x', unexpected: 1 }), 'invalid_tool_args');
  assert.equal(knowledgeWrite.validateArgs({ action: 'ingest', title: 'Doc', content: 'x'.repeat(8001) }), 'invalid_knowledge_document');
  assert.equal(tools.get('files.write').validateArgs({ action: 'save_text', fileName: 'notes.txt', content: 'x'.repeat(8001) }), 'invalid_file_request');

  console.log('Personal function tool tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
