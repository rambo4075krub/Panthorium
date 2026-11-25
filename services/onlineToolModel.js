'use strict';
const {randomUUID} = require('node:crypto');
const {imageInfo} = require('./officeArtifactService');
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}
function id(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) fail('invalid_id');
  return value.toLowerCase();
}
function text(value, max, optional = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (!optional && !value.trim())
  )
    fail('invalid_text');
  return value.trim();
}
function list(value, max) {
  if (!Array.isArray(value) || value.length > max) fail('invalid_list');
  return value;
}
function choice(value, allowed) {
  if (!allowed.includes(value)) fail('invalid_choice');
  return value;
}
function unique(values) {
  if (new Set(values).size !== values.length) fail('duplicate_values');
  return values;
}
function color(value) {
  if (!/^#[\da-f]{6}$/i.test(value)) fail('invalid_color');
  return value;
}
function normalize(kind, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_project');
  if (kind === 'film') return require('./filmStudioModel').normalizeFilm(raw);
  if (kind === 'form') {
    const fields = list(raw.fields, 20).map((f) => {
      if (!f || typeof f !== 'object') fail('invalid_field');
      const type = choice(f.type, ['short', 'long', 'number', 'choice']);
      const options = type === 'choice' ? unique(list(f.options, 24).map((o) => text(o, 100))) : [];
      if (type === 'choice' && options.length < 2) fail('need_two_choices');
      return {id: id(f.id), label: text(f.label, 100), type, required: f.required === true, options};
    });
    unique(fields.map((f) => f.id));
    if (!fields.length) fail('need_field');
    return {description: text(raw.description || '', 1200, true), fields};
  }
  if (kind === 'page') {
    const blocks = list(raw.blocks, 100).map((b) => {
      if (!b || typeof b !== 'object') fail('invalid_block');
      const type = choice(b.type, ['heading', 'text', 'check']);
      return {type, text: text(b.text, 1200), done: type === 'check' && b.done === true};
    });
    return {blocks};
  }
  if (kind === 'design') {
    const image = raw.image || '';
    if (
      typeof image !== 'string' ||
      image.length > 520000 ||
      (image && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))
    )
      fail('invalid_image');
    if (image) {
      const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
      let info;
      try {
        info = imageInfo({body: bytes, name: 'design'});
      } catch {
        fail('invalid_image');
      }
      if (
        !image.startsWith('data:' + info.contentType + ';') ||
        Math.max(info.width, info.height) > 1600
      )
        fail('invalid_image');
    }
    return {
      layout: choice(raw.layout, ['poster', 'menu', 'catalog']),
      size: choice(raw.size, ['square', 'story', 'a4']),
      background: color(raw.background),
      ink: color(raw.ink),
      accent: color(raw.accent),
      headline: text(raw.headline, 100),
      subtitle: text(raw.subtitle || '', 200, true),
      footer: text(raw.footer || '', 100, true),
      items: list(raw.items, 8).map((v) => text(v, 100)),
      image
    };
  }
  if (kind === 'flow') {
    const actions = unique(list(raw.actions, 2).map((v) => choice(v, ['record', 'notify'])));
    if (!actions.length) fail('need_action');
    const source = raw.source ? id(raw.source) : null;
    if (raw.enabled && !source) fail('select_form');
    return {
      source,
      labelField: raw.labelField ? id(raw.labelField) : null,
      actions,
      enabled: raw.enabled === true
    };
  }
  fail('invalid_kind');
}
function validateAnswers(fields, input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length > fields.length
  )
    fail('invalid_answers');
  const answers = {};
  for (const key of Object.keys(input)) if (!fields.some((f) => f.id === key)) fail('invalid_field');
  for (const f of fields) {
    const value = text(input[f.id] ?? '', f.type === 'long' ? 1500 : 240, true);
    if (!value && f.required) fail('required_field');
    if (
      value &&
      f.type === 'number' &&
      (!/^-?(?:\d+|\d*\.\d+)$/.test(value) || !Number.isFinite(Number(value)))
    )
      fail('invalid_number');
    if (value && f.type === 'choice' && !f.options.includes(value)) fail('invalid_choice');
    answers[f.id] = value;
  }
  if (JSON.stringify(answers).length > 8000) fail('answers_too_large');
  return answers;
}
function csvCell(value) {
  let str = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(str)) str = "'" + str;
  return '"' + str.replaceAll('"', '""') + '"';
}
function responsesCsv(current, rows) {
  const cols = new Map();
  for (const row of rows) for (const f of row.fields) cols.set(f.id, f.label);
  for (const f of current) cols.set(f.id, f.label);
  const line = (arr) => arr.map(csvCell).join(',');
  if (cols.size > 100) {
    return (
      '\uFEFF' +
      [
        line(['รายการ', 'เวลาส่ง', 'คำถาม', 'คำตอบ']),
        ...rows.flatMap((r) =>
          r.fields.map((f) => line([r.id, r.created_at.toISOString(), f.label, r.answers[f.id]]))
        )
      ].join('\r\n')
    );
  }
  const counts = new Map();
  const labels = Array.from(cols.values(), (label) => {
    const n = (counts.get(label) || 0) + 1;
    counts.set(label, n);
    return n === 1 ? label : `${label} (${n})`;
  });
  return (
    '\uFEFF' +
    [
      line(['เวลาส่ง', ...labels]),
      ...rows.map((r) =>
        line([r.created_at.toISOString(), ...Array.from(cols.keys(), (k) => r.answers[k])])
      )
    ].join('\r\n')
  );
}
module.exports = {fail, id, idPattern, text, normalize, validateAnswers, responsesCsv, randomUUID};
