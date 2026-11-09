'use strict';

// Parsing runs in a bounded worker. Source bytes are data, never executable input.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_CHARS = 80000;
function fail(code, status = 422) { throw Object.assign(new Error(code), { code, status }); }

async function parse(file) {
  const body = Buffer.from(file.body), ext = String(file.name).split('.').pop().toLowerCase();
  if (!body.length || body.length > MAX_BYTES) fail('work_source_too_large', 413);
  const parts = [];
  const add = (key, label, text) => { if (String(text).trim()) parts.push({ key, label, text: String(text) }); };
  if (ext === 'pdf') {
    if (body.subarray(0, 5).toString() !== '%PDF-') fail('work_invalid_pdf');
    const path = require('node:path');
    const pdf = await import(require('node:url').pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
    const task = pdf.getDocument({ data: new Uint8Array(body), isEvalSupported: false,
      standardFontDataUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/',
      useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
    try {
      const doc = await task.promise;
      if (doc.numPages > 100) fail('work_source_too_many_pages', 413);
      let chars = 0;
      for (let page = 1; page <= doc.numPages; page++) {
        const content = await (await doc.getPage(page)).getTextContent();
        const text = content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('');
        chars += text.length;
        if (chars > MAX_CHARS) fail('work_source_text_too_large', 413);
        add('P' + page, 'หน้า ' + page, text);
      }
      if (chars < 20) fail('work_scanned_pdf_requires_ocr');
    } finally { await task.destroy(); }
  } else if (['docx', 'xlsx', 'pptx'].includes(ext)) {
    const { _internals } = require('./officeArtifactService');
    const { officeModel } = require('./studioEditorService');
    const plugin = { docx: 'document', xlsx: 'spreadsheet', pptx: 'presentation' }[ext];
    const model = officeModel(_internals.unzip(body), plugin);
    if (model.blocks) for (const block of model.blocks) {
      add('B' + block.index, ext === 'pptx' ? 'สไลด์ ' + block.page + ' · ข้อความ ' + (block.index + 1) : 'ย่อหน้า ' + (block.index + 1), block.text);
    }
    if (model.sheets) {
      const sheets = require('../office-suite-core').calculate(model.sheets);
      for (const [index, sheet] of sheets.entries()) for (const cell of sheet.cells) {
        let value = cell.value;
        if (cell.formula) value = cell.calculationError ? '[คำนวณสูตรนี้ไม่ได้: ' + cell.calculationError + '; ห้ามใช้ค่าที่เก็บไว้เป็นผลปัจจุบัน]' : cell.calculated;
        add('S' + index + 'C' + cell.cell, sheet.name + '!' + cell.cell,
          String(value ?? '') + (cell.formulaText ? ' (สูตร ' + cell.formulaText + ')' : ''));
      }
    }
  } else if (['txt', 'md', 'csv', 'tsv', 'json', 'log'].includes(ext)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { fail('work_source_encoding_unsupported'); }
    if (text.includes('\u0000')) fail('work_source_encoding_unsupported');
    for (const [index, line] of text.split(/\r?\n/).entries()) add('L' + (index + 1), 'บรรทัด ' + (index + 1), line);
  } else fail('work_source_type_unsupported', 415);
  if (parts.length > 6000 || parts.reduce((n, part) => n + part.text.length, 0) > MAX_CHARS) fail('work_source_text_too_large', 413);
  if (!parts.length) fail('work_source_empty');
  return { revision: createHash('sha256').update(body).digest('hex'), parts };
}

function readWorkFile(file, { signal } = {}) {
  if (!Buffer.isBuffer(file.body) || file.body.length > MAX_BYTES) fail('work_source_too_large', 413);
  if (signal?.aborted) fail('work_cancelled', 499);
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { name: file.name, body: file.body },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
    let done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker.terminate(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(Object.assign(new Error('work_cancelled'), { code: 'work_cancelled', status: 499 }));
    const timer = setTimeout(() => finish(Object.assign(new Error('work_source_timeout'), { code: 'work_source_timeout', status: 422 })), 20000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => finish(message.error ? Object.assign(new Error(message.error), { code: message.error, status: message.status || 422 }) : null, message.result));
    worker.once('error', () => finish(Object.assign(new Error('work_source_parse_failed'), { code: 'work_source_parse_failed', status: 422 })));
    worker.once('exit', () => { if (!done) finish(Object.assign(new Error('work_source_parse_failed'), { code: 'work_source_parse_failed', status: 422 })); });
  });
}
if (!isMainThread) parse(workerData).then(result => parentPort.postMessage({ result })).catch(error => parentPort.postMessage({ error: error.code || 'work_source_parse_failed', status: error.status }));
module.exports = { readWorkFile, MAX_BYTES };
